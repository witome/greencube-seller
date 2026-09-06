import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, AccountStatus } from '../../common/constants/error-codes'
import { AddCartDto } from './dto/add-cart.dto'
import { UpdateCartDto } from './dto/update-cart.dto'

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
}
