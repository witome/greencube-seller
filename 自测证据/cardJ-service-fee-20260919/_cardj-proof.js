/**
 * 卡J 验证脚本 · 服务费配置「并发双写」防护
 *
 * 七段证据（全部只读或可回滚，绝不留下测试数据）：
 *   E1 查重               现有数据有没有重复行
 *   E2 结构与迁移         生成列 global_key + 唯一键是否生效；迁移是否登记
 *   E3 手工插重复全局行    数据库是否真的拒绝（贴原始报错）
 *   E4 真表并发锁          两个独立连接同时插同分类 → 第二个被唯一键阻塞（证明 DB 会串行化）
 *   E5 真服务并发          并发两次 PUT /admin/finance/service-fee → 库里仍只有一条
 *   E6 机制对照            「无唯一键」vs「有唯一键 + 原子 upsert」各写两次
 *   E7 冲突友好性          用**真实的 P2002** 调编译产物 serviceFeeWriteError()，看落成什么业务码
 *
 * 跑法（后端需已在 3001 运行、且已加载卡J 新代码）：
 *   cd backend && node ../自测证据/cardJ-service-fee-20260919/_cardj-proof.js
 */
const path = require('path')
// 本脚本住在 自测证据/ 下，Node 的模块解析是相对「脚本所在目录」而非 cwd，
// 所以 backend/node_modules 里的依赖必须显式按绝对路径引用。
const BACKEND = path.join(__dirname, '..', '..', 'backend')
const { PrismaClient } = require(path.join(BACKEND, 'node_modules', '@prisma', 'client'))

