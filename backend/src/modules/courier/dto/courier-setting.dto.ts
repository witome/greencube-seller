import { IsInt, IsIn } from 'class-validator'

/// 上下线（0 下线 / 1 上线）
export class SetOnlineDto {
  @IsInt()
  @IsIn([0, 1])
  online: number
}

/// 接单模式（0 手动 / 1 自动接单）
export class SetAutoAcceptDto {
  @IsInt()
  @IsIn([0, 1])
  autoAccept: number
}
