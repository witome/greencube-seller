import { defineConfig, loadEnv } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/**
 * 构建护栏（2026-09-23 加，背景见 CODEBUDDY.md「小程序自测通道」）
 *
 * 问题：`npm run build:mp-weixin` 不带地址也能"构建成功"，产物落到源码兜底的
 * 局域网地址（192.168.1.78:3001），并且会覆盖 dist/build/mp-weixin —— 而那个目录
 * 是**出货目录**（上传微信 / 出预览码用的）。实测已经发生过一次：9/21 那份连生产的
 * 包被自测构建覆盖成连局域网版。
 *
 * 规则（只对 mp-weixin 的生产构建生效，H5 不受影响）：
 *   1. 必须**显式**提供 VITE_API_BASE，不许走源码里的兜底；
 *   2. 输出到默认出货目录（dist/build/mp-weixin）时，地址不许是局域网 ——
 *      自测请用 `npm run build:self:mp`（输出到 dist/self/mp-weixin，不碰出货目录）。
 */
function guardProdMpBuild({ mode, command }) {
  return {
    name: 'lvlf-guard-prod-mp-build',
    configResolved() {
      const isProdMpBuild =
        command === 'build' && mode === 'production' && process.env.UNI_PLATFORM === 'mp-weixin'
      if (!isProdMpBuild) return

      const env = loadEnv(mode, process.cwd(), '')
      const apiBase = process.env.VITE_API_BASE || env.VITE_API_BASE || ''
      const outDir = process.env.UNI_OUTPUT_DIR || ''

      if (!apiBase) {
        throw new Error(
          '\n[构建拦截] 小程序生产构建必须显式提供 VITE_API_BASE，不许走源码兜底（那是局域网地址）。\n' +
            '  · 出货包（上传微信用）：npm run build:prod:mp\n' +
            '  · 自测包（只给本地模拟器/自测用）：npm run build:self:mp\n',
        )
      }

      const isLan = /(^|\/\/)(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.0\.0\.1|localhost)/.test(
        apiBase,
      )
      if (isLan && !outDir) {
        throw new Error(
          `\n[构建拦截] dist/build/mp-weixin 是出货目录，不许写入局域网地址（${apiBase}）。\n` +
            '  · 自测请用：npm run build:self:mp（输出到 dist/self/mp-weixin）\n' +
            '  · 出货请用：npm run build:prod:mp（自动带生产域名并校验产物）\n',
        )
      }

      console.log(`[构建护栏] 平台=${process.env.UNI_PLATFORM} 接口地址=${apiBase} 输出=${outDir || 'dist/build/mp-weixin'}`)
    },
  }
}

export default defineConfig(({ mode, command }) => ({
  plugins: [uni(), guardProdMpBuild({ mode, command })],
  server: {
    port: 5180, // 固定端口（5173/5174 被其他项目占用）
    strictPort: true,
  },
}))
