/* 端点枚举：列出后端所有 controller 的写操作端点（POST/PUT/PATCH/DELETE） */
const fs = require('fs')
const path = require('path')

function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (f.endsWith('.controller.ts')) out.push(p)
  }
  return out
}

const root = path.resolve(__dirname, '../../backend')
const files = walk(path.join(root, 'src'))
const rows = []

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const lines = src.split(/\r?\n/)
  const cm = src.match(/@Controller\(['"`]([^'"`]*)['"`]\)/)
  const base = cm ? cm[1] : '?'
  lines.forEach((ln, i) => {
    const dm = ln.match(/@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/)
    if (!dm) return
    const method = dm[1].toUpperCase()
    const sub = dm[2].replace(/['"`]/g, '').trim()
    let name = '?'
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const mm = lines[j].match(/(?:async\s+)?([A-Za-z0-9_]+)\s*\(/)
      if (mm && !/^\s*@/.test(lines[j])) { name = mm[1]; break }
    }
    let roles = ''
    for (let j = i; j < Math.min(i + 5, lines.length); j++) {
      const rm = lines[j].match(/@Roles\(([^)]*)\)/)
      if (rm) { roles = rm[1].replace(/\s/g, ''); break }
    }
    rows.push({ file: path.relative(root, f).replace(/\\/g, '/'), line: i + 1, method, base, sub, name, roles })
  })
}

const writes = rows.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method))
const reads = rows.filter((r) => r.method === 'GET')

console.log('=== 端点总计:', rows.length, '| 写操作:', writes.length, '| 只读GET:', reads.length, '===')

const byMod = {}
writes.forEach((r) => {
  const m = r.file.replace('src/modules/', '').split('/')[0]
  byMod[m] = (byMod[m] || 0) + 1
})
console.log('\n=== 写操作按模块统计 ===')
Object.entries(byMod).sort().forEach(([k, v]) => console.log('  ' + k + ': ' + v))

console.log('\n=== 写操作全明细（按模块） ===')
let cur = ''
writes
  .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line, undefined, { numeric: true }))
  .forEach((r) => {
    const m = r.file.replace('src/modules/', '').split('/')[0]
    if (m !== cur) { cur = m; console.log('\n### ' + m) }
    console.log('  ' + r.method.padEnd(6) + ' ' + ('/' + r.base + (r.sub ? '/' + r.sub : '')).padEnd(50) + ' ' + r.name.padEnd(24) + ' ' + r.file + ':' + r.line + '  [' + r.roles + ']')
  })

console.log('\n=== 只读 GET 明细（按模块计） ===')
const readByMod = {}
reads.forEach((r) => { const m = r.file.replace('src/modules/', '').split('/')[0]; readByMod[m] = (readByMod[m] || 0) + 1 })
Object.entries(readByMod).sort().forEach(([k, v]) => console.log('  ' + k + ': ' + v))
