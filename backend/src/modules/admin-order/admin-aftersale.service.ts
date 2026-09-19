import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { AftersaleHandleDto } from './dto/aftersale-handle.dto'

/// 售后工单状态（schema 注释：待处理/处理中/已解决/已关闭）
export const AFTERSALE_STATUS = {
  PENDING: 0,
  PROCESSING: 1,
  RESOLVED: 2,
  CLOSED: 3,
} as const

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

  /// 售后工单列表（分页 + 状态/类型筛选）
  async list(query: { status?: string; type?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))

    const where: any = {}
    if (query.status !== undefined && query.status !== '') where.status = parseInt(query.status)
    if (query.type) where.type = parseInt(query.type)

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

    return {
      total,
      list: rows.map((r) => this.toVo(r, false, orderMap)),
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
    return this.toVo(row, true, orderMap)
  }

  /// 处理工单：同意补偿 / 驳回 / 关闭
  async handle(id: number, operatorId: bigint, dto: AftersaleHandleDto) {
    const row = await this.prisma.aftersaleOrder.findUnique({ where: { id: BigInt(id) } })
    if (!row) throw new BizException(ErrorCode.NOT_FOUND, '售后工单不存在')

    const before = { status: row.status }
    const now = new Date()
    let nextStatus: number
    const data: any = { handledBy: operatorId, handledAt: now }

    if (dto.action === 'compensate') {
      if (row.status === AFTERSALE_STATUS.CLOSED) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '工单已关闭，不可再处理')
      }
      if (dto.compensateAmount === undefined || dto.compensateMethod === undefined) {
        throw new BizException(ErrorCode.PARAM_ERROR, '同意补偿必须填写补偿金额与补偿方式')
      }
      nextStatus = AFTERSALE_STATUS.RESOLVED
      data.status = nextStatus
      data.compensateAmount = dto.compensateAmount
      data.compensateMethod = dto.compensateMethod
      data.handleRemark = dto.handleRemark ?? null
    } else if (dto.action === 'reject') {
      if (row.status === AFTERSALE_STATUS.CLOSED) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '工单已关闭，不可再处理')
      }
      if (!dto.handleRemark) {
        throw new BizException(ErrorCode.PARAM_ERROR, '驳回必须填写原因')
      }
      nextStatus = AFTERSALE_STATUS.CLOSED
      data.status = nextStatus
      data.handleRemark = dto.handleRemark
    } else {
      // close：一般从「已解决」收口关闭；待处理工单也可直接关闭（如重复提交）
      if (row.status === AFTERSALE_STATUS.CLOSED) {
        throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '工单已关闭，请勿重复操作')
      }
      nextStatus = AFTERSALE_STATUS.CLOSED
      data.status = nextStatus
      data.handleRemark = dto.handleRemark ?? row.handleRemark
    }

    const updated = await this.prisma.aftersaleOrder.update({ where: { id: BigInt(id) }, data })

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

  private toVo(r: any, withItems = false, orderMap?: Map<number, any>) {
    const order = orderMap?.get(Number(r.orderId))
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
      handleRemark: r.handleRemark,
      // 采购方拍照留证（/uploads/xxx 相对路径数组）：Prisma Json 原样返回；null/非数组统一成 []（与 buyer.service toVo 同口径）
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      handledBy: r.handledBy != null ? Number(r.handledBy) : null,
      handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
      shopName: order?.purchaser?.shopName ?? null,
      orderStatus: order?.status ?? null,
      deliveryDate: order?.deliveryDate ? order.deliveryDate.toISOString().slice(0, 10) : null,
    }
    if (withItems && order?.items) {
      vo.orderItems = order.items.map((it: any) => ({
        orderItemId: Number(it.id),
        name: it.product?.name ?? '',
        qtyOrdered: Number(it.qtyOrdered),
        qtyAccepted: it.qtyAccepted != null ? Number(it.qtyAccepted) : null,
        salePrice: Number(it.salePrice),
      }))
    }
    return vo
  }
}
