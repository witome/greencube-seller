import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { ApplyGoodsDto } from './dto/apply-goods.dto'
import { ChangeGoodsDto } from './dto/change-goods.dto'
import { QuickStockDto } from './dto/quick-stock.dto'
import { AuditService } from '../audit/audit.service'

/// 商品状态（与 schema Product.status 对应）
const ProductStatus = {
  PENDING: 0,  // 待审核（新品提交后）
  ON_SALE: 1,  // 在售
  OFF_SHELF: 2, // 已下架
} as const

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
        product: { include: { applications: { orderBy: { createdAt: 'desc' } } } },
      },
      orderBy: { productId: 'desc' },
    })

    let list = links.map((link) => {
      const p = link.product
      const pendingChange = p.applications.find((a) => a.type === 2 && a.status === 0)
      const latestApply = p.applications.find((a) => a.type === 1)

      // 供应商侧状态
      let status: string, statusText: string
      if (p.status === ProductStatus.PENDING) {
        status = latestApply?.status === 2 ? 'rejected' : 'pending'
        statusText = latestApply?.status === 2 ? '已驳回' : '待审核'
      } else if (p.status === ProductStatus.ON_SALE) {
        status = pendingChange ? 'changing' : 'on_sale'
        statusText = pendingChange ? '变更审核中' : '在售'
      } else {
        status = 'off_shelf'
        statusText = '已下架'
      }

      return {
        id: Number(p.id),
        name: p.name,
        supplyPrice: Number(link.supplyPrice),
        dailySupply: Number(link.dailySupply),
        unit: p.unit,
        weighType: p.weighType,
        status,
        statusText,
        changeInfo: pendingChange ? pendingChange.diffs : null,
        rejectReason: latestApply?.status === 2 ? latestApply.rejectReason : null,
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

    // 事务（2026-09-19 卡B 涉库存/商品收口）：product + product_supplier_link（可供量）+ 审核申请
    // 三张表要么都成、要么都不成。原实现三次独立 create，中途失败会留下「有商品无供货关系」
    // 或「有商品无待审申请」的孤儿数据
    const application = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          categoryId: dto.categoryId,
          name: dto.name,
          weighType: dto.weighType,
          unit: dto.unit ?? '斤',
          specText: dto.specText,
          images: dto.images,
          // ⚠️ 销售价由运营审核后按加价比例设定，此处占位 0
          salePrice: 0,
          markupRate: 0,
          status: ProductStatus.PENDING,
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
            unit: dto.unit ?? '斤',
            specText: dto.specText,
            supplyPrice: dto.supplyPrice,
            dailySupply: dto.dailySupply,
            images: dto.images,
            qualification: dto.qualification,
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

    // ⚠️ 同一商品同时只允许一个进行中的变更申请
    const inProgress = await this.prisma.productApplication.findFirst({
      where: { productId: BigInt(productId), type: 2, status: 0 },
    })
    if (inProgress) throw new BizException(ErrorCode.CHANGE_IN_PROGRESS)

    // 生成新旧对照 diffs
    const fieldText: Record<string, string> = {
      name: '品名', categoryId: '分类', weighType: '计量方式', specText: '规格', supplyPrice: '供货价', dailySupply: '日可供量',
    }
    const diffs = Object.entries(dto.changes)
      .filter(([, v]) => v !== undefined)
      .map(([field, newValue]) => ({
        field,
        fieldText: fieldText[field] || field,
        oldValue: field === 'supplyPrice' ? Number(link.supplyPrice)
          : field === 'dailySupply' ? Number(link.dailySupply)
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
}
