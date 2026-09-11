import { Controller, Post, Body } from '@nestjs/common'
import { AiService } from './ai.service'
import { ParseDto } from './dto/parse.dto'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// AI 客服下单引擎
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  /// 解析自然语言 → 订单草稿
  @Post('parse')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async parse(@Body() dto: ParseDto) {
    return this.service.parse(dto.text)
  }
}
