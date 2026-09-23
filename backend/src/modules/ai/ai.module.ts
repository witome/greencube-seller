import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { RuleParser } from './parser/rule.parser'
import { LlmParser } from './parser/llm.parser'

@Module({
  controllers: [AiController],
  providers: [AiService, RuleParser, LlmParser],
})
export class AiModule {}
