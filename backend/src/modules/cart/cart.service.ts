import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, AccountStatus } from '../../common/constants/error-codes'
import { AddCartDto } from './dto/add-cart.dto'
import { UpdateCartDto } from './dto/update-cart.dto'
import { SyncCartDto } from './dto/sync-cart.dto'

/** 草稿行 → 出参形状（getValue:list 与 sync 共用一份，避免两处金额口径分叉） */
function composeList(items: Array<{ id: bigint; qty: any; product: any }>) {
  const list = items.map((it) => {
    const p = it.product
    const subtotal = Number(it.qty) * Number(p.salePrice)
    return {
      cartItemId: Number(it.id),
      productId: Number(p.id),
      name: p.name,
      unit: p.unit,
      weighType: p.weighType,
      qty: Number(it.qty),
      salePrice: Number(p.salePrice),
      subtotal: Math.round(subtotal * 100) / 100,
      onSale: p.status === 1,
    }
  })

  const totalAmount = Math.round(list.reduce((s, i) => s + i.subtotal, 0) * 100) / 100

  return { list, totalAmount }
}

@Injectable()
export class CartService {
  constructor(private prisma: PrismaService) {}

  /// ⚠️ 购物车仅「正常」采购方可用（pending 用户可预览商品但不可加购）
  private async assertActivePurchaser(userId: bigint) {
    const purchaser = await this.prisma.purchaser.findUnique({ where: { userId } })
    if (!purchaser || purchaser.accountStatus !== AccountStatus.ACTIVE) {
      throw new BizException(ErrorCode.ACCOUNT_NOT_ACTIVE)
    }
    return purchaser
  }

  // ────────────────────────────────────────
  // 购物车列表
  // 契约《开发配套-API接口字段契约》第 4 节
  // ⚠️ 决策 1：购物车阶段不拆单、不定供应商，故返回扁平列表
  //    （供应商归属在运营「核单拆单」时才确定）
  // ────────────────────────────────────────
  async list(userId: bigint) {
    await this.assertActivePurchaser(userId)
    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })

    return composeList(items)
  }

  // ────────────────────────────────────────
  // 加购（重复加购自动累加数量）
  // ────────────────────────────────────────
  async add(userId: bigint, dto: AddCartDto) {
    await this.assertActivePurchaser(userId)
    const product = await this.prisma.product.findUnique({ where: { id: BigInt(dto.productId) } })
    if (!product || product.status !== 1) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在或已下架')

    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_productId: { userId, productId: BigInt(dto.productId) } },
    })

    const item = existing
      ? await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: { qty: { increment: dto.qty } },
        })
      : await this.prisma.cartItem.create({
          data: { userId, productId: BigInt(dto.productId), qty: dto.qty },
        })

    return { cartItemId: Number(item.id) }
  }

  // ────────────────────────────────────────
  // 改数量（qty=0 即删除）
  // ────────────────────────────────────────
  async update(userId: bigint, cartItemId: number, dto: UpdateCartDto) {
    await this.assertActivePurchaser(userId)
    const item = await this.prisma.cartItem.findFirst({
      where: { id: BigInt(cartItemId), userId },
    })
    if (!item) throw new BizException(ErrorCode.NOT_FOUND, '购物车条目不存在')

    if (dto.qty === 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } })
      return { cartItemId, deleted: true }
    }

    const updated = await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { qty: dto.qty },
    })
    return { cartItemId, qty: Number(updated.qty) }
  }

  // ────────────────────────────────────────
  // 删除
  // ────────────────────────────────────────
  async remove(userId: bigint, cartItemId: number) {
    await this.assertActivePurchaser(userId)
    await this.prisma.cartItem.deleteMany({
      where: { id: BigInt(cartItemId), userId },
    })
    return { cartItemId, deleted: true }
  }

  // ────────────────────────────────────────
  // 整体替换草稿（卡AQ 2026-10-01：购物车 = 订单草稿，AI 说话也写这里）
  //
  // ⚠️ 这是**唯一**允许「前端一句话就改写整份草稿」的写口：
  //    /ai/parse 保持只读，前端拿到合并后的完整 items 后，调本接口整体落库。
  //
  // 口径：
  //   ① items 是**最终状态**不是增量 —— 事务内先 deleteMany(userId) 再批量 create；
  //   ② 每个 productId 必须**在售**（status=1），不在售的直接**跳过并忽略**
  //      （没上架的菜走采购需求登记 + 到货通知，绝不进草稿）；
  //   ③ 同 productId 重复出现 → 只留一条（后者覆盖，与「最终状态」语义一致）；
  //   ④ qty <= 0 的行丢弃；qty 已是「斤」，**绝不二次换算**；超过 99999.99 截断（防 Decimal(10,2) 溢出）；
  //   ⑤ 返回与 GET /cart 完全同形状，前端替换完可直接整体刷清单。
  // ────────────────────────────────────────
  async sync(userId: bigint, dto: SyncCartDto) {
    await this.assertActivePurchaser(userId)

    // ③ 同 productId 去重（后者覆盖）+ ④ 丢弃非正数、截断超大值
    const merged = new Map<number, number>()
    for (const raw of dto.items || []) {
      if (!raw || raw.productId == null) continue
      const pid = Number(raw.productId)
      const qty = Number(raw.qty)
      if (!Number.isFinite(pid) || !Number.isFinite(qty)) continue
      if (qty <= 0) continue
      merged.set(pid, Math.min(Math.round(qty * 100) / 100, 99999.99))
    }

    const ids = [...merged.keys()]
    // ② 只保留在售商品
    const onSale = ids.length
      ? await this.prisma.product.findMany({
          where: { id: { in: ids.map((id) => BigInt(id)) }, status: 1 },
          select: { id: true },
        })
      : []
    const onSaleIds = new Set(onSale.map((p) => Number(p.id)))

    const finalRows = ids
      .filter((id) => onSaleIds.has(id))
      .map((id) => ({ productId: BigInt(id), qty: merged.get(id) }))

    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { userId } })
      if (finalRows.length) {
        await tx.cartItem.createMany({
          data: finalRows.map((r) => ({ userId, productId: r.productId, qty: r.qty })),
        })
      }
    })

    const items = await this.prisma.cartItem.findMany({
      where: { userId },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    })

    return composeList(items)
  }
}
