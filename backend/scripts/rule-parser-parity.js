/**
 * 卡B3 取证：`rule.parser` 补 `unmatched` 之后，**原有字段逐字节没变**
 *
 * 做法（重点：跑的是**真代码**，不是我在脚本里另抄一份算法）：
 *   ① 用 `git show <基线提交>:backend/src/modules/ai/parser/rule.parser.ts` 取出**改动前**的源码
 *   ② 用仓库自带的 typescript 把它转成 CommonJS，并把它对 `./parser.util` / `@nestjs/common`
 *      的依赖指到**当前 dist**（util 未改动）与一个最小桩
 *   ③ 同一批输入、同一批商品行，分别喂给**旧解析器**与**新解析器（dist 里跑着的那个）**
 *   ④ 逐字段对比：items / remark / deliveryDateLabel / deliveryDate / total / matchedCount /
 *      hasUnmatched / rawText / parser —— 全部必须完全相等
 *   ⑤ 唯一允许的差异：新增字段 `unmatched`
 *
 * 跑法：cd backend && node scripts/rule-parser-parity.js [基线提交]
 *      默认基线提交 = 8fd6b81（本卡的回滚点 backup-demand-20260925-0740）
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BACKEND = path.join(__dirname, '..')
const REPO = path.join(BACKEND, '..')
const BASELINE = process.argv[2] || '8fd6b81'
const REL_PATH = 'backend/src/modules/ai/parser/rule.parser.ts'

// 手工加载 .env（Prisma Client 不保证自动加载）
try {
  const envTxt = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8')
  for (const line of envTxt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
} catch (e) {
  /* ignore */
}

const { PrismaClient } = require(path.join(BACKEND, 'node_modules', '@prisma', 'client'))
const prisma = new PrismaClient()
const ts = require(path.join(BACKEND, 'node_modules', 'typescript'))

const DIST_PARSER_UTIL = path.join(BACKEND, 'dist', 'modules', 'ai', 'parser', 'parser.util.js')
const DIST_RULE_PARSER = path.join(BACKEND, 'dist', 'modules', 'ai', 'parser', 'rule.parser.js')

let pass = 0
let fail = 0
const ok = (name, cond, extra) => {
  if (cond) {
    pass++
    console.log('  ✅ ' + name)
  } else {
    fail++
    console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : ''))
  }
}

/**
 * 载入「改动前」的 RuleParser 源码
 *
 * ⚠️ 本机沙箱**不允许 node 里 spawn git**（实测 `spawnSync git EBUSY`），
 *    所以默认走「先用 git 把旧版源码落成文件、脚本读文件」这条路：
 *      cd 仓库根 && git show 8fd6b81:backend/src/modules/ai/parser/rule.parser.ts \
 *        > 自测证据/采购需求-20260925/_old-rule.parser.ts
 *    文件存在就直接读；不存在再尝试 git（在别的环境里 git 可用）；
 *    两条路都不通就明确报错并给出上面的命令，**绝不偷偷跳过这项取证**。
 */
const OLD_SRC_FILE =
  process.env.OLD_RULE_SRC ||
  path.join(REPO, '自测证据', '采购需求-20260925', '_old-rule.parser.ts')

function loadOldRuleParser() {
  let src = ''
  if (fs.existsSync(OLD_SRC_FILE)) {
    src = fs.readFileSync(OLD_SRC_FILE, 'utf8')
    console.log(`  （旧版源码读自文件：${OLD_SRC_FILE}）`)
  } else {
    try {
      src = execFileSync('git', ['show', `${BASELINE}:${REL_PATH}`], {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      })
      console.log('  （旧版源码读自 git show）')
    } catch (e) {
      console.error(
        `\n拿不到 ${BASELINE} 版的 rule.parser.ts。请先执行：\n` +
          `  cd "${REPO}" && git show ${BASELINE}:${REL_PATH} > "${OLD_SRC_FILE}"\n`,
      )
      throw e
    }
  }
  // 防呆：确认读到的确实是「还没有 unmatched」的旧版
  if (/unmatched\s*:/.test(src)) {
    console.warn('  ⚠️ 读到的「旧版」源码里已经出现 unmatched —— 基线选错了，本次对比无意义')
  }

  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
    },
  }).outputText

  // 最小 require 桩：@nestjs/common 的 Injectable 是空装饰器；./parser.util 指到当前 dist
  const nestStub = { Injectable: () => (target) => target }
  const fakeRequire = (id) => {
    if (id === '@nestjs/common') return nestStub
    if (id === './parser.util') return require(DIST_PARSER_UTIL)
    if (id === './parser.types') return {}
    return require(id)
  }
  const mod = { exports: {} }
  const fn = new Function('exports', 'require', 'module', '__decorate', js)
  // __decorate：tslib 的小替身，够用即可
  const __decorate = (decorators, target) => {
    for (let i = decorators.length - 1; i >= 0; i--) {
      const r = decorators[i](target)
      if (r) target = r
    }
    return target
  }
  fn(mod.exports, fakeRequire, mod, __decorate)
  return mod.exports.RuleParser
}

