import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { ApplyGoodsDto } from './dto/apply-goods.dto'
import { EditPendingApplyDto } from './dto/edit-pending-apply.dto'
import { ChangeGoodsDto } from './dto/change-goods.dto'
import { QuickStockDto } from './dto/quick-stock.dto'
import { AuditService } from '../audit/audit.service'
import { UpdateStatusDto } from './dto/update-status.dto'
// 卡BV-1（2026-10-03）：计量单位校验（放行集合 = 启用中的单位 ∪ 当前正在使用的单位）
import { assertUnitAllowed, assertUnitRequired } from '../measure-unit/unit-check'

/// 商品状态（schema Product.status 权威口径：0 下架 / 1 在售 / 2 变更审核中）
/// ⚠️ 新品的「待审核 / 已驳回」不再由 product.status 表达 —— 由该商品最新一条
/// type=1 申请的 status 判定（0 待审核 / 1 通过 / 2 已驳回），与后台 admin-goods 口径一致
const ProductStatus = {
  OFF_SHELF: 0, // 已下架（新品提交后审核期间也是 0，展示态看申请记录）
  ON_SALE: 1,   // 在售
  CHANGING: 2,  // 变更审核中
} as const

/// 封面地址白名单（2026-09-25 卡Z1）：只接受本站上传地址，防外链/防注入。
/// ① 相对路径：/uploads/ 开头（POST /upload/image 的返回格式）
/// ② 绝对地址：仅限生产域名 https://api.hsfresh.com/uploads/…（http(s) 皆收，路径必须在 /uploads/ 下）
export function isValidCoverUrl(cover: unknown): cover is string {
  if (typeof cover !== 'string' || !cover.trim()) return false
  const s = cover.trim()
  if (s.startsWith('/uploads/')) return true
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (u.hostname !== 'api.hsfresh.com') return false
    return u.pathname.startsWith('/uploads/')
  } catch {
    return false
  }
}

