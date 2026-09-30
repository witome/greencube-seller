import { IsBoolean, IsOptional } from 'class-validator'

/// 采购方自助注销（卡AC · 2026-09-30）
///
/// 只认一个字段：confirm。
/// ⚠️ 必须**显式**传 true —— 缺省 / false / 传字符串 "true" 一律参数错（1001）。
///    前端已有「4 条后果 + 勾选已知晓」二次确认页，这里是服务端兜底，
///    防止误触或被别处直接调接口把账号注销掉。
/// ⚠️ 全局 ValidationPipe whitelist:true 会剥离未声明字段，夹带任何别的东西都会被丢弃。
export class CancelAccountDto {
  /// 声明为可选是为了拿到「缺省即参数错」的人话提示；
  /// 真正的判定在 service 里做（@IsBoolean() 只负责类型：传了非布尔值走「格式错误」）
  @IsOptional()
  @IsBoolean({ message: 'confirm 必须是 true 或 false' })
  confirm?: boolean
}
