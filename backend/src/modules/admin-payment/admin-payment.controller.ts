import { Controller, Get, Query } from '@nestjs/common'
import { AdminPaymentService } from './admin-payment.service'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/**
 * 运营 · 支付流水（只读）
 *
 * 权限（铁律 3）：仅运营。
 * - 配送员不碰钱 → 不返回任何支付流水
 * - 供应商不见销售价 → 不返回任何支付流水
 * - 业务员（决策 5）仅限采购方审核 → 不应看到金额类流水
 *
 * ⚠️ 本卡只加只读查询：不改 schema、不动支付链路、不提供任何写操作。
 */
@Controller('admin/payments')
export class AdminPaymentController {
  constructor(private readonly service: AdminPaymentService) {}

  /// 支付流水列表（分页 + 状态筛选 + 单号/订单号搜索，默认 createdAt 倒序）
  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() query: any) {
    return this.service.list(query)
  }
}
