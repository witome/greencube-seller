/* 审计调用点枚举：列出所有 this.audit.log({...}) 的位置、action 常量、所属方法 */
const fs = require('fs')
const path = require('path')

function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f)
    const s = fs.statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (f.endsWith('.ts')) out.push(p)
  }
  return out
}

const root = path.resolve(__dirname, '../../backend')
const files = walk(path.join(root, 'src'))
const sites = []

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const hasAuditSvc = /this\.audit\.log\(/.test(src)
  const hasDirect = /prisma\.auditLog\.create\(/.test(src)
  if (!hasAuditSvc && !hasDirect) continue
  const lines = src.split(/\r?\n/)
  lines.forEach((ln, i) => {
    const isSvc = /this\.audit\.log\(/.test(ln)
    const isDirect = /prisma\.auditLog\.create\(/.test(ln)
    if (!isSvc && !isDirect) return
    // action 常量：向后 10 行内找 action:
    let action = '?'
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      const am = lines[j].match(/action:\s*['"`]([^'"`]+)['"`]/)
      if (am) { action = am[1]; break }
      const am2 = lines[j].match(/action:\s*(.+?),?\s*$/)
      if (am2) { action = am2[1].trim(); break }
    }
    let entity = '?'
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      const em = lines[j].match(/entity:\s*['"`]([^'"`]+)['"`]/) || lines[j].match(/entity:\s*([A-Za-z0-9_.]+)/)
      if (em) { entity = em[1]; break }
    }
    // 所属方法：向上找最近的 async xxx(
    let owner = '?'
    for (let j = i; j >= 0; j--) {
      const mm = lines[j].match(/^\s{2}(?:async\s+)?([A-Za-z0-9_]+)\s*\(/)
      if (mm) { owner = mm[1]; break }
    }
    sites.push({ file: path.relative(root, f).replace(/\\/g, '/'), line: i + 1, action, entity, owner, via: isDirect ? 'prisma.auditLog.create(直写)' : 'this.audit.log(标准)' })
  })
}

console.log('=== 审计调用点总计:', sites.length, '===')
sites
  .sort((a, b) => (a.file + a.line).localeCompare(b.file + b.line, undefined, { numeric: true }))
  .forEach((s) => console.log('  ' + s.file + ':' + s.line + '  [' + s.owner + ']  action=' + s.action + '  entity=' + s.entity + '  途径=' + s.via))

console.log('\n=== 按文件计数 ===')
const byFile = {}
sites.forEach((s) => { byFile[s.file] = (byFile[s.file] || 0) + 1 })
Object.entries(byFile).sort().forEach(([k, v]) => console.log('  ' + k + ': ' + v))

console.log('\n=== 唯一 action 常量清单 ===')
const actions = [...new Set(sites.map((s) => s.action))].sort()
actions.forEach((a) => console.log('  ' + a))
console.log('  合计唯一 action:', actions.length)
