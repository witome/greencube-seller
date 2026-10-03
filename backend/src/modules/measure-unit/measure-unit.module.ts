import { Module } from '@nestjs/common'
import { MeasureUnitController } from './measure-unit.controller'
import { MeasureUnitService } from './measure-unit.service'
import { AuditModule } from '../audit/audit.module'

@Module({
  imports: [AuditModule],
  controllers: [MeasureUnitController],
  providers: [MeasureUnitService],
  exports: [MeasureUnitService],
})
export class MeasureUnitModule {}
