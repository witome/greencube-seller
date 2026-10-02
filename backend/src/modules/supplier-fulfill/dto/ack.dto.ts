import { IsInt } from 'class-validator'

/// 卡BM（2026-10-02）：接单接口入参校验（此前为裸类型 { orderId: number }，
/// 非法入参在 BigInt(dto.orderId) 处抛 500；交由全局 ValidationPipe 拦成 400）
export class AckDto {
  @IsInt({ message: 'orderId 必须为整数' })
  orderId: number
}
