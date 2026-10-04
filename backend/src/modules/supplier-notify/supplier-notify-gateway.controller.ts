import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { SupplierNotifyService } from './supplier-notify.service'

/// 卡BP-1（2026-10-04）：手机专线网关 · 派发 / 回报 / 心跳
///
/// 守卫：请求头 x-gateway-token 必须等于 process.env.SUPPLIER_NOTIFY_GATEWAY_TOKEN，且该 env 非空；
/// env 为空 = 网关接口全部停用（安全默认，403）。令牌缺失/不对 → 401。
/// ⚠️ 不挂 @Roles(ADMIN)——网关不是运营账号，不复用运营角色守卫（RolesGuard 对无 @Roles 的路由本就不拦）。
/// 号码明文只允许出现在 pending-dial 响应里（网关要拨号）；台账/日志一律 maskPhone。

@Injectable()
export class GatewayTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.SUPPLIER_NOTIFY_GATEWAY_TOKEN
    if (!expected) throw new ForbiddenException('网关令牌未配置，接口已停用')
    const got = context.switchToHttp().getRequest().headers['x-gateway-token']
    if (typeof got !== 'string' || got !== expected) throw new UnauthorizedException('网关令牌缺失或不正确')
    return true
  }
}

export class GatewayReportDto {
  @IsString({ message: 'dialId 必须为字符串' }) @MaxLength(128, { message: 'dialId 不能超过 128 字符' }) dialId: string
  @IsIn(['dispatched', 'connected', 'no_answer', 'failed'], { message: 'result 必须为 dispatched | connected | no_answer | failed' })
  result: string
  @IsOptional() @IsInt({ message: 'durationSec 必须为整数' }) @Min(0, { message: 'durationSec 不能为负' }) durationSec?: number
  @IsOptional() @IsString({ message: 'cause 必须为字符串' }) @MaxLength(64, { message: 'cause 不能超过 64 字符' }) cause?: string
}

@Controller('supplier-notify-gateway')
@UseGuards(GatewayTokenGuard)
export class SupplierNotifyGatewayController {
  constructor(private readonly service: SupplierNotifyService) {}

  /// 派发取件：最多 limit 条待拨候选（limit 缺省 5，夹在 1~50）
  @Get('pending-dial')
  pendingDial(@Query('limit') limit?: string) {
    const n = Number.parseInt(limit ?? '', 10)
    return this.service.pendingDial(Number.isFinite(n) ? n : 5)
  }

  /// 回报拨打结果
  @Post('report')
  report(@Body() dto: GatewayReportDto) {
    return this.service.reportResult(dto)
  }

  /// 心跳（180 秒内有心跳 = 网关在线）
  @Post('heartbeat')
  heartbeat() {
    return this.service.heartbeat()
  }
}
