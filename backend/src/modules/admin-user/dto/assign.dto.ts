import { IsInt } from 'class-validator'

/// 分配业务员
export class AssignDto {
  @IsInt({ message: 'agentId 必须为整数' })
  agentId: number
}
