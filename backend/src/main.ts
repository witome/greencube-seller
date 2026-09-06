import { NestFactory } from '@nestjs/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // JWT 全局注册（RolesGuard 需要注入 JwtService）
  JwtModule.register({
    secret: process.env.JWT_SECRET || 'lvlifang-dev-secret',
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
