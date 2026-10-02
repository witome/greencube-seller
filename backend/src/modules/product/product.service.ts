import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, AccountStatus } from '../../common/constants/error-codes'

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 价格可见性（卡AA 2026-09-30，大辉拍板口径，不许放宽）：
  // 只有 purchaser 档案存在且 accountStatus=2（已激活）才看得到真实价格；
  // 未注册 / 待审核(1) / 驳回(3) / 终态驳回(4) / 运营停用(5) 一律 salePrice=null + priceVisible=false。
  // 脱敏在服务端抹除（不是前端遮挡）；priceVisible 是纯新增字段，其余字段一个不动。
  // ────────────────────────────────────────
  private async priceVisibleFor(userId: bigint): Promise<boolean> {
    const p = await this.prisma.purchaser.findUnique({
      where: { userId },
      select: { accountStatus: true },
    })
    return !!p && p.accountStatus === AccountStatus.ACTIVE
  }

  /** 单行价格字段：可见给真实价，不可见 salePrice=null（调用方再补 priceVisible） */
  private priceFields(salePrice: any, visible: boolean) {
    return { salePrice: visible ? Number(salePrice) : null }
  }

  // ────────────────────────────────────────
  // 分类树
  // ────────────────────────────────────────
  async categories() {
    const all = await this.prisma.category.findMany({ orderBy: { sort: 'asc' } })

    const roots = all.filter((c) => !c.parentId)
    const build = (parent: any): any => ({
      id: Number(parent.id),
      name: parent.name,
      children: all
        .filter((c) => c.parentId === parent.id)
        .map((c) => ({ id: Number(c.id), name: c.name })),
    })
    return roots.map(build)
  }

  // ────────────────────────────────────────
  // 商品列表（⚠️ 仅返回销售价，绝不返回供货价）
  // 契约《开发配套-API接口字段契约》第 3 节
  // ────────────────────────────────────────
  async list(query: { categoryId?: string; keyword?: string; page?: string; pageSize?: string }, userId: bigint) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))
    const categoryId = query.categoryId && query.categoryId !== 'undefined' ? parseInt(query.categoryId) : undefined
    const keyword = query.keyword?.trim()
    const kw = keyword && keyword !== 'undefined' ? keyword : undefined

    const where: any = { status: 1 } // 仅在售
    if (categoryId && !Number.isNaN(categoryId)) where.categoryId = categoryId
    if (kw) where.name = { contains: kw }

    const [total, rows, priceVisible] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { links: true } }, links: { orderBy: { priority: 'asc' } } },
      }),
      this.priceVisibleFor(userId),
    ])

    return {
      total,
      priceVisible,
      list: rows.map((p) => ({
        id: Number(p.id),
        name: p.name,
        cover: p.cover,
        unit: p.unit,
        weighType: p.weighType,
        specText: p.specText,
        // ⚠️ 采购方只看到销售价；未激活账号服务端抹除（卡AA）
        ...this.priceFields(p.salePrice, priceVisible),
        priceVisible,
        dailySupply: Number(p.links[0]?.dailySupply ?? 0),
        // 卡BP（2026-10-02）：主供货商（priority 最小）的备注；空 → 前端回退 specText/称重
        remark: p.links[0]?.remark || null,
        supplierCount: p._count.links,
      })),
    }
  }

  // ────────────────────────────────────────
  // 商品详情（⚠️ supplyPrice 恒为 null）
  // ────────────────────────────────────────
  async detail(id: number, userId: bigint) {
    const [p, priceVisible] = await Promise.all([
      this.prisma.product.findUnique({
        where: { id: BigInt(id) },
        include: { links: { orderBy: { priority: 'asc' } } },
      }),
      this.priceVisibleFor(userId),
    ])
    if (!p || p.status === 0) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在或已下架')

    return {
      id: Number(p.id),
      name: p.name,
      cover: p.cover,
      images: p.images,
      unit: p.unit,
      weighType: p.weighType,
      specText: p.specText,
      // ⚠️ 采购方只看到销售价；未激活账号服务端抹除（卡AA）
      ...this.priceFields(p.salePrice, priceVisible),
      priceVisible,
      dailySupply: Number(p.links[0]?.dailySupply ?? 0),
      // 卡BP（2026-10-02）：主供货商备注（详情页名称下灰字位沿用，与列表同口径）
      remark: p.links[0]?.remark || null,
      weighNote: p.weighNote,
      supplyPrice: null, // ⚠️ 采购方不可见供货价
    }
  }
}