/** 对比时用：只保留契约里的老字段（`unmatched` 是本次新增，单独说） */
const OLD_KEYS = ['items', 'remark', 'deliveryDateLabel', 'deliveryDate', 'total', 'matchedCount', 'hasUnmatched', 'rawText', 'parser']
const pickOld = (r) => {
  const o = {}
  for (const k of OLD_KEYS) o[k] = r[k]
  return o
}

const CASES = [
  '土豆50斤，荷兰豆20斤',
  '荷兰豆20斤',
  '土豆',
  '五花肉10斤',
  '白菜两颗，明天早上送到',
  '大姜3斤 小葱2把',
  '今天要500斤白菜',
  '来点鸡蛋一箱',
  '土豆50斤，荷兰豆20斤，秋葵10斤，紫苏5斤',
  '有机菜花2个 要嫩的',
  '土豆块5斤',
  '上海青5斤，下午送到朝阳路3号',
  '小白菜\t3斤\n荷兰豆1斤',
  '大白菜、土豆、五花肉 各5斤',
  '',
  'A',
  '明天下午三点前送到 白菜5斤',
]

;(async () => {
  console.log('='.repeat(64))
  console.log(`卡B3 取证 · rule.parser 补 unmatched 前后「老字段逐字节一致」`)
  console.log(`基线提交 = ${BASELINE}（旧代码取自 git，非脚本里另抄一份）`)
  console.log('='.repeat(64))

  const OldRuleParser = loadOldRuleParser()
  const { RuleParser: NewRuleParser } = require(DIST_RULE_PARSER)
  const oldP = new OldRuleParser()
  const newP = new NewRuleParser()

  // 同一批商品行（与后端线上路径一致：status=1，按 id 升序）
  const products = await prisma.product.findMany({ where: { status: 1 }, orderBy: { id: 'asc' } })
  console.log(`\n商品行 ${products.length} 条（status=1）｜用例 ${CASES.length} 条\n`)

  let sameCount = 0
  for (const text of CASES) {
    const oldR = await oldP.parse(text, products)
    const newR = await newP.parse(text, products)
    const a = JSON.stringify(pickOld(oldR))
    const b = JSON.stringify(pickOld(newR))
    const same = a === b
    if (same) sameCount++
    console.log(`  ${same ? '✅' : '❌'} 输入 ${JSON.stringify(text)}`)
    console.log(`      旧: ${a}`)
    console.log(`      新: ${b}`)
    console.log(`      新增字段 unmatched: ${JSON.stringify(newR.unmatched)}（旧版没有这个字段）`)
  }

  ok(`老字段逐字节一致：${sameCount}/${CASES.length} 条用例全部相同`, sameCount === CASES.length)

  // 直说：新字段确实带来了新信息（否则这个补丁没意义）
  const withUnmatched = []
  for (const text of CASES) {
    const r = await newP.parse(text, products)
    if ((r.unmatched || []).length) withUnmatched.push([text, r.unmatched])
  }
  console.log('\n  新能力：这些用例现在能报出「没认出来的菜名」=')
  withUnmatched.forEach(([t, u]) => console.log(`    ${JSON.stringify(t)} → ${JSON.stringify(u)}`))
  ok('新字段确实填出了菜名（补丁有效，不是空字段）', withUnmatched.length > 0)

  // 只有 unmatched 一个新增键
  const oldKeys = Object.keys(await oldP.parse('土豆', products)).sort()
  const newKeys = Object.keys(await newP.parse('土豆', products)).sort()
  const added = newKeys.filter((k) => !oldKeys.includes(k))
  const removed = oldKeys.filter((k) => !newKeys.includes(k))
  console.log(`\n  返回字段集合：旧=${JSON.stringify(oldKeys)}`)
  console.log(`                新=${JSON.stringify(newKeys)}`)
  console.log(`  新增=${JSON.stringify(added)} 删除=${JSON.stringify(removed)}`)
  ok('只**新增**了 unmatched 一个字段，没有任何字段被删/改名', added.length === 1 && added[0] === 'unmatched' && removed.length === 0, { added, removed })

  console.log('\n' + '='.repeat(64))
  console.log(`B3 取证：✅ 通过 ${pass} 项 / ❌ 失败 ${fail} 项`)
  console.log('='.repeat(64))
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
})().catch(async (e) => {
  console.error('脚本异常：', e)
  try {
    await prisma.$disconnect()
  } catch (x) {
    /* ignore */
  }
  process.exit(1)
})
