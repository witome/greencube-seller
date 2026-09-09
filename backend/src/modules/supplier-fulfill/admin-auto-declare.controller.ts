import { Body, Controller, Post } from '@nestjs/common'
import { IsOptional, IsString, Matches } from 'class-validator'
import { AutoDeclareService } from './auto-declare.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

class RunAutoDeclareDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 格式应为 YYYY-MM-DD' })
  date?: string
}

/// 运营 · 申报超时兜底手动触发（决策 2；正常由每日 22:00 定时任务执行）
@Controller('admin/fulfill')
export class AdminAutoDeclareController {
  constructor(private autoDeclare: AutoDeclareService) {}

  @Post('auto-declare')
  @Roles(Role.ADMIN)
  async run(@CurrentUser('userId') userId: bigint, @Body() dto: RunAutoDeclareDto) {
    return this.autoDeclare.runAutoDeclare(dto.date, userId)
  }
}
