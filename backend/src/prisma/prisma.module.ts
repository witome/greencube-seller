import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service'

/// @Global：注册后所有模块可直接注入 PrismaService，无需各自 imports
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
