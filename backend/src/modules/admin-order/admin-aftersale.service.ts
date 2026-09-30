import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { AftersaleHandleDto } from './dto/aftersale-handle.dto'
import {
  AFTERSALE_STATUS,
  AFTERSALE_UNASSIGNED_TEXT,
  AFTERSALE_METHOD_EMPTY_TEXT,
  resolveAftersaleSuppliers,
  resolveAftersaleSupplier,
  type AftersaleSupplierInfo,
} from '../../common/utils/aftersale.util'

/// 售后工单状态（schema 注释：待处理/处理中/已解决/已关闭）
/// 卡AE（2026-09-30）：定义已上移到 common/utils/aftersale.util（buyer / supplier 侧也要用同一份），
/// 这里保留同名 re-export，既有引用点一行不用改。
export { AFTERSALE_STATUS } from '../../common/utils/aftersale.util'

const STATUS_TEXT: Record<number, string> = {
  0: '待处理',
  1: '处理中',
  2: '已解决',
  3: '已关闭',
}

const TYPE_TEXT: Record<number, string> = { 1: '少货', 2: '品质问题', 3: '错货', 4: '其他' }
const COMPENSATE_METHOD_TEXT: Record<number, string> = { 1: '退款', 2: '补货', 3: '下次账单抵扣' }

/**
 * 运营 · 售后管理（修复单缺陷 3，2026-09-10 新增）
 * 采购方提交的售后工单此前只能 pending，此服务补齐查询/处理/状态流转。
 * 状态机：0 待处理 →(compensate) 2 已解决 →(close) 3 已关闭；0 →(reject) 3 已关闭；3 为终态。
 */
