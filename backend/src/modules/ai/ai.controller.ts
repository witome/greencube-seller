import { Controller, Post, Body } from '@nestjs/common'
import { AiService } from './ai.service'
import { ParseDto } from './dto/parse.dto'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// AI 客服下单引擎
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  /// 解析自然语言 → 订单草稿
  /// 带 draft = 多轮口径（这句话作用在当前草稿上，返回合并后的完整 items）；
  /// 不带 draft = 老口径，行为与本接口 2026-09-23 版完全一致。
  @Post('parse')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async parse(@Body() dto: ParseDto) {
    const draft = dto.draft !== undefined
      ? { items: dto.draft, deliveryDate: dto.draftDeliveryDate, remark: dto.draftRemark }
      : undefined
    return this.service.parse(dto.text, draft)
  }
}
