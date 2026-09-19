import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, OrderStatus } from '../../common/constants/error-codes'
import { DeliverDto, ReportDto, PayProofDto } from './dto/courier.dto'
import { AuditService } from '../audit/audit.service'

/// 配送任务状态：0 待取货 / 1 已取货待出发 / 2 已出发配送中 / 3 已完成 / 4 异常
const TaskStatus = { PENDING_PICKUP: 0, DELIVERING: 1, DEPARTED: 2, DONE: 3, EXCEPTION: 4 } as const

@Injectable()
export class CourierService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

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
  // 审核状态查询（2026-09-19 拍板卡）：供小程序「审核中」页 onShow/轮询
  // 返回结构与 /buyer/pending 完全一致（accountStatus/submittedAt/overdue/steps/rejectInfo）
  // 状态口径：0 待审核(申请制注册显式写入) / 1 正常(=通过) / 2 停用 / 9 黑名单
  // ⚠️ trialStatus 是试跑期标记（前 7 单），与审核无关，不参与本接口
  // 只按 token 的 userId 取自己的档案，只读接口不审计；不复用 getCourier（其拒绝非 1 状态）
  // ────────────────────────────────────────
  async pending(userId: bigint) {
    const courier = await this.prisma.courier.findUnique({ where: { userId } })
    if (!courier) throw new BizException(ErrorCode.NOT_FOUND, '未找到配送员档案')

    const submittedAt = courier.createdAt
    const overdue = Date.now() - submittedAt.getTime() > 24 * 3600 * 1000

    let steps
    if (courier.status === 0) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实中', status: 'active', time: null },
        { key: 'active', label: '审核通过', status: 'todo', time: null },
      ]
    } else if (courier.status === 2 || courier.status === 9) {
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

    const rejectInfo =
      courier.status === 2
        ? { reason: '配送员账号已停用，请联系运营', reasonCode: 'COURIER_SUSPENDED' }
        : courier.status === 9
          ? { reason: '账号已被列入黑名单，如有疑问请联系运营', reasonCode: 'COURIER_BLACKLIST' }
          : null

    return {
      accountStatus: courier.status,
      submittedAt: submittedAt.toISOString(),
      overdue,
      steps,
      rejectInfo,
    }
  }

  // ────────────────────────────────────────
  // 今日任务：进行中（待取货/配送中）+ 今日已完成
  // ⚠️ 铁律：配送员接口永不返回任何金额字段
  // ────────────────────────────────────────
  async todayTasks(userId: bigint) {
    const courier = await this.getCourier(userId)
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tasks = await this.prisma.deliveryTask.findMany({
      where: {
        courierId: courier.id,
        OR: [
          { status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING, TaskStatus.DEPARTED, TaskStatus.EXCEPTION] } },
          { status: TaskStatus.DONE, completedAt: { gte: todayStart } },
        ],
      },
      // 稳定按任务 id 排序：取货导致任务 status 变化时不再重排，保持配送员看到的顺序不变
      orderBy: [{ id: 'asc' }],
    })

    // 收集所有订单 ID，查货物明细（商品名 + 数量，⚠️ 不含金额）
    const orderIds = [...new Set(tasks.flatMap((t) => this.orderIdsOf(t)))]
    const orderItems = orderIds.length
      ? await this.prisma.orderItem.findMany({
          where: { orderId: { in: orderIds.map((id) => BigInt(id)) } },
          include: { product: true },
        })
      : []
    const itemMap = new Map<number, { name: string; qty: number; unit: string }[]>()
    for (const it of orderItems) {
      const key = Number(it.orderId)
      if (!itemMap.has(key)) itemMap.set(key, [])
      itemMap.get(key)!.push({ name: it.product?.name ?? '', qty: Number(it.qtyOrdered), unit: it.product?.unit ?? '' })
    }

    // 查异常订单（无法交付），供前端标记「异常订单」分类
    const abnormalOrders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds.map((id) => BigInt(id)) }, status: OrderStatus.UNDELIVERABLE },
          select: { id: true },
        })
      : []
    const abnormalSet = new Set(abnormalOrders.map((o) => Number(o.id)))

    // 查订单支付方式：货到付款(2)订单在今日任务里显示「货到付款」按钮
    const orderPayments = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds.map((id) => BigInt(id)) } },
          select: { id: true, payMethod: true },
        })
      : []
    const payMap = new Map(orderPayments.map((o) => [Number(o.id), o.payMethod]))

    return tasks.map((t) => ({
      taskId: Number(t.id),
      routeNo: t.routeNo,
      status: t.status,
      stationList: (Array.isArray(t.stationList) ? t.stationList : []).map((s: any) => {
        if (s.type === 'deliver' && s.orderId) {
          return { ...s, items: itemMap.get(Number(s.orderId)) ?? [], abnormal: abnormalSet.has(Number(s.orderId)), payMethod: payMap.get(Number(s.orderId)) ?? null }
        }
        return s
      }),
    }))
  }

  // ────────────────────────────────────────
  // 扫码取货（任务级一键取货）：任务 0→1，订单 40→50
  // 同时标记所有货物 picked=true，与订单级取货保持一致
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
    // 标记所有货物已取，保持与订单级取货一致
    const stations = (Array.isArray(task.stationList) ? task.stationList : []).map((s: any) => {
      if (s.type === 'deliver') return { ...s, picked: true }
      return s
    })

    await this.prisma.$transaction([
      this.prisma.deliveryTask.update({ where: { id: task.id }, data: { stationList: stations, status: TaskStatus.DELIVERING } }),
      ...orderIds.map((oid) =>
        this.prisma.order.updateMany({
          where: { id: BigInt(oid), status: { in: [OrderStatus.ASSIGNED, OrderStatus.WAIT_DELIVERY] } },
          data: { status: OrderStatus.DELIVERING },
        }),
      ),
    ])

    // 铁律 3：取货推进交付链路（任务 0→1、订单 45/40→50），写审计（2026-09-11 补，闭合 S2）
    await this.audit.log({
      operatorId: courier.userId,
      action: 'COURIER_PICKUP',
      entity: 'delivery_task',
      entityId: taskId,
      before: { taskStatus: task.status },
      after: { taskStatus: TaskStatus.DELIVERING, orderIds },
    })

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
    // 已出发(2)或异常(4)任务可交付确认：异常任务完成时异常订单(92)保持不变，仅正常订单交付
    if (task.status !== TaskStatus.DEPARTED && task.status !== TaskStatus.EXCEPTION) {
      throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '请先点「出发」再交付确认')
    }

    const orderIds = this.orderIdsOf(task)
    // 交付确认：任务→3、订单 50→60、配送员 onRoute 复位 同一事务（2026-09-19 卡B 涉订单状态收口）。
    // 原实现 onRoute 复位在事务外，任务/订单已落库但复位失败会把配送员锁在「配送中」接不到新单
    const remaining = await this.prisma.$transaction(async (tx) => {
      await tx.deliveryTask.update({
        where: { id: task.id },
        data: { status: TaskStatus.DONE, completedAt: new Date(), proof: { photos: dto.photos, signature: dto.signature, remark: dto.remark } },
      })
      for (const oid of orderIds) {
        await tx.order.updateMany({
          where: { id: BigInt(oid), status: OrderStatus.DELIVERING },
          data: { status: OrderStatus.DELIVERED },
        })
      }

      // 全部任务配送完成后，恢复可接单资格（onRoute → 0）
      const left = await tx.deliveryTask.count({
        where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING, TaskStatus.DEPARTED] } },
      })
      if (left === 0) {
        await tx.courier.update({ where: { id: courier.id }, data: { onRoute: 0 } })
      }
      return left
    })

    // 铁律 3：交付确认推进交付链路（任务→3、订单 50→60），写审计（2026-09-11 补，闭合 S2）
    await this.audit.log({
      operatorId: courier.userId,
      action: 'COURIER_DELIVER',
      entity: 'delivery_task',
      entityId: taskId,
      before: { taskStatus: task.status },
      after: { taskStatus: TaskStatus.DONE, deliveredOrders: orderIds.length, orderIds },
    })

    // 交付确认后待收款的 COD 订单（2026-09-19 拍板卡）：供前端自动跳收款页
    // 「COD 已收款」以既有 order.payProof 为准（payProof 接口落库，核销口径不变，不新增 schema）
    // 仅统计本任务内已送达(60)、payMethod=2 且尚无收款凭证的订单，按站点顺序排列
    const taskOrders = await this.prisma.order.findMany({
      where: { id: { in: orderIds.map((oid) => BigInt(oid)) } },
      include: { purchaser: { select: { shopName: true } } },
    })
    const codOrders = orderIds
      .map((oid) => taskOrders.find((o) => Number(o.id) === oid))
      .filter((o) => o && o.payMethod === 2 && o.payProof == null && o.status === OrderStatus.DELIVERED)
      .map((o) => ({
        orderId: Number(o!.id),
        shopName: o!.purchaser?.shopName || '',
        amount: Number(o!.amountFinal ?? o!.amountOrdered ?? 0),
      }))

    return { taskId, status: TaskStatus.DONE, deliveredOrders: orderIds.length, resumed: remaining === 0, codOrders }
  }

  // ────────────────────────────────────────
  // 异常上报：写审计日志 + 标记任务异常 + 生成运营后台异常工单
  // ────────────────────────────────────────
  async report(userId: bigint, dto: ReportDto) {
    const courier = await this.getCourier(userId)
    let affectedOrders = 0
    let exceptionId = 0
    // 审计 + 订单/任务异常标记 + 异常工单 同一事务（2026-09-15 涉钱收口：
    // 避免"审计已记、异常单没建"或"异常单建了、订单没标"的中间态）
    await this.prisma.$transaction(async (tx) => {
      // 2026-09-12 #14 收口：直写 prisma.auditLog.create → 统一走 AuditService（字段等价；action 值逐字保留 courier_report）
      await this.audit.log(
        {
          operatorId: courier.userId,
          action: 'courier_report',
          entity: 'delivery_task',
          entityId: BigInt(dto.taskId ?? dto.orderId ?? 0),
          after: { orderId: dto.orderId ?? null, taskId: dto.taskId ?? null, reason: dto.reason, photos: dto.photos },
        },
        tx,
      )

      // 订单级异常：只标记该订单，不影响同任务其他订单与任务状态
      if (dto.orderId) {
        const r = await tx.order.updateMany({
          where: { id: BigInt(dto.orderId), status: { in: [OrderStatus.ASSIGNED, OrderStatus.WAIT_DELIVERY, OrderStatus.DELIVERING] } },
          data: { status: OrderStatus.UNDELIVERABLE },
        })
        affectedOrders = r.count
      } else if (dto.taskId) {
        // 任务级异常（车辆故障等）：标记整个任务 + 所有配送中订单
        const task = await tx.deliveryTask.findFirst({
          where: { id: BigInt(dto.taskId), courierId: courier.id },
        })
        if (task) {
          await tx.deliveryTask.updateMany({
            where: { id: BigInt(dto.taskId), courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING, TaskStatus.DEPARTED] } },
            data: { status: TaskStatus.EXCEPTION },
          })
          const orderIds = this.orderIdsOf(task)
          if (orderIds.length) {
            const r = await tx.order.updateMany({
              where: { id: { in: orderIds.map((id) => BigInt(id)) }, status: OrderStatus.DELIVERING },
              data: { status: OrderStatus.UNDELIVERABLE },
            })
            affectedOrders = r.count
          }
        }
      }

      // 生成异常工单，供运营后台处理
      const exception = await tx.deliveryException.create({
        data: {
          deliveryTaskId: dto.taskId ? BigInt(dto.taskId) : null,
          courierId: courier.id,
          orderId: dto.orderId ? BigInt(dto.orderId) : null,
          reason: dto.reason,
          status: 0,
          // 决策⑦（2026-09-19）：上报拍照留证。存 URL 数组；不传即 NULL（可空，兼容既有不拍照的上报）
          photos: dto.photos?.length ? dto.photos : undefined,
        },
      })
      exceptionId = Number(exception.id)
    })

    return { reported: true, exceptionId, affectedOrders }
  }

  // ────────────────────────────────────────
  // 收款协助：仅展示统一支付码 + 标记「客户称已支付」
  // ⚠️ 铁律：不返回金额、不作核销依据，以服务端回调为准
  // ────────────────────────────────────────
  async markPaid(userId: bigint, orderId: number) {
    const courier = await this.getCourier(userId)
    const order = await this.prisma.order.findUnique({ where: { id: BigInt(orderId) } })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')

    // 铁律 3：COD 收款的第一手记录（仅标记「客户称已支付」，不作核销依据），写审计
    // （2026-09-11 补，闭合 S3；核销仍以 pay-proof / 服务端回调为准）
    await this.audit.log({
      operatorId: courier.userId,
      action: 'COD_MARK_PAID',
      entity: 'order',
      entityId: orderId,
      after: { courierId: Number(courier.id), claimedPaid: true, note: '客户称已支付（配送员标记，非核销依据）' },
    })

    return {
      orderId,
      payQrUrl: await this.payQrUrl(),
      note: '客户称已支付，实际以服务端支付回调为准，配送员不作核销',
    }
  }

  // ────────────────────────────────────────
  // 收款二维码：运营后台上传，配送员端读取展示（客户扫码付款）
  // ────────────────────────────────────────
  async payQr() {
    return { url: await this.payQrUrl() }
  }

  private async payQrUrl(): Promise<string | null> {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'pay_qr' } })
    const value = (cfg?.value as any) || {}
    return value.url || null
  }

  // ────────────────────────────────────────
  // 货到付款收款凭证：配送员上传客户付款拍照，记录到订单，运营后台可查
  // ────────────────────────────────────────
  async payProof(userId: bigint, orderId: number, dto: PayProofDto) {
    const courier = await this.getCourier(userId)
    const order = await this.prisma.order.findUnique({ where: { id: BigInt(orderId) } })
    if (!order) throw new BizException(ErrorCode.NOT_FOUND, '订单不存在')
    if (order.payMethod !== 2) throw new BizException(ErrorCode.ORDER_STATUS_INVALID, '非货到付款订单')

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        payProof: { photos: dto.photos, courierId: Number(courier.id), paidAt: new Date().toISOString() },
      },
    })
    // 2026-09-12 #14 收口：直写 → AuditService（action 值逐字保留 COD_PAY_PROOF）
    await this.audit.log({
      operatorId: userId,
      action: 'COD_PAY_PROOF',
      entity: 'order',
      entityId: orderId,
      after: { photos: dto.photos },
    })

    return { orderId, recorded: true }
  }

  // ────────────────────────────────────────
  // 任务订单总金额（交付确认时显示，供配送员与采购方核对）
  // ⚠️ 仅货到付款(payMethod=2)订单显示金额；微信支付(1)已线上支付，不显示金额
  // ────────────────────────────────────────
  async taskAmount(userId: bigint, taskId: number) {
    const courier = await this.getCourier(userId)
    const task = await this.prisma.deliveryTask.findFirst({
      where: { id: BigInt(taskId), courierId: courier.id },
    })
    if (!task) throw new BizException(ErrorCode.NOT_FOUND, '任务不存在')

    const orderIds = this.orderIdsOf(task)
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds.map((id) => BigInt(id)) } },
          select: { amountFinal: true, amountOrdered: true, deliveryFee: true, payMethod: true },
        })
      : []
    // 仅货到付款订单需显示金额供配送员核对
    const codOrders = orders.filter((o) => o.payMethod === 2)
    const codAmount = codOrders.reduce(
      (s, o) => s + (o.amountFinal != null ? Number(o.amountFinal) : Number(o.amountOrdered) + Number(o.deliveryFee)),
      0,
    )
    return {
      taskId,
      orderCount: orders.length,
      showAmount: codOrders.length > 0,
      totalAmount: Math.round(codAmount * 100) / 100,
    }
  }

  // ────────────────────────────────────────
  // 接单状态查询（上下线 / 接单模式 / 配送中 / 当前任务数）
  // ────────────────────────────────────────
  async getStatus(userId: bigint) {
    const courier = await this.getCourier(userId)
    const activeTasks = await this.prisma.deliveryTask.count({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING, TaskStatus.DEPARTED] } },
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
  // 扫码取货（订单级）：任务内单个订单取货，标记 station.picked=true
  // 任务内全部订单取完后，任务 0→1（配送中）
  // ────────────────────────────────────────
  async pickupOrder(userId: bigint, orderId: number) {
    const courier = await this.getCourier(userId)
    const tasks = await this.prisma.deliveryTask.findMany({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
    })
    const task = tasks.find((t) => {
      const stations = Array.isArray(t.stationList) ? t.stationList : []
      return stations.some((s: any) => s.type === 'deliver' && Number(s.orderId) === orderId)
    })
    if (!task) throw new BizException(ErrorCode.NOT_FOUND, '未找到该订单的配送任务')

    // 审计前置：只读记录取货前订单状态（不参与任何业务判定，仅用于留痕 before）
    const orderBefore = await this.prisma.order.findUnique({
      where: { id: BigInt(orderId) },
      select: { status: true },
    })

    const stations = (Array.isArray(task.stationList) ? task.stationList : []).map((s: any) => {
      if (s.type === 'deliver' && Number(s.orderId) === orderId) return { ...s, picked: true }
      return s
    })
    const deliverStations = stations.filter((s: any) => s.type === 'deliver')
    const allPicked = deliverStations.length > 0 && deliverStations.every((s: any) => s.picked === true)

    await this.prisma.$transaction([
      this.prisma.deliveryTask.update({
        where: { id: task.id },
        data: { stationList: stations, status: allPicked ? TaskStatus.DELIVERING : TaskStatus.PENDING_PICKUP },
      }),
      this.prisma.order.updateMany({
        where: { id: BigInt(orderId), status: { in: [OrderStatus.ASSIGNED, OrderStatus.WAIT_DELIVERY] } },
        data: { status: OrderStatus.DELIVERING },
      }),
    ])

    // 铁律 3：订单级取货与任务级 pickup 同语义 → 沿用 COURIER_PICKUP；以 entity='order'+entityId=orderId 区分入口
    // （2026-09-11 补，闭合多入口排查 S1；after 的订单状态按 updateMany 的实际条件镜像，不改状态流转本身）
    const orderPickable = orderBefore != null && (orderBefore.status === OrderStatus.ASSIGNED || orderBefore.status === OrderStatus.WAIT_DELIVERY)
    await this.audit.log({
      operatorId: courier.userId,
      action: 'COURIER_PICKUP',
      entity: 'order',
      entityId: orderId,
      before: { orderStatus: orderBefore?.status ?? null, taskStatus: task.status },
      after: {
        orderStatus: orderPickable ? OrderStatus.DELIVERING : (orderBefore?.status ?? null),
        taskStatus: allPicked ? TaskStatus.DELIVERING : TaskStatus.PENDING_PICKUP,
        taskId: Number(task.id),
        allPicked,
      },
    })

    return { orderId, picked: true, taskId: Number(task.id), allPicked }
  }

  // ────────────────────────────────────────
  // 出发：取完所有安排订单后点「出发」，进入配送中，无法接新单；
  // ⚠️ 校验所有货物均已取货，未取完则拒绝出发
  // ────────────────────────────────────────
  async depart(userId: bigint) {
    const courier = await this.getCourier(userId)
    const active = await this.prisma.deliveryTask.findMany({
      where: { courierId: courier.id, status: { in: [TaskStatus.PENDING_PICKUP, TaskStatus.DELIVERING] } },
    })
    if (!active.length) throw new BizException(ErrorCode.PARAM_ERROR, '暂无待配送任务，无需出发')

  // 查异常订单（无法交付），出发校验时跳过，避免异常订单阻塞整条路线
  const allOrderIds = [...new Set(active.flatMap((t) => this.orderIdsOf(t)))]
  const abnormal = allOrderIds.length
    ? await this.prisma.order.findMany({
        where: { id: { in: allOrderIds.map((id) => BigInt(id)) }, status: OrderStatus.UNDELIVERABLE },
        select: { id: true },
      })
    : []
  const abnormalSet = new Set(abnormal.map((o) => Number(o.id)))

  // 校验所有货物均已取（跳过异常订单）
  const unpicked: string[] = []
  for (const t of active) {
    const stations = Array.isArray(t.stationList) ? t.stationList : []
    stations
      .filter((s: any) => s.type === 'deliver' && s.picked !== true && !abnormalSet.has(Number(s.orderId)))
      .forEach((s: any) => unpicked.push(s.shopName || `#${s.orderId}`))
  }
  if (unpicked.length) {
    throw new BizException(ErrorCode.ORDER_STATUS_INVALID, `还有 ${unpicked.length} 件货物未取，无法出发`)
  }

    // 把已取货(1)的任务标记为已出发(2)，并设置配送员配送中
    const readyIds = active.filter((t) => t.status === TaskStatus.DELIVERING).map((t) => t.id)
    await this.prisma.$transaction([
      ...(readyIds.length
        ? [this.prisma.deliveryTask.updateMany({ where: { id: { in: readyIds }, courierId: courier.id }, data: { status: TaskStatus.DEPARTED } })]
        : []),
      this.prisma.courier.update({ where: { id: courier.id }, data: { onRoute: 1 } }),
    ])
    return { courierId: Number(courier.id), onRoute: 1, departedTasks: readyIds.length }
  }
}
