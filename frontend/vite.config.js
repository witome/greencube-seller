import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  server: {
    port: 5180,      // 固定端口（5173/5174 被其他项目占用）
    strictPort: true,
  },
})
