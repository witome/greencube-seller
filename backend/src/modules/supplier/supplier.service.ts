import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { UpdateSupplierProfileDto } from './dto/update-profile.dto'
import {
  AFTERSALE_STATUS,
  AFTERSALE_STATUS_TEXT,
  AFTERSALE_TYPE_TEXT,
  AFTERSALE_METHOD_TEXT,
  AFTERSALE_METHOD_EMPTY_TEXT,
  resolveAftersaleSuppliers,
} from '../../common/utils/aftersale.util'

const SUPPLIER_STATUS_TEXT: Record<number, string> = { 0: '待审核', 1: '合作中', 2: '已停合作' }

/** 手机号撞号统一业务码（user.phone 唯一约束；不返回裸 5001，2026-09-12 卡） */
const PHONE_USED = 3009

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 店铺资料自助读写（2026-09-11 深夜卡第二部分）
  // 只按 token 的 userId 取自己的 supplier 档案——代码里没有任何 targetId/id 参数
  // 字段落点照运营侧 updateSupplier（唯一权威）：
  //   stallName / address → Supplier 列；contact / phone → qualification JSON；phone 同步 user 表
  // ────────────────────────────────────────
  async getSelfProfile(userId: bigint) {
    const s = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!s) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const qual = (s.qualification as any) || {}
    return {
      supplierId: Number(s.id),
      stallName: s.stallName,
      address: s.address,
      // 联系人/电话与运营侧同源（qualification JSON）
      contact: qual.contact ?? null,
      phone: qual.phone ?? null,
      status: s.status,
      statusText: SUPPLIER_STATUS_TEXT[s.status] ?? '未知',
      // 资质只读展示（剥掉 contact/phone，那两项目助可改不属资质）；无任何编造值
      qualification: {
        businessLicense: qual.businessLicense ?? null,
        quarantineCert: qual.quarantineCert ?? null,
        businessLicenseExpiry: qual.businessLicenseExpiry ?? null,
        quarantineCertExpiry: qual.quarantineCertExpiry ?? null,
      },
    }
  }

  async updateSelfProfile(userId: bigint, dto: UpdateSupplierProfileDto) {
    const s = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!s) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const data: any = {}
    if (dto.stallName !== undefined) data.stallName = dto.stallName
    if (dto.address !== undefined) data.address = dto.address || null

    // contact/phone 落 qualification JSON（照运营侧口径，**保留其余资质键**不动）
    const qual = { ...((s.qualification as any) || {}) }
    if (dto.contact !== undefined) qual.contact = dto.contact
    if (dto.phone !== undefined) qual.phone = dto.phone
    if (dto.contact !== undefined || dto.phone !== undefined) data.qualification = qual

    if (Object.keys(data).length === 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, '没有可更新的字段')
    }

    // 手机号唯一前置校验：user.phone 有唯一约束，撞号若不前置拦截会在事务内抛 P2002 回滚成 5001。
    // 仅非空 phone 参与撞号校验（null=清空，不查）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: s.userId } } })
      if (phoneOwner) throw new BizException(PHONE_USED, '该手机号已被其他账号使用')
    }

    // 变更前后值（仅记录实际变更的字段；contact/phone 的 before 取自原 qualification）
    const oldQual = (s.qualification as any) || {}
    const before: any = {}
    const after: any = {}
    if (dto.stallName !== undefined) { before.stallName = s.stallName; after.stallName = dto.stallName }
    if (dto.address !== undefined) { before.address = s.address; after.address = dto.address || null }
    if (dto.contact !== undefined) { before.contact = oldQual.contact ?? null; after.contact = dto.contact }
    if (dto.phone !== undefined) { before.phone = oldQual.phone ?? null; after.phone = dto.phone }

    // 事务：supplier 更新 + user 手机号同步要么都成、要么都不成（杜绝半更新）
    await this.prisma.$transaction([
      this.prisma.supplier.update({ where: { id: s.id }, data }),
      ...(dto.phone !== undefined ? [this.prisma.user.update({ where: { id: s.userId }, data: { phone: dto.phone } })] : []),
    ])

    // 独立 action SUPPLIER_SELF_UPDATE（照 A 卡 BUYER_SELF_UPDATE 先例）：
    // 与运营侧 UPDATE_SUPPLIER 区分「自助改/运营改」，审计页按 action 过滤更直接，也不动运营侧历史口径
    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_SELF_UPDATE',
      entity: 'supplier',
      entityId: s.id,
      before,
      after,
    })
    return { supplierId: Number(s.id), updated: true }
  }

  // ────────────────────────────────────────
  // 审核状态查询（2026-09-19 拍板卡）：供小程序「审核中」页 onShow/轮询
  // 返回结构与 /buyer/pending 完全一致（accountStatus/submittedAt/overdue/steps/rejectInfo）
  // 状态口径：0 待审核 / 1 合作中(=通过) / 2 停合作(=未通过/停用)
  // 只按 token 的 userId 取自己的档案，只读接口不审计
  // ────────────────────────────────────────
  async pending(userId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const submittedAt = supplier.createdAt
    const overdue = Date.now() - submittedAt.getTime() > 24 * 3600 * 1000

    let steps
    if (supplier.status === 0) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实中', status: 'active', time: null },
        { key: 'active', label: '审核通过', status: 'todo', time: null },
      ]
    } else if (supplier.status === 2) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实', status: 'done', time: null },
        { key: 'active', label: '审核通过', status: 'rejected', time: null },
      ]
    } else {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实', status: 'done', time: null },
        { key: 'active', label: '审核通过', status: 'done', time: null },
      ]
    }

    return {
      accountStatus: supplier.status,
      submittedAt: submittedAt.toISOString(),
      overdue,
      steps,
      rejectInfo:
        supplier.status === 2
          ? { reason: '档口账号已停用合作，请联系运营', reasonCode: 'SUPPLIER_SUSPENDED' }
          : null,
    }
  }

  // ────────────────────────────────────────
  // 售后台账 · 供应商只读视图（卡AE 2026-09-30）
  // ────────────────────────────────────────
  // 一句话：客户提的售后 → 运营线下谈 → 运营点「处理完成」→ **供应商也能看到结果**。
  //
  // ⚠️ 三条硬约束（照做别发挥）：
  //   ① **只读**：本服务不提供任何写售后的方法；供应商本期没有申诉 / 驳回入口
  //   ② **只显示归属本档口的工单**：`aftersale_order` 表没有供应商字段（本卡红线 3），
  //      归属只能经 `aftersale_order.order_item_id` → `order_item.supplier_id` 反查。
  //      先按 supplier_id 粗筛明细（一次查询拿全 id），再用**全仓唯一实现**
  //      `resolveAftersaleSuppliers` 逐条复核；复核不到（assigned=false）的一律**丢弃**
  //      —— 与「未拆单的工单不进供应商列表」是同一条规则，且不存在第二份归属判定。
  //      也正因如此：`order_item.supplier_id` 为空的工单**天然不会出现**在这张列表里。
  //   ③ **不返回金额链路**：只给补偿金额/方式与处理说明（看得见结果），不返回任何结算口径字段，
  //      页面也写死「不影响你的结算单」—— 本卡不动 Settlement、不新增扣款（红线 2）。
  //
  // 分页：本期**不做**（一个档口的售后量级很小）。将来要分页请单开卡，
  //      顺带把 pendingCount 与列表用同一个 where 收敛，别让红点数和列表对不上。
  //
  // `pendingCount` 与列表**同源**：都来自同一批行（status=0 的条数），供首页红点用（0 时前端不显示）。
  async myAftersales(userId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { userId },
      select: { id: true, stallName: true },
    })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const empty = { supplierId: Number(supplier.id), stallName: supplier.stallName, pendingCount: 0, list: [] }

    // ① 粗筛：本档口名下的订单明细 → 售后单集合
    const myItems = await this.prisma.orderItem.findMany({
      where: { supplierId: supplier.id },
      select: { id: true },
    })
    if (!myItems.length) return empty
    const myItemIds = myItems.map((it) => it.id)

    const rows = await this.prisma.aftersaleOrder.findMany({
      where: { orderItemId: { in: myItemIds } },
      orderBy: { createdAt: 'desc' },
    })
    if (!rows.length) return empty

    // ② 复核归属（唯一实现）；复核不到的丢弃
    const supplierMap = await resolveAftersaleSuppliers(this.prisma, rows.map((r) => r.orderItemId))
    const visible = rows.filter((r) => {
      const info = supplierMap.get(String(r.orderItemId))
      return !!info?.assigned && info.supplierId === Number(supplier.id)
    })
    if (!visible.length) return empty

    // ③ 组装展示字段：商品名（经明细→商品）、订单号与送达日期（经订单）
    const orderIds = [...new Set(visible.map((r) => r.orderId))]
    const [items, orders] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: { id: { in: [...new Set(visible.map((r) => r.orderItemId))] } },
        select: { id: true, productId: true, qtyAccepted: true, qtyReceived: true },
      }),
      this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, deliveryDate: true } }),
    ])
    const productIds = [...new Set(items.map((it) => it.productId))]
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: true } })
      : []
    const productById = new Map(products.map((p) => [String(p.id), p]))
    const itemById = new Map(items.map((it) => [String(it.id), it]))
    const orderById = new Map(orders.map((o) => [String(o.id), o]))

    return {
      supplierId: Number(supplier.id),
      stallName: supplier.stallName,
      // 待办数（首页红点）：与下面 list 同一批行里的 status=0 条数
      pendingCount: visible.filter((r) => r.status === AFTERSALE_STATUS.PENDING).length,
      list: visible.map((r) => {
        const item = itemById.get(String(r.orderItemId))
        const product = item ? productById.get(String(item.productId)) : undefined
        const order = orderById.get(String(r.orderId))
        const info = supplierMap.get(String(r.orderItemId))
        return {
          aftersaleId: Number(r.id),
          orderId: Number(r.orderId),
          orderItemId: Number(r.orderItemId),
          itemName: product?.name ?? null,
          unit: product?.unit ?? null,
          type: r.type,
          typeText: AFTERSALE_TYPE_TEXT[r.type] ?? '其他',
          // 客户填报的「涉及数量」（本卡口径：用既有的 qty_diff 承载）
          qtyDiff: Number(r.qtyDiff),
          // 参考数量：让档口自己核对「客户说差多少」——只读展示，不参与任何计算
          qtyReceived: item?.qtyReceived != null ? Number(item.qtyReceived) : null,
          qtyAccepted: item?.qtyAccepted != null ? Number(item.qtyAccepted) : null,
          status: r.status,
          statusText: AFTERSALE_STATUS_TEXT[r.status] ?? '未知',
          createdAt: r.createdAt.toISOString(),
          // 客户提交的内容：原因 + 现场照片（口径 6e：**能看**）
          reason: r.reason,
          attachments: Array.isArray(r.attachments) ? r.attachments : [],
          // 运营处理结果
          handleRemark: r.handleRemark,
          handledAt: r.handledAt ? r.handledAt.toISOString() : null,
          compensateAmount: r.compensateAmount != null ? Number(r.compensateAmount) : null,
          compensateMethod: r.compensateMethod ?? null,
          // 方式为空 = 仅致歉（口径见 common/utils/aftersale.util）
          compensateMethodText: r.compensateMethod != null
            ? AFTERSALE_METHOD_TEXT[r.compensateMethod] ?? null
            : null,
          compensateMethodEmptyText: AFTERSALE_METHOD_EMPTY_TEXT,
          // 归属（复核后必然有值；给前端展示档口名，避免页面自己写死）
          supplierId: info?.supplierId ?? null,
          supplierName: info?.supplierName ?? supplier.stallName,
          orderDeliveryDate: order?.deliveryDate ? order.deliveryDate.toISOString().slice(0, 10) : null,
        }
      }),
    }
  }
}
