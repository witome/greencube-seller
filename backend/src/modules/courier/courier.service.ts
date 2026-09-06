import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { DeliverDto, ReportDto } from './dto/courier.dto'

/// 配送任务状态：0 待取货 / 1 配送中 / 3 已完成 / 4 异常
const TaskStatus = { PENDING_PICKUP: 0, DELIVERING: 1, DONE: 3, EXCEPTION: 4 } as const

@Injectable()
export class CourierService {
  constructor(private prisma: PrismaService) {}

  private async getCourier(userId: bigint) {
    const courier = await this.prisma.courier.findUnique({ where: { userId } })
    if (!courier) throw new BizException(ErrorCode.FORBIDDEN, '当前账号不是配送员')
    if (courier.status !== 1) throw new BizException(ErrorCode.FORBIDDEN, '配送员账号不可用')
    return courier
  }

  /// 从任务站点里提取订单 ID（stationList JSON）
  private orderIdsOf(task: any): number[] {
    const stations = Array.isArray(task.stationList) ? task.stationList : []
    return stations
      .filter((s: any) => s.type === 'deliver' && s.orderId)
      .map((s: any) => Number(s.orderId))
  }

  // ────────────────────────────────────────
  // 今日任务与站点序列
  // ⚠️ 铁律：配送员接口永不返回任何金额字段
  // ────────────────────────────────────────
  async todayTasks(userId: bigint) {
    const courier = await this.getCourier(userId)
    const tasks = await this.prisma.deliveryTask.findMany({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
      orderBy: { id: 'asc' },
    })

    return tasks.map((t) => ({
      taskId: Number(t.id),
      routeNo: t.routeNo,
      status: t.status,
      stationList: t.stationList,
    }))
  }

  // ────────────────────────────────────────
  // 扫码取货：任务 0→1，订单 40→50
  // ────────────────────────────────────────
  async pickup(userId: bigint, taskId: number) {
    const courier = await this.getCourier(userId)
    const task = await this.prisma.deliveryTask.findFirst({
      where: { id: BigInt(taskId), courierId: courier.id },
    })
    if (!task) throw new BizException(ErrorCode.NOT_FOUND, '任务不存在')
    if (task.status !== TaskStatus.PENDING_PICKUP) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '任务状态不允许取货')
    }

    const orderIds = this.orderIdsOf(task)
    await this.prisma.$transaction([
      this.prisma.deliveryTask.update({ where: { id: task.id }, data: { status: TaskStatus.DELIVERING } }),
      ...orderIds.map((oid) =>
        this.prisma.order.updateMany({
          where: { id: BigInt(oid), status: { in: [OrderStatus.ASSIGNED, OrderStatus.WAIT_DELIVERY] } },
          data: { status: OrderStatus.DELIVERING },
        }),
      ),
    ])

    return { taskId, status: TaskStatus.DELIVERING }
  }

  // ────────────────────────────────────────
  // 交付确认：任务→3，订单 50→60（已送达）
  // ────────────────────────────────────────
  async deliver(userId: bigint, taskId: number, dto: DeliverDto) {
    const courier = await this.getCourier(userId)
    const task = await this.prisma.deliveryTask.findFirst({
      where: { id: BigInt(taskId), courierId: courier.id },
    })
    if (!task) throw new BizException(ErrorCode.NOT_FOUND, '任务不存在')
    if (task.status !== TaskStatus.DELIVERING) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '任务状态不允许交付确认')
    }

    const orderIds = this.orderIdsOf(task)
    await this.prisma.$transaction([
      this.prisma.deliveryTask.update({
        where: { id: task.id },
        data: { status: TaskStatus.DONE, proof: { photos: dto.photos, signature: dto.signature, remark: dto.remark } },
      }),
      ...orderIds.map((oid) =>
        this.prisma.order.updateMany({
          where: { id: BigInt(oid), status: OrderStatus.DELIVERING },
          data: { status: OrderStatus.DELIVERED },
        }),
      ),
    ])

    // 全部任务配送完成后，恢复可接单资格（onRoute → 0）
    const remaining = await this.prisma.deliveryTask.count({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
    })
    if (remaining === 0) {
      await this.prisma.courier.update({ where: { id: courier.id }, data: { onRoute: 0 } })
    }

    return { taskId, status: TaskStatus.DONE, deliveredOrders: orderIds.length, resumed: remaining === 0 }
  }

  // ────────────────────────────────────────
  // 异常上报（记录到审计日志，后续可扩展独立工单表）
  // ────────────────────────────────────────
  async report(userId: bigint, dto: ReportDto) {
    const courier = await this.getCourier(userId)
    await this.prisma.auditLog.create({
      data: {
        operatorId: courier.userId,
        action: 'courier_report',
        entity: 'delivery_task',
        entityId: BigInt(dto.taskId ?? 0),
        after: { reason: dto.reason, photos: dto.photos },
      },
    })
    return { reported: true }
  }

  // ────────────────────────────────────────
  // 收款协助：仅展示统一支付码 + 标记「客户称已支付」
  // ⚠️ 铁律：不返回金额、不作核销依据，以服务端回调为准
  // ────────────────────────────────────────
  async markPaid(userId: bigint, orderId: number) {
    await this.getCourier(userId)
    const order = await this.prisma.order.findUnique({ where: { id: BigInt(orderId) } })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')

    return {
      orderId,
      payQrUrl: 'oss://pay/qr/demo.png', // 平台统一收款码（占位）
      note: '客户称已支付，实际以服务端支付回调为准，配送员不作核销',
    }
  }

  // ────────────────────────────────────────
  // 接单状态查询（上下线 / 接单模式 / 配送中 / 当前任务数）
  // ────────────────────────────────────────
  async getStatus(userId: bigint) {
    const courier = await this.getCourier(userId)
    const activeTasks = await this.prisma.deliveryTask.count({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
    })
    return {
      courierId: Number(courier.id),
      online: courier.online,
      autoAccept: courier.autoAccept,
      onRoute: courier.onRoute,
      activeTasks,
    }
  }

  // ────────────────────────────────────────
  // 上下线（仅上线可接单）
  // ────────────────────────────────────────
  async setOnline(userId: bigint, online: number) {
    const courier = await this.getCourier(userId)
    const val = online ? 1 : 0
    await this.prisma.courier.update({ where: { id: courier.id }, data: { online: val } })
    return { courierId: Number(courier.id), online: val }
  }

  // ────────────────────────────────────────
  // 接单模式（0 手动 / 1 自动接单）
  // ────────────────────────────────────────
  async setAutoAccept(userId: bigint, autoAccept: number) {
    const courier = await this.getCourier(userId)
    const val = autoAccept ? 1 : 0
    await this.prisma.courier.update({ where: { id: courier.id }, data: { autoAccept: val } })
    return { courierId: Number(courier.id), autoAccept: val }
  }

  // ────────────────────────────────────────
  // 出发：取完所有安排订单后点「出发」，进入配送中，无法接新单；
  // 配送完当前所有任务后自动恢复可接单（见 deliver）
  // ────────────────────────────────────────
  async depart(userId: bigint) {
    const courier = await this.getCourier(userId)
    const active = await this.prisma.deliveryTask.findMany({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
    })
    if (!active.length) throw new BizException(ErrorCode.PARAM_ERROR, '暂无待配送任务，无需出发')

    await this.prisma.courier.update({ where: { id: courier.id }, data: { onRoute: 1 } })
    return { courierId: Number(courier.id), onRoute: 1 }
  }
}
