#!/usr/bin/env node
/**
 * 构建前置拦截（`npm run build:mp-weixin` 的 pre 钩子）
 *
 * 为什么要有它：uni-app 的 CLI 会在 vite 配置加载**之前**就清空输出目录 ——
 * 实测：裸跑 `npm run build:mp-weixin` 虽然被 vite 侧的护栏拦住，但
 * dist/build/mp-weixin 里的出货包**已经被删掉了**（只剩静态配置）。
 * 所以真正能「先拦后清」的位置是 npm 的 pre 钩子：这里不过，uni 根本不会启动，
 * 出货目录分毫不动。
 */
const apiBase = process.env.VITE_API_BASE || ''
const outDir = process.env.UNI_OUTPUT_DIR || ''
const LAN = /(^|\/\/)(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.0\.0\.1|localhost)/

function die(msg) {
  console.error(`\n[构建拦截] ${msg}\n`)
  process.exit(1)
}

if (!apiBase) {
  die(
    '小程序生产构建必须显式提供 VITE_API_BASE（不带的话产物会连局域网，而且会先清空出货目录）。\n' +
      '  · 出货包（上传微信用）：npm run build:prod:mp\n' +
      '  · 自测包（本地模拟器用）：npm run build:self:mp',
  )
}

if (LAN.test(apiBase) && !outDir) {
  die(
    `dist/build/mp-weixin 是出货目录，不许写入局域网地址（${apiBase}）。\n` +
      '  · 自测请用：npm run build:self:mp（输出到 dist/self/mp-weixin）\n' +
      '  · 出货请用：npm run build:prod:mp',
  )
}

console.log(`[构建前置检查] ✅ 接口地址=${apiBase}${outDir ? ` 输出=${outDir}` : ' 输出=dist/build/mp-weixin(出货目录)'}`)
