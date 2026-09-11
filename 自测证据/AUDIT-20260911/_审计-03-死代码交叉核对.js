/* 交叉核对：前端 API 声明 → 后端实际路由，找出指向已移除接口的死代码 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../../')

// ── 1. 收集后端路由 ──
function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (f.endsWith('.controller.ts')) out.push(p)
  }
  return out
}
const routes = new Set()
for (const f of walk(path.join(root, 'backend/src'))) {
  const src = fs.readFileSync(f, 'utf8')
  const cm = src.match(/@Controller\(['"`]([^'"`]*)['"`]\)/)
  const base = cm ? cm[1] : ''
  const lines = src.split(/\r?\n/)
  lines.forEach((ln) => {
    const dm = ln.match(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/)
    if (!dm) return
    const method = dm[1].toUpperCase()
    const sub = dm[2].replace(/['"`]/g, '').trim()
    let full = '/' + base + (sub ? '/' + sub : '')
    full = full.replace(/\/+/g, '/')
    routes.add(method + ' ' + full)
  })
}
console.log('后端路由总数:', routes.size)

// ── 2. 解析前端 API 声明 ──
function parseApi(file, label) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split(/\r?\n/)
  const out = []
  lines.forEach((ln, i) => {
    const m = ln.match(/([A-Za-z0-9_]+)\s*:\s*\([^)]*\)\s*=>\s*request\.(get|post|put|delete|patch)\(\s*([`'"])([^`'"]+)\3/)
    if (!m) return
    const method = m[2].toUpperCase()
    // 模板变量 ${id} → :id
    let url = m[4].replace(/\$\{[^}]+\}/g, ':id').replace(/\/+/g, '/')
    out.push({ file: label, line: i + 1, name: m[1], method, url, raw: ln.trim() })
  })
  return out
}

const apiFiles = [
  [path.join(root, 'admin-web/src/api/modules.js'), 'admin-web/src/api/modules.js'],
  [path.join(root, 'frontend/src/api/modules.js'), 'frontend/src/api/modules.js'],
]

let dead = []
let ok = 0
for (const [f, label] of apiFiles) {
  if (!fs.existsSync(f)) { console.log('（缺）', label); continue }
  const apis = parseApi(f, label)
  console.log('\n### ' + label + ' 共 ' + apis.length + ' 条 API 声明')
  for (const a of apis) {
    const key = a.method + ' ' + a.url
    if (routes.has(key)) { ok++; continue }
    // 尝试宽松匹配（后端 base 里可能带 admin/ 前缀或参数名不同）
    const loose = [...routes].filter((r) => r.replace(/:[A-Za-z0-9_]+/g, ':id') === key)
    dead.push({ ...a, loose })
  }
}

console.log('\n=== 命中后端路由:', ok, '===')
console.log('\n=== ★ 疑似死代码（前端声明但后端无此路由）:', dead.length, '===')
for (const d of dead) {
  console.log('  ' + d.file + ':' + d.line + '  ' + d.name + '  ' + d.method + ' ' + d.url + (d.loose.length ? '   (宽松匹配到: ' + d.loose.join(', ') + ')' : '   ← 后端完全无'))
  console.log('      ' + d.raw)
}
