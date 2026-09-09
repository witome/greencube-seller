import { NestFactory } from '@nestjs/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
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

  const app = await NestFactory.create(AppModule)

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
