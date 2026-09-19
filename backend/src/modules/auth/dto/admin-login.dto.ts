import { IsNotEmpty, IsString, Length } from 'class-validator'

/// 后台「账号+密码」登录（拍板 1A）：账号复用 user.name，不新增字段
export class AdminLoginDto {
  @IsNotEmpty({ message: '账号不能为空' })
  @IsString()
  @Length(1, 32)
  username: string

  @IsNotEmpty({ message: '密码不能为空' })
  @IsString()
  @Length(1, 128)
  password: string
}