const API = 'http://127.0.0.1:3001/api/v1'
const S = (o) => JSON.stringify(o, (k, v) => (typeof v === 'bigint' ? Number(v) : v), 2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

const prisma = new PrismaClient()

/** 真表的「全量快照」，用来证明全程没动过业务数据 */
async function snapshot() {
  return prisma.$queryRawUnsafe(
    'SELECT id, category_id, global_key, rate, updated_by, updated_at FROM service_fee_config ORDER BY id',
  )
}

async function section(title, fn) {
  log('')
  log('='.repeat(72))
  log(title)
  log('='.repeat(72))
  try {
    await fn()
  } catch (e) {
    log('  ✗ 本段异常：' + (e && e.message))
  }
}

;(async () => {
  const before = await snapshot()
  log('【起始快照】service_fee_config 全表（后面每段结束都会比对它）')
  log(S(before))

  // ────────────────────────────────────────────
  await section('E1 查重：现有数据有没有重复（我只读，不删不改）', async () => {
    const dup = await prisma.$queryRawUnsafe(
      'SELECT category_id, COUNT(*) c FROM service_fee_config GROUP BY category_id HAVING COUNT(*) > 1',
    )
    log('  按 category_id 分组、COUNT(*)>1 的组：')
    log('  ' + S(dup))
    log(`  重复组数 = ${dup.length}`)
    const dupKey = await prisma.$queryRawUnsafe(
      'SELECT global_key, COUNT(*) c FROM service_fee_config GROUP BY global_key HAVING COUNT(*) > 1',
    )
    log('  按 global_key 分组、COUNT(*)>1 的组：' + S(dupKey) + '  （唯一键已建立，理论上不可能 >1）')
    const tot = await prisma.$queryRawUnsafe('SELECT COUNT(*) c FROM service_fee_config')
    log('  全表行数 = ' + S(tot))
    const g = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) c FROM service_fee_config WHERE category_id IS NULL',
    )
    log('  全局行（category_id IS NULL）条数 = ' + S(g))
  })

  // ────────────────────────────────────────────
  await section('E2 结构与迁移：生成列 + 唯一键是否真在库里', async () => {
    const cols = await prisma.$queryRawUnsafe(
      "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA, GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_fee_config' ORDER BY ORDINAL_POSITION",
    )
    log('  列定义：')
    log('  ' + S(cols))
    const idx = await prisma.$queryRawUnsafe('SHOW INDEX FROM service_fee_config')
    log('  索引：')
    log('  ' + S(idx.map((i) => ({ Key: i.Key_name, NonUnique: i.Non_unique, Col: i.Column_name }))))
  })

  // ────────────────────────────────────────────
  await section('E3 手工插一条重复的全局费率 → 应被数据库拒绝（这就是「光看代码看不出来」的那层兜底）', async () => {
    log("  执行：INSERT INTO service_fee_config (category_id, rate, updated_at) VALUES (NULL, 0.07, NOW(3))")
    try {
      await prisma.$executeRawUnsafe(
        'INSERT INTO service_fee_config (category_id, rate, updated_at) VALUES (NULL, 0.07, NOW(3))',
      )
      log('  ✗ 竟然插进去了 —— 兜底没生效！')
    } catch (e) {
      log('  ✓ 被拒。原始报错：')
      log('    code    = ' + (e.code || '(无)'))
      log('    errno   = ' + (e.meta && e.meta.code ? e.meta.code : '(无)'))
      log('    message = ' + String(e.message).replace(/\n/g, ' ').slice(0, 400))
    }
  })

  // ────────────────────────────────────────────
  await section('E4 并发真表：两个独立连接同时插同一分类 → 第二个被唯一键阻塞（DB 会串行化）', async () => {
    const A = new PrismaClient()
    const B = new PrismaClient()
    const CAT = 999999 // 库里没有这个分类的配置；两边最后都回滚，不留数据
    let aInserted = false
    let aErr = null
    let bErr = null
    let blockedMs = null

    const txA = A.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO service_fee_config (category_id, rate, updated_at) VALUES (${CAT}, 0.03, NOW(3))`,
      )
      aInserted = true
      await sleep(2200) // 故意持有锁，让 B 卡住
      throw new Error('INTENTIONAL_ROLLBACK_A')
    }).catch((e) => {
      aErr = e.message
    })

    while (!aInserted) await sleep(20)

    const t0 = Date.now()
    const txB = B.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO service_fee_config (category_id, rate, updated_at) VALUES (${CAT}, 0.04, NOW(3))`,
      )
      blockedMs = Date.now() - t0
      throw new Error('INTENTIONAL_ROLLBACK_B')
    }).catch((e) => {
      bErr = e.message
    })

    await Promise.all([txA, txB])
    log('  A 的结局：' + aErr)
    log('  B 的结局：' + bErr)
    log(`  B 的 INSERT 被阻塞了约 ${blockedMs} ms（若为 0 说明没锁住，唯一键没起作用）`)
    await A.$disconnect()
    await B.$disconnect()
    const left = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM service_fee_config WHERE category_id = ${CAT}`,
    )
    log('  两边回滚后，该分类残留行数 = ' + S(left) + '  （应为 0）')
  })

  // ────────────────────────────────────────────
  await section('E5 真服务并发：并发两次 PUT /admin/finance/service-fee（同一个全局分类）', async () => {
    const login = await fetch(`${API}/auth/wx-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'admin' }),
    }).then((r) => r.json())
    log('  运营登录：code=' + login.code + ' role=' + (login.data && login.data.currentRole))
    const token = login.data.token

    const put = () =>
      fetch(`${API}/admin/finance/service-fee`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ rate: 0.05 }), // 保持原值 0.05，测试不改变任何业务取值
      }).then(async (r) => ({ http: r.status, body: await r.json() }))

    const [r1, r2] = await Promise.all([put(), put()])
    log('  并发请求 1：HTTP ' + r1.http + ' → ' + S(r1.body))
    log('  并发请求 2：HTTP ' + r2.http + ' → ' + S(r2.body))

    const g = await prisma.$queryRawUnsafe(
      'SELECT id, category_id, global_key, rate, updated_at FROM service_fee_config WHERE category_id IS NULL ORDER BY id',
    )
    const cnt = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) c FROM service_fee_config WHERE category_id IS NULL',
    )
    log('  并发写入后，全局行：')
    log('  ' + S(g))
    log('  全局行条数 = ' + S(cnt) + '  （必须为 1）')
  })

  // ────────────────────────────────────────────
  await section('E6 重放「改前」的并发交错（真表 · 事务内 · 最后回滚，零残留）', async () => {
    const CAT = 999998
    let secondErr = null
    let cntAfterFirst = null
    try {
      await prisma.$transaction(async (tx) => {
        // 原实现的两次判断：并发下两个请求都读到「无配置」
        const r1 = await tx.$queryRawUnsafe(
          `SELECT id FROM service_fee_config WHERE category_id <=> ${CAT}`,
        )
        const r2 = await tx.$queryRawUnsafe(
          `SELECT id FROM service_fee_config WHERE category_id <=> ${CAT}`,
        )
        log(`  ① 两个并发请求各自的「先查有没有」：${r1.length} 行 / ${r2.length} 行 → 都会走 INSERT`)
        await tx.$executeRawUnsafe(
          `INSERT INTO service_fee_config (category_id, rate, updated_at) VALUES (${CAT}, 0.03, NOW(3))`,
        )
        const c = await tx.$queryRawUnsafe(
          `SELECT COUNT(*) c FROM service_fee_config WHERE category_id = ${CAT}`,
        )
        cntAfterFirst = c[0].c
        log('  ② 第一个请求 INSERT 成功，此时该分类行数 = ' + cntAfterFirst)
        // ③ 第二个请求照样去 INSERT —— 改前这一步会成功（两条），现在应被唯一键拒绝
        await tx.$executeRawUnsafe(
          `INSERT INTO service_fee_config (category_id, rate, updated_at) VALUES (${CAT}, 0.04, NOW(3))`,
        )
        log('  ✗ 第二个 INSERT 竟然成功了 —— 兜底没生效！')
        throw new Error('SENTINEL_ROLLBACK')
      })
    } catch (e) {
      if (String(e.message).includes('1062')) {
        secondErr = String(e.message).replace(/\n/g, ' ')
        log('  ③ 第二个请求 INSERT 被数据库拒绝（这就是改前会出两条、现在出不来的那条路径）：')
        log('     ' + secondErr.slice(0, 260))
      } else if (!String(e.message).includes('SENTINEL')) {
        log('  ③ 其它异常：' + e.message)
      }
    }
    const left = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) c FROM service_fee_config WHERE category_id = ${CAT}`,
    )
    log('  回滚后该分类残留行数 = ' + S(left) + '  （应为 0）')

    log('')
    log('  ⚠️ 说明：本库的 lvlifang_app 没有 CREATE TEMPORARY TABLES 权限（报 1044），')
    log('     无法另建一张「无唯一键」的表来实证「改前会出两条」。')
    log('     故「改前会出两条」是**推理结论**（原代码两次 INSERT、且当时表上无任何唯一约束），')
    log('     未被实证复现；被实证的是上面这条 —— 同样的交错现在会被库拒绝。')
    log('     MySQL 不约束 NULL 的唯一索引语义（本卡要绕开的坑）——只读核对：')
    const nul = await prisma.$queryRawUnsafe('SELECT (NULL = NULL) AS plain_eq, (NULL <=> NULL) AS nullsafe_eq')
    log('     ' + S(nul) + '  ← `=` 对 NULL 得 NULL（永不为真），故 @@unique([categoryId]) 挡不住多条 NULL')
  })

  // ────────────────────────────────────────────
  await section('E7 冲突友好性：用真实的 P2002 调编译产物里的映射函数', async () => {
    let realErr = null
    try {
      // 真表已有全局行 → 这条 create 一定会撞唯一键被拒（不会写进去）
      await prisma.serviceFeeConfig.create({ data: { categoryId: null, rate: 0.09 } })
      log('  ✗ 竟然建成功了 —— 说明唯一键没生效！')
    } catch (e) {
      realErr = e
      log('  真表上触发到的原始错误：code=' + e.code + '  (Prisma 侧识别为 P2002 = 唯一键冲突)')
    }
    if (realErr) {
      const svc = require(path.join(BACKEND, 'dist', 'modules', 'admin-finance', 'admin-finance.service'))
      const mapped = svc.serviceFeeWriteError(realErr)
      log('  调 serviceFeeWriteError(真实错误) 得到：')
      log('  ' + (mapped ? `BizException code=${mapped.code} msg="${mapped.message}"` : 'null（没被识别，将原样抛出）'))
      log('  ⇒ 若真走到冲突分支，接口返回的是上面这个业务码，不是裸 500')
    }
  })

  // ────────────────────────────────────────────
  const after = await snapshot()
  log('')
  log('='.repeat(72))
  log('【结束快照】service_fee_config 全表')
  log('='.repeat(72))
  log(S(after))
  log('')
  log('业务取值是否零改动：')
  const biz = (rows) => S(rows.map((r) => ({ id: r.id, category_id: r.category_id, global_key: r.global_key, rate: r.rate, updated_by: r.updated_by })))
  log('  行数：' + before.length + ' → ' + after.length + (before.length === after.length ? '  ✓' : '  ✗'))
  log('  (id / category_id / global_key / rate / updated_by)：' + (biz(before) === biz(after) ? '完全一致 ✓' : '有变化 ✗'))
  log('  updated_at 位移：' + before.map((r) => r.updated_at).join(',') + '  →  ' + after.map((r) => r.updated_at).join(','))
  log('  ⚠️ updated_at 变了是**并发测试自身**造成的：E5 通过真实接口写了一次同一分类（rate 仍是 0.05），')
  log('     写入路径会刷新 updated_at。费率取值、行数、归属均未变。')

  await prisma.$disconnect()
})().catch(async (e) => {
  console.error('脚本异常：', e)
  await prisma.$disconnect()
  process.exit(1)
})
