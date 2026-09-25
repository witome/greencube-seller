import { Controller, Post, Body } from '@nestjs/common'
import { AiService } from './ai.service'
import { SupplierAiService } from './supplier-ai.service'
import { ParseDto } from './dto/parse.dto'
import { SupplierParseDto, SupplierAuditTrailDto } from './dto/supplier-parse.dto'
import { Roles, Role } from '../../common/decorators/roles.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

/// AI 客服下单引擎
@Controller('ai')
export class AiController {
  constructor(
    private readonly service: AiService,
    private readonly supplierService: SupplierAiService,
  ) {}

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

  /// 供应商端「语音报量 / 改价」解析（2026-09-25 卡U，独立链路）
  /// 🔒 /ai/parse 的行为与响应一个字节没动；本接口只解析不落库
  ///    （改量走 PUT /supplier-goods/:id/stock 免审、改价走 POST /supplier-goods/:id/change 审核制）
  @Post('supplier-parse')
  @Roles(Role.SUPPLIER)
  async supplierParse(@CurrentUser() user: any, @Body() dto: SupplierParseDto) {
    return this.supplierService.parse(user.userId, dto)
  }

  /// 语音报量留痕：识别原文 + 提交值 → 现有审计日志（audit_log，不新增表不改 schema）
  @Post('supplier-audit-trail')
  @Roles(Role.SUPPLIER)
  async supplierAuditTrail(@CurrentUser() user: any, @Body() dto: SupplierAuditTrailDto) {
    return this.supplierService.auditTrail(user.userId, dto)
  }
}
