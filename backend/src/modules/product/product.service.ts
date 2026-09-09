import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

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
  async list(query: { categoryId?: string; keyword?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))
    const categoryId = query.categoryId && query.categoryId !== 'undefined' ? parseInt(query.categoryId) : undefined
    const keyword = query.keyword?.trim()
    const kw = keyword && keyword !== 'undefined' ? keyword : undefined

    const where: any = { status: 1 } // 仅在售
    if (categoryId && !Number.isNaN(categoryId)) where.categoryId = categoryId
    if (kw) where.name = { contains: kw }

    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { links: true } }, links: { orderBy: { priority: 'asc' } } },
      }),
    ])

    return {
      total,
      list: rows.map((p) => ({
        id: Number(p.id),
        name: p.name,
        cover: p.cover,
        unit: p.unit,
        weighType: p.weighType,
        specText: p.specText,
        // ⚠️ 采购方只看到销售价
        salePrice: Number(p.salePrice),
        dailySupply: Number(p.links[0]?.dailySupply ?? 0),
        supplierCount: p._count.links,
      })),
    }
  }

  // ────────────────────────────────────────
  // 商品详情（⚠️ supplyPrice 恒为 null）
  // ────────────────────────────────────────
  async detail(id: number) {
    const p = await this.prisma.product.findUnique({
      where: { id: BigInt(id) },
      include: { links: true },
    })
    if (!p || p.status === 0) throw new BizException(ErrorCode.NOT_FOUND, '商品不存在或已下架')

    return {
      id: Number(p.id),
      name: p.name,
      cover: p.cover,
      images: p.images,
      unit: p.unit,
      weighType: p.weighType,
      specText: p.specText,
      salePrice: Number(p.salePrice),
      dailySupply: Number(p.links[0]?.dailySupply ?? 0),
      weighNote: p.weighNote,
      supplyPrice: null, // ⚠️ 采购方不可见供货价
    }
  }
}
