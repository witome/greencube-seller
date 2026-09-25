import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { RuleParser } from './parser/rule.parser'
import { LlmParser } from './parser/llm.parser'
import { SupplierAiService } from './supplier-ai.service'
import { SupplierRuleParser } from './parser/supplier.rule.parser'
import { SupplierLlmParser } from './parser/supplier.llm.parser'
import { AuditModule } from '../audit/audit.module'

// 采购方 /ai/parse 的 provider 一个没动；供应商语音链路是 2026-09-25 卡U 纯新增
@Module({
  imports: [AuditModule],
  controllers: [AiController],
  providers: [AiService, RuleParser, LlmParser, SupplierAiService, SupplierRuleParser, SupplierLlmParser],
})
export class AiModule {}
