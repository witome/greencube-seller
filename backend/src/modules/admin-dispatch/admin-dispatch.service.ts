import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { DispatchDto } from './dto/dispatch.dto'
import { CourierSettingDto } from './dto/courier-setting.dto'
import { AuditService } from '../audit/audit.service'

/// 配送任务状态：0 待取货 / 1 配送中 / 3 已完成 / 4 异常
const TaskStatus = { PENDING_PICKUP: 0, DELIVERING: 1, DEPARTED: 2, DONE: 3, EXCEPTION: 4 } as const
const TaskStatusText: Record<number, string> = { 0: '待取货', 1: '配送中', 2: '已出发', 3: '已完成', 4: '异常' }

@Injectable()
export class AdminDispatchService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /// 各配送员当前未完成任务数
  private async activeTaskCounts(): Promise<Map<number, number>> {
    const tasks = await this.prisma.deliveryTask.findMany({
      where: { status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING, TaskStatus.DEPARTED] } },
      select: { courierId: true },
    })
    const map = new Map<number, number>()
    for (const t of tasks) {
      const cid = Number(t.courierId)
      map.set(cid, (map.get(cid) || 0) + 1)
    }
    return map
  }

  /// 未完成任务的「已引用订单 id」集合（2026-09-12 派单积压卡：幂等防线①，
  /// 待配送单若已被任何未完成任务引用，绝不再派，杜绝定时重试与手动触发并发重复派单）
  private async activeTaskOrderRefs(): Promise<Set<number>> {
    const tasks = await this.prisma.deliveryTask.findMany({
      where: { status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING, TaskStatus.DEPARTED] } },
      select: { stationList: true },
    })
    const set = new Set<number>()
    for (const t of tasks) {
      const stations = Array.isArray(t.stationList) ? (t.stationList as any[]) : []
      for (const s of stations) {
        if (s && s.type === 'deliver' && s.orderId !== undefined) set.add(Number(s.orderId))
      }
    }
    return set
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
  // ────────────────────────────────────────
  // 配送任务（近期 20 条，含交付留证 proof，运营只读查看 2026-09-19 拍板卡）
  // proof 由配送员交付确认时写入，运营侧仅查看，不提供修改入口
  // ────────────────────────────────────────
  async recentTasks() {
    const tasks = await this.prisma.deliveryTask.findMany({
      orderBy: { id: 'desc' },
      take: 20,
    })
    // DeliveryTask 无 courier 关系字段，批量查配送员姓名（复用 couriers() 的 user.phone 口径）
    const courierIds = [...new Set(tasks.map((t) => Number(t.courierId)))]
    const couriers = await this.prisma.courier.findMany({
      where: { id: { in: courierIds.map((id) => BigInt(id)) } },
      include: { user: true },
    })
    const nameMap = new Map(couriers.map((c) => [Number(c.id), c.user?.phone || `配送员#${c.id}`]))

    return tasks.map((t) => {
      const stations = Array.isArray(t.stationList) ? (t.stationList as any[]) : []
      return {
        taskId: Number(t.id),
        courierId: Number(t.courierId),
        courierName: nameMap.get(Number(t.courierId)) || `配送员#${t.courierId}`,
        status: t.status,
        statusText: TaskStatusText[t.status] ?? String(t.status),
        orders: stations.filter((s) => s && s.type === 'deliver' && s.orderId !== undefined).map((s) => Number(s.orderId)),
        proof: t.proof ?? null,
        createdAt: t.createdAt,
      }
    })
  }

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
  async assign(operatorId: bigint, dto: DispatchDto) {
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

    await this.audit.log({
      operatorId,
      action: 'ASSIGN_DISPATCH',
      entity: 'delivery_task',
      entityId: Number(task.id),
      before: null,
      after: { courierId: dto.courierId, routeNo, orderIds: dto.orderIds },
    })

    return { taskId: Number(task.id), routeNo, orderCount: orders.length }
  }

  // ────────────────────────────────────────
  // 自动派单：在线 + 空闲 + 自动接单的配送员，按优先级依次派单（不超过单量限制）
  // ────────────────────────────────────────
  async autoAssign(operatorId: bigint) {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.WAIT_DELIVERY },
      orderBy: { deliveryDate: 'asc' },
      include: { purchaser: true },
    })
    if (!orders.length) return { assigned: 0, skipped: [], note: '暂无待配送订单' }

    const couriers = await this.prisma.courier.findMany({
      where: { status: 1, online: 1, onRoute: 0 },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    if (!couriers.length) {
      return { assigned: 0, skipped: orders.map((o) => Number(o.id)), note: '无可用配送员（需在线+空闲）' }
    }

    const taskCount = await this.activeTaskCounts()
    const taskRefs = await this.activeTaskOrderRefs()
    const skipped: number[] = []
    let assigned = 0

    for (const order of orders) {
      // 幂等防线①：已被未完成任务引用的订单直接跳过（正常不会出现：派单与状态推进同事务；
      // 防御的是异常残留/并发触发场景）
      if (taskRefs.has(Number(order.id))) {
        skipped.push(Number(order.id))
        continue
      }
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

      let claimedOk = true
      await this.prisma.$transaction(async (tx) => {
        // 幂等防线②：事务内按 status=40 条件「认领」订单，认领失败（已被并发派单/取消）则放弃
        const claimed = await tx.order.updateMany({
          where: { id: order.id, status: OrderStatus.WAIT_DELIVERY },
          data: { status: OrderStatus.ASSIGNED },
        })
        if (claimed.count === 0) {
          claimedOk = false
          skipped.push(Number(order.id))
          return
        }
        await tx.deliveryTask.create({
          data: { courierId: target!.id, routeNo, stationList, status: 0 },
        })
      })
      if (!claimedOk) continue

      taskCount.set(Number(target.id), (taskCount.get(Number(target.id)) || 0) + 1)
      assigned++
    }

    if (assigned > 0) {
      await this.audit.log({
        operatorId,
        action: 'AUTO_ASSIGN_DISPATCH',
        entity: 'delivery_task',
        entityId: 0,
        before: null,
        after: { assigned, skipped },
      })
    }

    return { assigned, skipped }
  }

  // ────────────────────────────────────────
  // 设置配送员优先级 / 单量限制
  // ────────────────────────────────────────
  async updateSettings(operatorId: bigint, courierId: number, dto: CourierSettingDto) {
    const courier = await this.prisma.courier.findUnique({ where: { id: BigInt(courierId) } })
    if (!courier) throw new BizException(ErrorCode.NOT_FOUND, '配送员不存在')

    const data: Record<string, number> = {}
    if (dto.priority !== undefined) data.priority = dto.priority
    if (dto.maxOrders !== undefined) data.maxOrders = dto.maxOrders

    await this.prisma.courier.update({ where: { id: BigInt(courierId) }, data })

    await this.audit.log({
      operatorId,
      action: 'UPDATE_COURIER_SETTINGS',
      entity: 'courier',
      entityId: courierId,
      before: { priority: courier.priority, maxOrders: courier.maxOrders },
      after: data,
    })

    return { courierId, ...data }
  }

  // ────────────────────────────────────────
  // 配送异常工单列表（配送员上报后生成，运营处理）
  // ────────────────────────────────────────
  async exceptions(query: { status?: string }) {
    const where: any = {}
    if (query.status !== undefined && query.status !== '') where.status = parseInt(query.status)

    const rows = await this.prisma.deliveryException.findMany({
      where,
      orderBy: [{ status: 'asc' }, { id: 'desc' }],
    })

    // 手动查配送任务（取路线号 + 关联订单）
    const taskIds = [...new Set(rows.filter((r) => r.deliveryTaskId).map((r) => Number(r.deliveryTaskId)))]
    const tasks = taskIds.length ? await this.prisma.deliveryTask.findMany({ where: { id: { in: taskIds.map((id) => BigInt(id)) } } }) : []
    const taskMap = new Map(tasks.map((t) => [Number(t.id), t]))

    // 收集所有关联订单 ID
    const allOrderIds = new Set<number>()
    for (const e of rows) {
      if (e.orderId) allOrderIds.add(Number(e.orderId))
      if (e.deliveryTaskId) {
        const task = taskMap.get(Number(e.deliveryTaskId))
        if (task) {
          const stations = Array.isArray(task.stationList) ? task.stationList : []
          stations.filter((s: any) => s.type === 'deliver' && s.orderId).forEach((s: any) => allOrderIds.add(Number(s.orderId)))
        }
      }
    }

    // 查订单详情（餐馆 + 商品明细）
    const orders = allOrderIds.size
      ? await this.prisma.order.findMany({
          where: { id: { in: [...allOrderIds].map((id) => BigInt(id)) } },
          include: { purchaser: true, items: { include: { product: true } } },
        })
      : []
    const orderMap = new Map(orders.map((o) => [Number(o.id), o]))

    return rows.map((e) => {
      const linkedOrderIds: number[] = []
      if (e.orderId) linkedOrderIds.push(Number(e.orderId))
      if (e.deliveryTaskId) {
        const task = taskMap.get(Number(e.deliveryTaskId))
        if (task) {
          const stations = Array.isArray(task.stationList) ? task.stationList : []
          stations.filter((s: any) => s.type === 'deliver' && s.orderId).forEach((s: any) => linkedOrderIds.push(Number(s.orderId)))
        }
      }

      return {
        exceptionId: Number(e.id),
        deliveryTaskId: e.deliveryTaskId ? Number(e.deliveryTaskId) : null,
        routeNo: e.deliveryTaskId ? (taskMap.get(Number(e.deliveryTaskId))?.routeNo ?? null) : null,
        courierId: Number(e.courierId),
        orderId: e.orderId ? Number(e.orderId) : null,
        reason: e.reason,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        // 关联订单详情（餐馆 + 商品明细），供点击查看
        orders: linkedOrderIds.map((oid) => {
          const o = orderMap.get(oid)
          if (!o) return { orderId: oid, shopName: null, deliveryDate: null, items: [] }
          return {
            orderId: oid,
            shopName: o.purchaser?.shopName ?? '',
            deliveryDate: o.deliveryDate.toISOString().slice(0, 10),
            items: o.items.map((it) => ({ name: it.product?.name ?? '', qty: Number(it.qtyOrdered), unit: it.product?.unit ?? '' })),
          }
        }),
      }
    })
  }

  // ────────────────────────────────────────
  // 处理异常工单（标记已处理）
  // ────────────────────────────────────────
  async handleException(id: number, operatorId: bigint) {
    const exception = await this.prisma.deliveryException.findUnique({ where: { id: BigInt(id) } })
    if (!exception) throw new BizException(ErrorCode.NOT_FOUND, '异常工单不存在')

    // 恢复异常订单为正常配送：根据是否已取货，恢复到「已派单(45)」或「配送中(50)」
    let resumed = false
    let orderFromStatus: number | null = null
    let orderToStatus: number | null = null
    if (exception.orderId) {
      let targetStatus: number = OrderStatus.DELIVERING
      if (exception.deliveryTaskId) {
        const task = await this.prisma.deliveryTask.findUnique({ where: { id: exception.deliveryTaskId } })
        const stations = Array.isArray(task?.stationList) ? (task!.stationList as any[]) : []
        const station = stations.find((s: any) => s.type === 'deliver' && Number(s.orderId) === Number(exception.orderId))
        if (station && station.picked !== true) targetStatus = OrderStatus.ASSIGNED
      }
      const orderBefore = await this.prisma.order.findUnique({
        where: { id: exception.orderId },
        select: { status: true },
      })
      orderFromStatus = orderBefore ? orderBefore.status : null
      orderToStatus = targetStatus
      resumed = true
    }

    // 事务（2026-09-19 卡B 涉订单状态收口）：订单状态复位 + 异常工单置已处理 要么都成、要么都不成。
    // 原实现两条 update 分离：订单已复位但工单仍挂着，运营会重复处理 / 状态自相矛盾
    await this.prisma.$transaction([
      ...(exception.orderId && orderToStatus !== null
        ? [this.prisma.order.update({ where: { id: exception.orderId }, data: { status: orderToStatus } })]
        : []),
      this.prisma.deliveryException.update({
        where: { id: BigInt(id) },
        data: { status: 1, handledBy: operatorId, handledAt: new Date() },
      }),
    ])

    // 铁律 3：处理异常工单会推进订单状态（92 无法交付 → 45/50），属关键操作，全量写审计
    // （2026-09-11 补，闭合审计复核缺口 G1）
    await this.audit.log({
      operatorId,
      action: 'HANDLE_DELIVERY_EXCEPTION',
      entity: 'delivery_exception',
      entityId: id,
      before: { status: exception.status, orderStatus: orderFromStatus },
      after: {
        status: 1,
        exceptionId: id,
        orderId: exception.orderId ? Number(exception.orderId) : null,
        fromStatus: orderFromStatus,
        toStatus: orderToStatus,
      },
    })

    return { exceptionId: id, status: 1, resumed }
  }
}
