import { IsNotEmpty, IsString, Length } from 'class-validator'

/// 微信登录：wx.login() 拿到的临时 code
export class WxLoginDto {
  @IsNotEmpty({ message: 'code 不能为空' })
  @IsString()
  code: string
}