@Injectable()
export class SupplierGoodsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async getSupplier(userId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) throw new BizException(ErrorCode.FORBIDDEN, '当前账号不是供应商')
    return supplier
  }

  // ────────────────────────────────────────
  // 我的商品（搜索/状态筛选）
  // 契约《开发配套-API接口字段契约》第 6 节
  // ────────────────────────────────────────
  // ────────────────────────────────────────
  // 我的授权分类（发布商品时只能选这些）
  // ────────────────────────────────────────
  async myCategories(userId: bigint) {
    const supplier = await this.getSupplier(userId)
    const rows = await this.prisma.supplierCategory.findMany({
      where: { supplierId: supplier.id },
      include: { category: true },
    })
    return rows.map((r) => ({ id: Number(r.categoryId), name: r.category.name }))
  }

  async list(userId: bigint, query: { keyword?: string; status?: string }) {
    const supplier = await this.getSupplier(userId)

    const links = await this.prisma.productSupplierLink.findMany({
      where: { supplierId: supplier.id },
      include: {
        // 卡BQ：category 供列表行回显 categoryName（编辑待审商品弹层用）
        product: { include: { category: true, applications: { orderBy: { createdAt: 'desc' } } } },
      },
      orderBy: { productId: 'desc' },
    })

    let list = links.map((link) => {
      const p = link.product
      const pendingChange = p.applications.find((a) => a.type === 2 && a.status === 0)
      const latestNewApply = p.applications.find((a) => a.type === 1)

      // 供应商侧状态（卡Z2 收口，判定顺序）：
      // ① 最新一条新品申请（type=1）若 待审核/已驳回 → 申请态优先展示（不带上下架按钮）
      // ② 否则按 product.status：1 在售（有待审变更申请 → 变更审核中）/ 0 已下架 / 2 变更审核中
      // ③ 其它未覆盖值一律按「已下架」兜底（不许崩、不许白屏）
      let status: string, statusText: string
      if (latestNewApply && (latestNewApply.status === 0 || latestNewApply.status === 2)) {
        status = latestNewApply.status === 0 ? 'pending' : 'rejected'
        statusText = latestNewApply.status === 0 ? '待审核' : '已驳回'
      } else if (p.status === ProductStatus.ON_SALE) {
        status = pendingChange ? 'changing' : 'on_sale'
        statusText = pendingChange ? '变更审核中' : '在售'
      } else if (p.status === ProductStatus.CHANGING) {
        status = 'changing'
        statusText = '变更审核中'
      } else {
        // ProductStatus.OFF_SHELF 及其它未知值兜底
        status = 'off_shelf'
        statusText = '已下架'
      }

      return {
        id: Number(p.id),
        name: p.name,
        cover: p.cover ?? null,
        // 卡BQ（2026-10-03）：编辑待审商品弹层要回显当前分类（仅授权分类里选）
        categoryId: Number(p.categoryId),
        categoryName: p.category.name,
        supplyPrice: Number(link.supplyPrice),
        dailySupply: Number(link.dailySupply),
        unit: p.unit,
        weighType: p.weighType,
        // 卡BP（2026-10-02）：本供应商对该商品的备注（审核通过后的生效值；编辑弹层回显用）
        remark: link.remark ?? null,
        status,
        statusText,
        // 卡Z2：最新新品申请 id（前端「删除」按钮需要，DELETE /supplier-goods/apply/:applyId）
        applyId: latestNewApply ? Number(latestNewApply.id) : null,
        changeInfo: pendingChange ? pendingChange.diffs : null,
        rejectReason: latestNewApply?.status === 2 ? latestNewApply.rejectReason : null,
      }
    })

    if (query.keyword) list = list.filter((i) => i.name.includes(query.keyword.trim()))
    if (query.status && query.status !== 'all') list = list.filter((i) => i.status === query.status)

    return { total: list.length, list }
  }

  // ────────────────────────────────────────
  // 提交新品（审核制）
  // ────────────────────────────────────────
  async apply(userId: bigint, dto: ApplyGoodsDto) {
    const supplier = await this.getSupplier(userId)

    // 封面地址合法性（卡Z1）：与 PUT :productId/cover 同一套白名单
    if (dto.cover !== undefined && !isValidCoverUrl(dto.cover)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '封面地址不合法')
    }

    // ⚠️ 分类授权校验：供应商只能在自己被授权的分类发布商品
    const authorized = await this.prisma.supplierCategory.findFirst({
      where: { supplierId: supplier.id, categoryId: BigInt(dto.categoryId) },
    })
    if (!authorized) {
      throw new BizException(ErrorCode.FORBIDDEN, '该商品分类未被授权，请联系运营开通')
    }

    // 前置校验（2026-09-19 卡B）：分类必须存在。product.category_id 有 FK，
    // 若分类已被删则 create 撞 P2003 → 裸 5001；先查再写，落到业务码
    const category = await this.prisma.category.findUnique({ where: { id: BigInt(dto.categoryId) } })
    if (!category) throw new BizException(ErrorCode.PARAM_ERROR, '商品分类不存在')

    // 卡BV-1（2026-10-03）：单位**必填**且必须命中「启用中」的计量单位。
    // ⚠️ 这里删掉了原先写死的兜底 `unit ?? '斤'` —— 单位由运营在后台维护，供应商传什么存什么；
    // 新品没有「当前值」可放行，所以只认启用中的单位。
    const unit = await assertUnitRequired(this.prisma, dto.unit)

    // 事务（2026-09-19 卡B 涉库存/商品收口）：product + product_supplier_link（可供量）+ 审核申请
    // 三张表要么都成、要么都不成。原实现三次独立 create，中途失败会留下「有商品无供货关系」
    // 或「有商品无待审申请」的孤儿数据
    const application = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          categoryId: dto.categoryId,
          name: dto.name,
          weighType: dto.weighType,
          unit, // 卡BV-1：已校验（必填 + 命中启用单位），不再兜底 '斤'
          specText: dto.specText,
          images: dto.images,
          cover: dto.cover, // 卡Z1：新品提交可带封面（随审核一起过，不走免审通道）
          // ⚠️ 销售价由运营审核后按加价比例设定，此处占位 0
          salePrice: 0,
          markupRate: 0,
          // 新品待审：非在售（0=下架口径），展示态「待审核/已驳回」由申请记录判定（卡Z2）
          status: ProductStatus.OFF_SHELF,
        },
      })

      await tx.productSupplierLink.create({
        data: {
          productId: product.id,
          supplierId: supplier.id,
          supplyPrice: dto.supplyPrice,
          dailySupply: dto.dailySupply,
          priority: 9,
          status: 1,
        },
      })

      return tx.productApplication.create({
        data: {
          type: 1,
          productId: product.id,
          supplierId: supplier.id,
          payload: {
            name: dto.name,
            categoryId: dto.categoryId,
            weighType: dto.weighType,
            unit, // 卡BV-1：同上
            specText: dto.specText,
            supplyPrice: dto.supplyPrice,
            dailySupply: dto.dailySupply,
            images: dto.images,
            qualification: dto.qualification,
            cover: dto.cover,
            // 卡BP（2026-10-02）：商品备注随申请走审核，通过后由 admin-goods 写入 link
            remark: dto.remark,
          },
          status: 0,
        },
      })
    })

    return { applyId: Number(application.id), status: 'pending' }
  }

  // ────────────────────────────────────────
  // 提交变更申请（走审核，原版本在售至新版本生效）
  // ────────────────────────────────────────
  async change(userId: bigint, productId: number, dto: ChangeGoodsDto) {
    const supplier = await this.getSupplier(userId)

    // 校验商品属于本供应商
    const link = await this.prisma.productSupplierLink.findUnique({
      where: { productId_supplierId: { productId: BigInt(productId), supplierId: supplier.id } },
      include: { product: true },
    })
    if (!link) throw new BizException(ErrorCode.FORBIDDEN, '该商品不属于本供应商')

    const product = link.product
    if (product.status !== ProductStatus.ON_SALE) {
      throw new BizException(ErrorCode.PRODUCT_OFF_SHELF, '仅已上架商品可发起变更')
    }

    // 卡BV-1（2026-10-03）：changes.unit **可选**，传了才校验。
    // 放行集合 = 启用中的单位 ∪ 该商品当前正在用的单位（老商品单位被停用也不会把编辑卡死）
    if (dto.changes.unit !== undefined) {
      await assertUnitAllowed(this.prisma, dto.changes.unit, product.unit ?? null)
    }

    // ⚠️ 同一商品同时只允许一个进行中的变更申请
    const inProgress = await this.prisma.productApplication.findFirst({
      where: { productId: BigInt(productId), type: 2, status: 0 },
    })
    if (inProgress) throw new BizException(ErrorCode.CHANGE_IN_PROGRESS)

    // 生成新旧对照 diffs
    // 卡BP（2026-10-02）：remark 挂在 link 上（非 product），旧值取 link.remark
    const fieldText: Record<string, string> = {
      name: '品名', categoryId: '分类', weighType: '计量方式', specText: '规格', supplyPrice: '供货价', dailySupply: '日可供量', remark: '商品备注',
      // 卡BV-1（2026-10-03）：单位进变更（原型口径「改了单位 → 随变更一起走运营审核」）
      unit: '单位',
    }
    const diffs = Object.entries(dto.changes)
      .filter(([, v]) => v !== undefined)
      .map(([field, newValue]) => ({
        field,
        fieldText: fieldText[field] || field,
        oldValue: field === 'supplyPrice' ? Number(link.supplyPrice)
          : field === 'dailySupply' ? Number(link.dailySupply)
          : field === 'remark' ? (link.remark ?? '')
          : (product as any)[field],
        newValue,
      }))

    if (diffs.length === 0) throw new BizException(ErrorCode.PARAM_ERROR, '无有效变更内容')

    const application = await this.prisma.productApplication.create({
      data: {
        type: 2,
        productId: product.id,
        supplierId: supplier.id,
        payload: { ...dto.changes, reason: dto.reason },
        diffs,
        status: 0,
      },
    })

    return { changeId: Number(application.id), status: 'changing' }
  }

  // ────────────────────────────────────────
  // ✏️ 就地编辑待审核/已驳回的新品申请（卡BQ 2026-10-03）
  // 为什么不能复用 change()：change() 硬拦「仅已上架商品可发起变更」（product.status!==ON_SALE 即拒），
  // 待审商品 status=OFF_SHELF 进不去 —— 所以这里单独开方法。
  // 口径：① 仅本人、仅 type=1（新品）；② 只允许 status=0 待审核 / 2 已驳回，
  //      已通过(1) → 业务错（前端提示「该商品已审核通过，请用「变更申请」修改」）；
  //      ③ 事务内同步 application.payload + product（名称/分类/计量/规格/封面/图片）+ link（供货价/日供/备注）；
  //      ④ 原为已驳回 → status 置回 0（重新进待审队列，并清掉旧驳回原因）；
  //      ⑤ 不新增第二条申请（原地改）；⑥ 写审计。
  // ────────────────────────────────────────
  async editPendingApply(userId: bigint, applyId: number, dto: EditPendingApplyDto) {
    const supplier = await this.getSupplier(userId)

    const apply = await this.prisma.productApplication.findUnique({ where: { id: BigInt(applyId) } })
    if (!apply || apply.supplierId !== supplier.id) {
      throw new BizException(ErrorCode.NOT_FOUND, '该申请不存在或不属于本供应商')
    }
    if (apply.type !== 1) {
      throw new BizException(ErrorCode.PARAM_ERROR, '仅新品申请支持就地编辑')
    }
    if (apply.status === 1) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该商品已审核通过，请用「变更申请」修改')
    }
    if (apply.status !== 0 && apply.status !== 2) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该申请当前状态不支持编辑')
    }
    if (!apply.productId) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该申请缺少商品档案，无法就地编辑')
    }

    // 封面地址合法性（卡Z1 白名单，与 apply / updateCover 同一套）
    if (dto.cover !== undefined && dto.cover !== null && !isValidCoverUrl(dto.cover)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '封面地址不合法')
    }

    // 分类授权 + 存在性校验（口径同 apply()：先查再写，避免 FK 撞裸 5001）
    const authorized = await this.prisma.supplierCategory.findFirst({
      where: { supplierId: supplier.id, categoryId: BigInt(dto.categoryId) },
    })
    if (!authorized) {
      throw new BizException(ErrorCode.FORBIDDEN, '该商品分类未被授权，请联系运营开通')
    }
    const category = await this.prisma.category.findUnique({ where: { id: BigInt(dto.categoryId) } })
    if (!category) throw new BizException(ErrorCode.PARAM_ERROR, '商品分类不存在')

    const productId = apply.productId
    const beforeStatus = apply.status
    const oldPayload = (apply.payload as any) || {}
    const oldUnit = typeof oldPayload.unit === 'string' ? oldPayload.unit.trim() : ''

    // 卡BV-1（2026-10-03）：unit **可选** —— 传了才校验，不传保留原值（不再兜底 '斤'）。
    // 放行集合 = 启用中的单位 ∪ 该申请当前正在用的单位：老申请的单位被停用后，
    // 供应商「不改单位」重新提交也必须能过（否则老申请就永远改不动了）。
    const unit = dto.unit !== undefined
      ? await assertUnitAllowed(this.prisma, dto.unit, oldUnit || null)
      : oldUnit

    // payload 整体替换：必填 7 项用新值；未传的可选字段保留原值（undefined 在 Prisma Json 里会被丢弃，必须条件展开）
    const nextPayload: any = {
      ...oldPayload,
      name: dto.name,
      categoryId: dto.categoryId,
      weighType: dto.weighType,
      supplyPrice: dto.supplyPrice,
      dailySupply: dto.dailySupply,
    }
    // 单位只在拿得到值时写（老申请 payload 里没单位时保持原样，不写成空串）
    if (unit) nextPayload.unit = unit
    if (dto.specText !== undefined) nextPayload.specText = dto.specText
    if (dto.images !== undefined) nextPayload.images = dto.images
    if (dto.qualification !== undefined) nextPayload.qualification = dto.qualification
    if (dto.cover !== undefined) nextPayload.cover = dto.cover
    if (dto.remark !== undefined) nextPayload.remark = dto.remark // 传空串 = 显式清空

    await this.prisma.$transaction(async (tx) => {
      // ⑤ 原地改申请：只更新 payload（+ 已驳回时置回待审），不 create 第二条
      await tx.productApplication.update({
        where: { id: apply.id },
        data: {
          payload: nextPayload,
          // ④ 原为已驳回 → 重新进待审队列，旧驳回原因一并清掉
          ...(beforeStatus === 2 ? { status: 0, rejectReason: null } : {}),
        },
      })
      // ③ 同步商品档案（名称/分类/计量/规格/封面/图片）
      await tx.product.update({
        where: { id: productId },
        data: {
          name: dto.name,
          categoryId: dto.categoryId,
          weighType: dto.weighType,
          ...(unit ? { unit } : {}), // 卡BV-1：同 payload，拿不到值就不动
          ...(dto.specText !== undefined ? { specText: dto.specText } : {}),
          ...(dto.images !== undefined ? { images: dto.images } : {}),
          ...(dto.cover !== undefined ? { cover: dto.cover } : {}),
        },
      })
      // ③ 同步供货关系（供货价/日供/备注；remark 挂 link，卡BP 口径）
      await tx.productSupplierLink.updateMany({
        where: { productId, supplierId: supplier.id },
        data: {
          supplyPrice: dto.supplyPrice,
          dailySupply: dto.dailySupply,
          ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
        },
      })
    })

    // ⑥ 写审计（谁、哪条申请、改前改后关键字段、是否为驳回重提）
    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_EDIT_PENDING_APPLY',
      entity: 'product_application',
      entityId: Number(apply.id),
      before: {
        applyId: Number(apply.id),
        applyStatus: beforeStatus,
        productId: Number(productId),
        supplierId: Number(supplier.id),
        name: oldPayload.name,
        categoryId: oldPayload.categoryId,
        supplyPrice: oldPayload.supplyPrice,
        dailySupply: oldPayload.dailySupply,
      },
      after: {
        applyId: Number(apply.id),
        applyStatus: beforeStatus === 2 ? 0 : beforeStatus,
        productId: Number(productId),
        supplierId: Number(supplier.id),
        name: dto.name,
        categoryId: dto.categoryId,
        supplyPrice: dto.supplyPrice,
        dailySupply: dto.dailySupply,
        resubmitted: beforeStatus === 2,
      },
    })

    return { applyId: Number(apply.id), productId: Number(productId), status: 'pending', resubmitted: beforeStatus === 2 }
  }

  // ────────────────────────────────────────
  // ⚡ 快速改日可供量（免审核，即时生效）
  // ────────────────────────────────────────
  async quickStock(userId: bigint, productId: number, dto: QuickStockDto) {
    const supplier = await this.getSupplier(userId)

    const link = await this.prisma.productSupplierLink.findUnique({
      where: { productId_supplierId: { productId: BigInt(productId), supplierId: supplier.id } },
    })
    if (!link) throw new BizException(ErrorCode.FORBIDDEN, '该商品不属于本供应商')

    const dailySupplyBefore = Number(link.dailySupply)
    await this.prisma.productSupplierLink.update({
      where: { id: link.id },
      data: { dailySupply: dto.dailySupply },
    })

    // 铁律 3：免审即时改可供量 → 直接影响自动拆单结果，属关键操作，全量写审计
    // （2026-09-11 补，闭合审计复核缺口 S4）
    await this.audit.log({
      operatorId: userId,
      action: 'QUICK_UPDATE_DAILY_SUPPLY',
      entity: 'product',
      entityId: productId,
      before: { supplierId: Number(supplier.id), dailySupply: dailySupplyBefore },
      after: { supplierId: Number(supplier.id), dailySupply: dto.dailySupply },
    })

    return { productId, dailySupply: dto.dailySupply, effectiveImmediately: true }
  }

  // ────────────────────────────────────────
  // 📷 换封面（免审即时生效，2026-09-25 卡Z1）
  // 照片不涉价格/数量口径 → 不建 applications、不走审核队列；归属校验 + 地址白名单 + 留痕
  // ────────────────────────────────────────
  async updateCover(userId: bigint, productId: number, cover: string) {
    const supplier = await this.getSupplier(userId)

    // 长度上限（卡Z2 修复）：≤255 与 ApplyGoodsDto @MaxLength(255) 同口径。
    // 原先只查白名单，301 字符地址白名单放行 → Prisma 撞 VarChar(255) → 裸 5001
    if (cover.trim().length > 255) {
      throw new BizException(ErrorCode.PARAM_ERROR, '封面地址过长')
    }

    // 地址白名单：只收本站上传地址（/uploads/ 或生产域名），其它一律业务错误
    if (!isValidCoverUrl(cover)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '封面地址不合法')
    }

    // 归属校验：必须是本供应商名下商品，否则按资源不存在处理
    const link = await this.prisma.productSupplierLink.findUnique({
      where: { productId_supplierId: { productId: BigInt(productId), supplierId: supplier.id } },
      include: { product: true },
    })
    if (!link) throw new BizException(ErrorCode.NOT_FOUND, '该商品不存在或不属于本供应商')

    const coverBefore = link.product.cover ?? null
    await this.prisma.product.update({
      where: { id: link.productId },
      data: { cover: cover.trim() },
    })

    // 留痕：与 VOICE_SUPPLIER_REPORT 同一写法（谁、哪个商品、换图前后）
    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_COVER_UPDATE',
      entity: 'product',
      entityId: productId,
      before: { cover: coverBefore, supplierId: Number(supplier.id) },
      after: { cover: cover.trim(), supplierId: Number(supplier.id) },
    })

    return { productId, cover: cover.trim(), effectiveImmediately: true }
  }

  // ────────────────────────────────────────
  // ⬇⬆ 自助下架 / 重新上架（免审即时，2026-09-25 卡Z2）
  // 口径与后台 admin-goods#updateProductStatus 一致：0 下架 / 1 上架，不建 applications、
  // 不进审核队列；留痕复用后台同款 action（PRODUCT_ON_SHELF / PRODUCT_OFF_SHELF）保持全库一致
  // ────────────────────────────────────────
  async updateStatus(userId: bigint, productId: number, dto: UpdateStatusDto) {
    const supplier = await this.getSupplier(userId)

    const status = Number(dto.status)
    // 值校验：只收 0/1（与后台同款文案；service 层兜底，DTO 校验在前）
    if (![0, 1].includes(status)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '状态值不合法（0 下架 / 1 上架）')
    }

    // 归属校验：仅本人名下商品，否则按资源不存在处理（防跨档口探测）
    const link = await this.prisma.productSupplierLink.findUnique({
      where: { productId_supplierId: { productId: BigInt(productId), supplierId: supplier.id } },
      include: {
        product: { include: { applications: { orderBy: { createdAt: 'desc' } } } },
      },
    })
    if (!link) throw new BizException(ErrorCode.NOT_FOUND, '该商品不存在或不属于本供应商')

    // 拒绝「新品申请态」：最新 type=1 申请还在待审核/已驳回 → 不允许上下架
    const latestNewApply = link.product.applications.find((a) => a.type === 1)
    if (latestNewApply && (latestNewApply.status === 0 || latestNewApply.status === 2)) {
      throw new BizException(
        ErrorCode.PARAM_ERROR,
        latestNewApply.status === 0
          ? '待审核的商品不支持上下架，请等审核结果或删除申请'
          : '已驳回的商品不支持上下架，请等审核结果或删除申请',
      )
    }

    const statusBefore = link.product.status
    await this.prisma.product.update({
      where: { id: link.productId },
      data: { status },
    })

    await this.audit.log({
      operatorId: userId,
      action: status === 1 ? 'PRODUCT_ON_SHELF' : 'PRODUCT_OFF_SHELF',
      entity: 'product',
      entityId: productId,
      before: { status: statusBefore, supplierId: Number(supplier.id) },
      after: { status, supplierId: Number(supplier.id) },
    })

    return { productId, status, effectiveImmediately: true }
  }

  // ────────────────────────────────────────
  // 🗑 撤销/删除自建申请（2026-09-25 卡Z2）
  // 仅本人、仅 待审核(0)/已驳回(2)；已通过 → 引导走下架；
  // 新品申请(type=1) 零引用才真删（order_item / 其它 link / 其它申请 / 购物车 任一存在即拒），
  // 一个事务内删 本人 link + 申请 + product（对齐卡B「多表写必须进事务」规矩）；
  // 变更申请(type=2) 只删申请记录本身，不碰商品（变更申请挂的是在售商品，红线：在售商品不许删）
  // ────────────────────────────────────────
  async deleteApply(userId: bigint, applyId: number) {
    const supplier = await this.getSupplier(userId)

    const apply = await this.prisma.productApplication.findUnique({ where: { id: BigInt(applyId) } })
    if (!apply || apply.supplierId !== supplier.id) {
      throw new BizException(ErrorCode.NOT_FOUND, '该申请不存在或不属于本供应商')
    }

    if (apply.status === 1) {
      throw new BizException(ErrorCode.PARAM_ERROR, '已通过的商品请用下架，不能删除申请')
    }
    if (![0, 2].includes(apply.status)) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该申请当前状态不支持删除')
    }

    const applyIdNum = Number(apply.id)
    const productId = apply.productId

    // 变更申请：只撤申请本身（商品与供货关系原样保留）
    if (apply.type === 2 || !productId) {
      await this.prisma.productApplication.delete({ where: { id: apply.id } })
      await this.audit.log({
        operatorId: userId,
        action: 'SUPPLIER_APPLY_WITHDRAW',
        entity: 'product',
        entityId: productId ? Number(productId) : 0,
        before: { applyId: applyIdNum, applyType: apply.type, applyStatus: apply.status },
        after: { applyId: applyIdNum, deleted: ['product_application'] },
      })
      return { applyId: applyIdNum, deleted: ['product_application'] }
    }

    // 新品申请：零引用才真删（①历史订单 ②其它供货关系 ③其它申请 ④购物车引用）
    const [orderRefCount, linkCount, applyCount, cartRefCount] = await Promise.all([
      this.prisma.orderItem.count({ where: { productId } }),
      this.prisma.productSupplierLink.count({ where: { productId } }),
      this.prisma.productApplication.count({ where: { productId } }),
      this.prisma.cartItem.count({ where: { productId } }),
    ])
    if (orderRefCount > 0 || linkCount > 1 || applyCount > 1 || cartRefCount > 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, '该商品已有历史订单/其它关联，不能删除，请改为下架')
    }

    // 事务：三张表要么都成、要么都不成（audit_log 无外键，商品删了留痕不受影响）
    await this.prisma.$transaction(async (tx) => {
      await tx.productSupplierLink.deleteMany({ where: { productId, supplierId: supplier.id } })
      await tx.productApplication.delete({ where: { id: apply.id } })
      await tx.product.delete({ where: { id: productId } })
    })

    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_APPLY_WITHDRAW',
      entity: 'product',
      entityId: Number(productId),
      before: { applyId: applyIdNum, applyType: apply.type, applyStatus: apply.status, productId: Number(productId) },
      after: { applyId: applyIdNum, productId: Number(productId), deleted: ['product_supplier_link', 'product_application', 'product'] },
    })

    return { applyId: applyIdNum, productId: Number(productId), deleted: ['product_supplier_link', 'product_application', 'product'] }
  }
}
