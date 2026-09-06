import { IsIn, IsNotEmpty } from 'class-validator'
import { Role } from '../../../common/constants/error-codes'

/// 决策 4：切换身份 → 重签 token
/// ⚠️ 只能切换到该用户「已拥有」的身份，服务端校验，客户端无法伪造
export class SwitchRoleDto {
  @IsNotEmpty({ message: 'role 不能为空' })
  @IsIn([Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT], {
    message: 'role 值非法',
  })
  role: string
}
