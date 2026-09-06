import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 开始初始化演示数据...')

  // ── 1. 分类（幂等：已存在则复用）──
  const categorySpec = [
    { name: '时令蔬菜', children: ['叶菜', '根茎', '瓜果', '菌菇'] },
    { name: '猪肉', children: [] },
    { name: '牛羊肉', children: [] },
    { name: '禽蛋', children: ['鸡肉', '鸡蛋'] },
    { name: '水产', children: ['淡水鱼', '海鲜'] },
    { name: '冻品', children: [] },
    { name: '调料', children: [] },
  ]

  async function ensureCategory(name: string, parentId?: bigint) {
    let c = await prisma.category.findFirst({ where: { name, parentId: parentId ?? null } })
    if (!c) c = await prisma.category.create({ data: { name, parentId } })
    return c
  }

  for (const spec of categorySpec) {
    const parent = await ensureCategory(spec.name)
    for (const child of spec.children) {
      await ensureCategory(child, parent.id)
    }
  }
  const vegCat = await prisma.category.findFirst({ where: { name: '时令蔬菜' } })
  const meatCat = await prisma.category.findFirst({ where: { name: '猪肉' } })
  console.log('  分类 ✓')

  // ── 2. 演示用户 + 供应商 ──
  let demoUser = await prisma.user.findUnique({ where: { wxOpenid: 'dev_demo_supplier' } })
  if (!demoUser) {
    demoUser = await prisma.user.create({
      data: { wxOpenid: 'dev_demo_supplier', phone: null, roles: ['supplier'], status: 1 },
    })
  }

  // 演示运营管理员（wx-login 用 code=admin 即可登录）
  let adminUser = await prisma.user.findUnique({ where: { wxOpenid: 'dev_admin' } })
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: { wxOpenid: 'dev_admin', phone: null, roles: ['admin'], status: 1 },
    })
  }

  // 演示配送员（wx-login 用 code=courier 即可登录）
  let courierUser = await prisma.user.findUnique({ where: { wxOpenid: 'dev_courier' } })
  if (!courierUser) {
    courierUser = await prisma.user.create({
      data: { wxOpenid: 'dev_courier', phone: null, roles: ['courier'], status: 1 },
    })
  }
  let courier = await prisma.courier.findUnique({ where: { userId: courierUser.id } })
  if (!courier) {
    courier = await prisma.courier.create({
      data: { userId: courierUser.id, source: 1, vehicleType: 1, status: 1 },
    })
  }

  let supplier = await prisma.supplier.findFirst({ where: { stallName: '陈记蔬菜档' } })
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        userId: demoUser.id,
        stallName: '陈记蔬菜档',
        status: 1,
        qualification: { businessLicense: 'demo', quarantineCert: 'demo' },
      },
    })
  }

  // 给演示供应商授权前 4 个一级分类（时令蔬菜/猪肉/牛羊肉/禽蛋）
  const rootCats = await prisma.category.findMany({ where: { parentId: null }, orderBy: { id: 'asc' }, take: 4 })
  for (const c of rootCats) {
    await prisma.supplierCategory.upsert({
      where: { supplierId_categoryId: { supplierId: supplier.id, categoryId: c.id } },
      update: {},
      create: { supplierId: supplier.id, categoryId: c.id },
    })
  }
  console.log('  演示用户 + 供应商 + 管理员 + 分类授权 ✓')

  // ── 3. 演示商品 + 供货关联 ──
  const products = [
    { name: '大白菜', categoryId: vegCat!.id, weighType: 1, unit: '斤', specText: '约 2 斤/颗', supplyPrice: 0.95, markupRate: 0.35, dailySupply: 300 },
    { name: '上海青', categoryId: vegCat!.id, weighType: 1, unit: '斤', specText: '约 0.5 斤/把', supplyPrice: 1.85, markupRate: 0.3, dailySupply: 200 },
    { name: '土豆', categoryId: vegCat!.id, weighType: 1, unit: '斤', specText: '约 0.8 斤/个', supplyPrice: 1.2, markupRate: 0.3, dailySupply: 500 },
    { name: '五花肉', categoryId: meatCat!.id, weighType: 1, unit: '斤', specText: '', supplyPrice: 13.5, markupRate: 0.2, dailySupply: 150 },
  ]

  for (const p of products) {
    const salePrice = Math.round(p.supplyPrice * (1 + p.markupRate) * 100) / 100

    let prod = await prisma.product.findFirst({ where: { name: p.name } })
    if (!prod) {
      prod = await prisma.product.create({
        data: {
          categoryId: p.categoryId,
          name: p.name,
          weighType: p.weighType,
          unit: p.unit,
          specText: p.specText,
          weighNote: '称重商品按实际重量结算，多退少补',
          salePrice,
          markupRate: p.markupRate,
          status: 1,
        },
      })
    }

    const link = await prisma.productSupplierLink.findUnique({
      where: { productId_supplierId: { productId: prod.id, supplierId: supplier.id } },
    })
    if (!link) {
      await prisma.productSupplierLink.create({
        data: {
          productId: prod.id,
          supplierId: supplier.id,
          supplyPrice: p.supplyPrice,
          dailySupply: p.dailySupply,
          priority: 1,
          status: 1,
        },
      })
    }
  }
  console.log('  商品 ✓')

  console.log('✅ 种子数据完成：分类 7 个、商品 4 个、供应商 1 个')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
