import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { DispatchDto } from './dto/dispatch.dto'
import { CourierSettingDto } from './dto/courier-setting.dto'

/// 配送任务状态：0 待取货 / 1 配送中 / 3 已完成 / 4 异常
const TaskStatus = { PENDING_PICKUP: 0, DELIVERING: 1, DONE: 3, EXCEPTION: 4 } as const

@Injectable()
export class AdminDispatchService {
  constructor(private prisma: PrismaService) {}

  /// 各配送员当前未完成任务数
  private async activeTaskCounts(): Promise<Map<number, number>> {
    const tasks = await this.prisma.deliveryTask.findMany({
      where: { status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
      select: { courierId: true },
    })
    const map = new Map<number, number>()
    for (const t of tasks) {
      const cid = Number(t.courierId)
      map.set(cid, (map.get(cid) || 0) + 1)
    }
    return map
  }

  // ────────────────────────────────────────
  // 配送员列表（含接单状态 / 优先级 / 单量限制 / 当前任务数）
  // ────────────────────────────────────────
  async couriers() {
    const couriers = await this.prisma.courier.findMany({
      where: { status: 1 },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
      include: { user: true },
    })
    const taskCount = await this.activeTaskCounts()

    return couriers.map((c) => ({
      courierId: Number(c.id),
      phone: c.user?.phone || `配送员#${c.id}`,
      source: c.source,
      vehicleType: c.vehicleType,
      online: c.online,
      autoAccept: c.autoAccept,
      priority: c.priority,
      maxOrders: c.maxOrders,
      onRoute: c.onRoute,
      activeTasks: taskCount.get(Number(c.id)) || 0,
    }))
  }

  // ────────────────────────────────────────
  // 待派送订单（status=40 未派单）
  // ────────────────────────────────────────
  async list() {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.WAIT_DELIVERY },
      orderBy: { deliveryDate: 'asc' },
      include: { purchaser: true, _count: { select: { items: true } } },
    })

    return orders.map((o) => ({
      orderId: Number(o.id),
      shopName: o.purchaser.shopName,
      address: o.purchaser.address,
      deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
      timeWindow: o.timeWindow,
      itemCount: o._count.items,
    }))
  }

  // ────────────────────────────────────────
  // 手动派单：创建 delivery_task 并指派配送员
  // ────────────────────────────────────────
  async assign(dto: DispatchDto) {
    const courier = await this.prisma.courier.findUnique({ where: { id: BigInt(dto.courierId) } })
    if (!courier || courier.status !== 1) throw new BizException(ErrorCode.PARAM_ERROR, '配送员不存在或不可用')

    const orders = await this.prisma.order.findMany({
      where: { id: { in: dto.orderIds.map((id) => BigInt(id)) } },
      include: { purchaser: true },
    })
    const invalid = orders.filter((o) => o.status !== OrderStatus.WAIT_DELIVERY)
    if (invalid.length) throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '存在非待配送状态订单')

    const stationList = orders.map((o, i) => ({
      seq: i + 1,
      type: 'deliver',
      orderId: Number(o.id),
      shopName: o.purchaser.shopName,
      address: o.purchaser.address,
    }))

    const routeNo = `R${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(dto.courierId)}`

    const task = await this.prisma.$transaction(async (tx) => {
      const t = await tx.deliveryTask.create({
        data: { courierId: BigInt(dto.courierId), routeNo, stationList, status: 0 },
      })
      for (const o of orders) {
        await tx.order.update({ where: { id: o.id }, data: { status: OrderStatus.ASSIGNED } })
      }
      return t
    })

    return { taskId: Number(task.id), routeNo, orderCount: orders.length }
  }

  // ────────────────────────────────────────
  // 自动派单：在线 + 空闲 + 自动接单的配送员，按优先级依次派单（不超过单量限制）
  // ────────────────────────────────────────
  async autoAssign() {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.WAIT_DELIVERY },
      orderBy: { deliveryDate: 'asc' },
      include: { purchaser: true },
    })
    if (!orders.length) return { assigned: 0, skipped: [], note: '暂无待配送订单' }

    const couriers = await this.prisma.courier.findMany({
      where: { status: 1, online: 1, onRoute: 0, autoAccept: 1 },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    if (!couriers.length) {
      return { assigned: 0, skipped: orders.map((o) => Number(o.id)), note: '无可用自动接单配送员（需在线+空闲+自动接单）' }
    }

    const taskCount = await this.activeTaskCounts()
    const skipped: number[] = []
    let assigned = 0

    for (const order of orders) {
      // 找优先级最高、未超单量限制的配送员
      let target = null
      for (const c of couriers) {
        if ((taskCount.get(Number(c.id)) || 0) < c.maxOrders) {
          target = c
          break
        }
      }
      if (!target) {
        skipped.push(Number(order.id))
        continue
      }

      const stationList = [
        { seq: 1, type: 'deliver', orderId: Number(order.id), shopName: order.purchaser.shopName, address: order.purchaser.address },
      ]
      const routeNo = `R${order.deliveryDate.toISOString().slice(0, 10).replace(/-/g, '')}-${Number(target.id)}`

      await this.prisma.$transaction(async (tx) => {
        await tx.deliveryTask.create({
          data: { courierId: target!.id, routeNo, stationList, status: 0 },
        })
        await tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.ASSIGNED } })
      })

      taskCount.set(Number(target.id), (taskCount.get(Number(target.id)) || 0) + 1)
      assigned++
    }

    return { assigned, skipped }
  }

  // ────────────────────────────────────────
  // 设置配送员优先级 / 单量限制
  // ────────────────────────────────────────
  async updateSettings(courierId: number, dto: CourierSettingDto) {
    const courier = await this.prisma.courier.findUnique({ where: { id: BigInt(courierId) } })
    if (!courier) throw new BizException(ErrorCode.NOT_FOUND, '配送员不存在')

    const data: Record<string, number> = {}
    if (dto.priority !== undefined) data.priority = dto.priority
    if (dto.maxOrders !== undefined) data.maxOrders = dto.maxOrders

    await this.prisma.courier.update({ where: { id: BigInt(courierId) }, data })
    return { courierId, ...data }
  }
}
