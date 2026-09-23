#!/usr/bin/env node
/**
 * 自测包构建 —— 只给本地开发者工具/模拟器自测用。
 *
 * 与「出货包」的区别：
 *   · 输出到 `dist/self/mp-weixin`（**不碰** dist/build/mp-weixin 出货目录）
 *   · 接口地址显式写死局域网后端（默认 http://192.168.1.78:3001/api/v1，可用
 *     VITE_API_BASE 覆盖），配本机后端 WX_MOCK_LOGIN=1 用
 *
 * 用法：npm run build:self:mp
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const OUT_DIR = 'dist/self/mp-weixin'
const API_BASE = process.env.VITE_API_BASE || 'http://192.168.1.78:3001/api/v1'

console.log(`[自测包] 接口地址=${API_BASE}\n[自测包] 输出目录=${OUT_DIR}（出货目录 dist/build/mp-weixin 不会被改动）\n`)

const child = spawn('npx uni build -p mp-weixin', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, UNI_OUTPUT_DIR: OUT_DIR, VITE_API_BASE: API_BASE },
})

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`\n[自测包] 构建失败，退出码 ${code}`)
    process.exit(code || 1)
  }

  const probe = path.join(OUT_DIR, 'api/request.js')
  if (!existsSync(probe)) {
    console.error(`\n[自测包] 校验失败：产物里找不到 ${probe}`)
    process.exit(1)
  }
  const text = readFileSync(probe, 'utf8')
  const ok = text.includes(API_BASE)
  const leaked = /hsfresh\.com/.test(text)
  const builtAt = statSync(probe).mtime.toLocaleString('zh-CN')

  console.log(`\n[自测包] 产物时间=${builtAt}`)
  console.log(`[自测包] 产物接口地址含 ${API_BASE}：${ok ? '✅' : '❌'}`)
  console.log(`[自测包] 产物是否误连生产域名：${leaked ? '❌ 有 hsfresh.com' : '✅ 无'}`)
  console.log(
    `[自测包] 结论：${ok && !leaked ? '✅ 可用（自测专用，禁止上传微信）' : '❌ 校验没过，别拿去自测'}\n`,
  )
  process.exit(ok && !leaked ? 0 : 1)
})
