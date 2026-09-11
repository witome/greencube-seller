/* frontend API → 后端路由 交叉核对（frontend 写法是 post()/get()，非 request.post()） */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '../../')

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
  src.split(/\r?\n/).forEach((ln) => {
    const dm = ln.match(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/)
    if (!dm) return
    const method = dm[1].toUpperCase()
    const sub = dm[2].replace(/['"`]/g, '').trim()
    routes.add(method + ' ' + ('/' + base + (sub ? '/' + sub : '')).replace(/\/+/g, '/'))
  })
}
console.log('后端路由数:', routes.size)

const targets = []
function walkAll(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    if (fs.statSync(p).isDirectory()) walkAll(p)
    else if (f.endsWith('.js')) targets.push(p)
  }
}
walkAll(path.join(root, 'frontend/src/api'))

for (const p of targets) {
  const rel = path.relative(root, p).replace(/\\/g, '/')
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
  const dead = []
  lines.forEach((ln, i) => {
    const m = ln.match(/\b(get|post|put|del|patch)\s*\(\s*([`'"])([^`'"]+)\2/)
    if (!m) return
    const method = m[1].toUpperCase().replace('DEL', 'DELETE')
    const url = m[3].replace(/\$\{[^}]+\}/g, ':id').replace(/\/+/g, '/')
    const key = method + ' ' + url
    if (!routes.has(key)) {
      const loose = [...routes].filter((r) => r.replace(/:[A-Za-z0-9_]+/g, ':id') === key)
      dead.push({ line: i + 1, m: method + ' ' + url, loose, raw: ln.trim() })
    }
  })
  console.log('\n=== ' + rel + ' 疑似死代码: ' + dead.length + ' ===')
  dead.forEach((d) =>
    console.log('  :' + d.line + '  ' + d.m + (d.loose.length ? '  (宽松匹配到: ' + d.loose.join(', ') + ')' : '  ← 后端完全无') + '\n      ' + d.raw),
  )
}