@Injectable()
export class AdminAftersaleService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /// 售后工单列表（分页 + 状态/类型/供应商筛选）
  /// 卡AE（2026-09-30）：新增 `supplierId` 筛选 —— 非数字或空 = 全部供应商；
  /// 归属不到供应商的工单（未拆单 / 明细缺失）在列表里显示「待分派」。
  async list(query: { status?: string; type?: string; supplierId?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))

    const where: any = {}
    if (query.status !== undefined && query.status !== '') where.status = parseInt(query.status)
    if (query.type) where.type = parseInt(query.type)

    // 供应商筛选：先把该供应商名下的明细 id 捞出来，再按 order_item_id 收敛工单集合
    // （归属链的唯一实现在 common/utils/aftersale.util，此处只做「按归属过滤」的前半段）
    const supplierId = Number(query.supplierId)
    if (Number.isInteger(supplierId) && supplierId > 0) {
      const items = await this.prisma.orderItem.findMany({
        where: { supplierId: BigInt(supplierId) },
        select: { id: true },
      })
      where.orderItemId = { in: items.map((it) => it.id) }
    }

    const [total, rows] = await Promise.all([
      this.prisma.aftersaleOrder.count({ where }),
      this.prisma.aftersaleOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    // AftersaleOrder 无 relation 字段，批量查订单/采购方组装
    const orderIds = [...new Set(rows.map((r) => r.orderId))]
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: { purchaser: true },
    })
    const orderMap: Map<number, any> = new Map()
    for (const o of orders) orderMap.set(Number(o.id), o)

    // 卡AE：供应商归属 —— 走全仓唯一实现（与客户侧回显 / 供应商端列表同一份口径）
    const supplierMap = await resolveAftersaleSuppliers(this.prisma, rows.map((r) => r.orderItemId))

    return {
      total,
      list: rows.map((r) => this.toVo(r, false, orderMap, supplierMap.get(String(r.orderItemId)))),
    }
  }

  /// 售后工单详情
  async detail(id: number) {
    const row = await this.prisma.aftersaleOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new BizException(ErrorCode.NOT_FOUND, '售后工单不存在')

    const order = await this.prisma.order.findUnique({
      where: { id: row.orderId },
      include: { purchaser: true, items: { include: { product: true } } },
    })
    const orderMap: Map<number, any> = new Map()
    if (order) orderMap.set(Number(order.id), order)
    const supplier = await resolveAftersaleSupplier(this.prisma, row.orderItemId)
    return this.toVo(row, true, orderMap, supplier)
  }

  /// 处理工单：**处理完成**（= 原 compensate 路径）/ 驳回 / 关闭
  ///
  /// 卡AE（2026-09-30）口径，别按老版本理解：
  ///   · 语义改为「处理完成」—— 运营线下谈完，点一下把结果落库；
  ///     现有 compensate / reject / close 三个动作**保留可用**，未新增动作
  ///   · `handleRemark` **必填**（空 / 纯空格都算空；trim 后再判）
  ///   · `compensateAmount` / `compensateMethod` **改为选填** —— 都不传也能完成
  ///     ⚠️ 口径：**金额为空 → 落 null；方式为空 → 落 null，业务语义即「仅致歉」**
  ///        （大辉 2026-09-30 确认：不新增 compensate_method=4 枚举值，
  ///          「方式为空」就是「仅致歉」，展示侧把 null 显示成「仅致歉」）
  ///   · 处理完成写 handledBy / handledAt，状态转 2（已解决）
  ///   · 本方法**只写 aftersale_order 一行 + 审计日志**：不改订单金额/状态、不扣结算、不改账单
  ///     （红线 1/2 的技术保障，本卡刻意保持这个「只记录」行为不变）
  async handle(id: number, operatorId: bigint, dto: AftersaleHandleDto) {
    const row = await this.prisma.aftersaleOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new BizException(ErrorCode.NOT_FOUND, '售后工单不存在')

    const before = { status: row.status }
    const now = new Date()
    const remark = (dto.handleRemark ?? '').trim()
    let nextStatus: number
    const data: any = { handledBy: operatorId, handledAt: now }

    if (dto.action === 'compensate') {
      // 「处理完成」：说明必填，补偿金额/方式选填
      if (row.status === AFTERSALE_STATUS.CLOSED) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '工单已关闭，不可再处理')
      }
      if (!remark) {
        throw new BizException(ErrorCode.PARAM_ERROR, '请填写处理说明')
      }
      nextStatus = AFTERSALE_STATUS.RESOLVED
      data.status = nextStatus
      data.compensateAmount = dto.compensateAmount ?? null
      // 方式为空 = 仅致歉（不新增枚举值，见方法头注释）
      data.compensateMethod = dto.compensateMethod ?? null
      data.handleRemark = remark
    } else if (dto.action === 'reject') {
      if (row.status === AFTERSALE_STATUS.CLOSED) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '工单已关闭，不可再处理')
      }
      if (!remark) {
        throw new BizException(ErrorCode.PARAM_ERROR, '驳回必须填写原因')
      }
      nextStatus = AFTERSALE_STATUS.CLOSED
      data.status = nextStatus
      data.handleRemark = remark
    } else {
      // close：一般从「已解决」收口关闭；待处理工单也可直接关闭（如重复提交）
      if (row.status === AFTERSALE_STATUS.CLOSED) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '工单已关闭，请勿重复操作')
      }
      nextStatus = AFTERSALE_STATUS.CLOSED
      data.status = nextStatus
      data.handleRemark = remark || row.handleRemark
    }

    const updated = await this.prisma.aftersaleOrder.update({ where: { id: BigInt(id) }, data })

    // 铁律 3：运营处理售后＝状态变更，写审计。
    // ⚠️ payload 只记状态跃迁 + 动作 + 补偿数字 + 订单 id：
    //    **不记 handleRemark 正文**（可能夹带客户联系方式等 PII），也不记任何客户 PII。
    await this.audit.log({
      operatorId,
      action: 'AFTERSALE_HANDLE',
      entity: 'aftersale',
      entityId: id,
      before,
      after: {
        status: nextStatus,
        action: dto.action,
        compensateAmount: dto.compensateAmount ?? null,
        compensateMethod: dto.compensateMethod ?? null,
        orderId: Number(row.orderId),
      },
    })

    return {
      aftersaleId: Number(updated.id),
      status: updated.status,
      statusText: STATUS_TEXT[updated.status],
    }
  }

  private toVo(r: any, withItems = false, orderMap?: Map<number, any>, supplier?: AftersaleSupplierInfo) {
    const order = orderMap?.get(Number(r.orderId))
    const sup = supplier ?? { supplierId: null, supplierName: null, assigned: false }
    const vo: any = {
      aftersaleId: Number(r.id),
      orderId: Number(r.orderId),
      orderItemId: Number(r.orderItemId),
      type: r.type,
      typeText: TYPE_TEXT[r.type] ?? '其他',
      reason: r.reason,
      qtyDiff: Number(r.qtyDiff),
      amountDiff: Number(r.amountDiff),
      status: r.status,
      statusText: STATUS_TEXT[r.status] ?? '未知',
      compensateAmount: r.compensateAmount != null ? Number(r.compensateAmount) : null,
      compensateMethod: r.compensateMethod ?? null,
      compensateMethodText: r.compensateMethod != null ? COMPENSATE_METHOD_TEXT[r.compensateMethod] ?? null : null,
      // 补偿方式为空 = 仅致歉（见 handle() 头注释口径）；处理完成且无金额时前端据此渲染
      compensateMethodEmptyText: AFTERSALE_METHOD_EMPTY_TEXT,
      handleRemark: r.handleRemark,
      // 采购方拍照留证（/uploads/xxx 相对路径数组）：Prisma Json 原样返回；null/非数组统一成 []（与 buyer.service toVo 同口径）
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      handledBy: r.handledBy != null ? Number(r.handledBy) : null,
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      shopName: order?.purchaser?.shopName ?? null,
      orderStatus: order?.status ?? null,
      deliveryDate: order?.deliveryDate ? order.deliveryDate.toISOString().slice(0, 10) : null,
      // 卡AE：归属供应商（未拆单 / 明细缺失 → assigned=false，列表显示「待分派」）
      supplierId: sup.supplierId,
      supplierName: sup.supplierName,
      supplierAssigned: sup.assigned,
      supplierText: sup.supplierName ?? AFTERSALE_UNASSIGNED_TEXT,
    }
    if (withItems && order?.items) {
      vo.orderItems = order.items.map((it: any) => ({
        orderItemId: Number(it.id),
        name: it.product?.name ?? '',
        qtyOrdered: Number(it.qtyOrdered),
        qtyAccepted: it.qtyAccepted != null ? Number(it.qtyAccepted) : null,
        qtyReceived: it.qtyReceived != null ? Number(it.qtyReceived) : null,
        rejectReason: it.rejectReason,
        salePrice: Number(it.salePrice),
      }))
    }
    return vo
  }
}
