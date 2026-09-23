#!/usr/bin/env node
/**
 * 出货包构建 —— **唯一**允许产出「能上传微信」的小程序包的命令。
 *
 * 做三件事：
 *   1. 显式带上生产接口地址（默认 https://api.hsfresh.com/api/v1，可用 VITE_API_BASE 覆盖）
 *   2. 构建到 dist/build/mp-weixin（出货目录）
 *   3. 构建后**自动校验产物**：必须含生产域名、必须不含任何局域网地址、
 *      调试浮窗必须被编译期删净、appid 必须是真实的 —— 任一不过就退出码非 0
 *
 * 用法：npm run build:prod:mp
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = 'dist/build/mp-weixin'
const API_BASE = process.env.VITE_API_BASE || 'https://api.hsfresh.com/api/v1'
const APPID = 'wx82f6deee9c7750e4'
const LAN_PATTERN = /(192\.168\.|127\.0\.0\.1|localhost:3001|10\.\d+\.\d+\.\d+)/

console.log(`[出货包] 生产接口地址=${API_BASE}`)
console.log(`[出货包] 输出目录=${OUT_DIR}\n`)

const child = spawn('npx uni build -p mp-weixin', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_API_BASE: API_BASE },
})

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`\n[出货包] 构建失败，退出码 ${code}`)
    process.exit(code || 1)
  }

  const read = (p) => (existsSync(path.join(OUT_DIR, p)) ? readFileSync(path.join(OUT_DIR, p), 'utf8') : null)
  const checks = []

  const req = read('api/request.js')
  checks.push({
    name: '产物里的接口地址 = 生产域名',
    pass: !!req && req.includes(API_BASE),
    detail: req ? (req.match(/https?:\/\/[^"']*api\/v1/) || ['(未找到)'])[0] : '缺 api/request.js',
  })
  checks.push({
    name: '产物里没有任何局域网地址',
    pass: !!req && !LAN_PATTERN.test(req),
    detail: req && LAN_PATTERN.test(req) ? (req.match(LAN_PATTERN) || [''])[0] : '干净',
  })

  const drs = read('components/DevRoleSwitcher.js')
  checks.push({
    name: '调试浮窗已被编译期删净',
    pass: !!drs && !drs.includes('demo_supplier'),
    detail: drs ? `${drs.length} 字节` : '缺 DevRoleSwitcher.js',
  })

  const cfg = read('project.config.json')
  let cfgAppid = ''
  try {
    cfgAppid = JSON.parse(cfg || '{}').appid || ''
  } catch {
    cfgAppid = '(解析失败)'
  }
  checks.push({ name: `appid = ${APPID}`, pass: cfgAppid === APPID, detail: cfgAppid })

  console.log('')
  for (const c of checks) console.log(`[出货包] ${c.pass ? '✅' : '❌'} ${c.name} → ${c.detail}`)

  const allPass = checks.every((c) => c.pass)
  console.log(`[出货包] 产物时间=${statSync(path.join(OUT_DIR, 'api/request.js')).mtime.toLocaleString('zh-CN')}`)
  console.log(
    `[出货包] 结论：${allPass ? '✅ 可以上传微信 / 出预览码' : '❌ 校验没过，禁止上传'}\n`,
  )
  process.exit(allPass ? 0 : 1)
})
