import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { json, urlencoded } from 'express'
import { join } from 'path'
import { AppModule } from './app.module'

/// 启动前校验关键密钥：缺失或仍用可猜默认值直接拒绝启动，防止生产事故
function assertSecureSecrets() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret === 'lvlifang-dev-secret' || secret === 'lvlifang-dev-secret-change-me' || secret.length < 32) {
    throw new Error('[启动失败] JWT_SECRET 未配置或过弱，请设置 32 位以上随机密钥（见 .env.example）')
  }
}

async function bootstrap() {
  assertSecureSecrets()

  // JSON body 上限 5MB：图片走 base64 JSON 上传（POST /upload/image），与 upload.service
  // 里既有的「单张图片 ≤5MB」校验对齐。Express/Nest 默认 JSON 上限只有 100KB，
  // >100KB 的图片（收款码、手机照片）会在 body-parser 阶段被拦成 PayloadTooLargeError(413)，
  // 根本到不了业务代码，前端只能看到「服务器异常」——2026-09-19 运营后台上传收款码报错根因。
  // 故显式关闭 Nest 默认 bodyParser，按 5MB 自行注册（urlencoded 一并放开，行为对齐）。
  // verify（卡R1）：缓存原始 body 到 req.rawBody —— 微信支付回调验签必须用「原始报文字符串」，
  // JSON.parse→stringify 会丢空格/转义差异导致验签必败（仅内存缓存，无行为变化）。
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  app.use(json({ limit: '5mb', verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf?.toString('utf8') ?? '' } }))
  app.use(json({ limit: '5mb' }))
  app.use(urlencoded({ extended: true, limit: '5mb' }))

  // 静态资源：上传的图片（交付照片 / 收款码 / 付款凭证）
  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads/' })

  // JWT 全局注册（RolesGuard 需要注入 JwtService）
  JwtModule.register({
    secret: process.env.JWT_SECRET!,
    signOptions: { expiresIn: process.env.JWT_EXPIRES || '7d' },
  })

  // 参数校验
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  // 接口版本（预留 /api/v1）
  app.setGlobalPrefix('api')
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })

  // CORS（开发期放开，上线按域名收敛）
  app.enableCors({ origin: process.env.CORS_ORIGIN || '*' })

  const port = process.env.PORT || 3000
  await app.listen(port)
  console.log(`🚀 绿立方后端已启动: http://localhost:${port}/api/v1`)
}
bootstrap()
