import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common'
import { Response } from 'express'
import { DemandService } from './demand.service'
import { DemandCreateDto, DemandMergeDto, DemandUpdateDto } from './dto/demand.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/**
 * 运营侧 · 采购需求
 *
 * ⚠️ 路由顺序有讲究：`GET export` 必须声明在 `GET :id` **之前**，
 *    否则 `/admin/demand/export` 会被当成 `:id = "export"` 命中，导出永远 404。
 */
@Controller('admin/demand')
export class AdminDemandController {
  constructor(private readonly service: DemandService) {}

  /** 列表（分页 + status/keyword 筛选 + 排序）与统计卡 */
  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() query: any) {
    return this.service.adminList(query)
  }

  /**
   * 导出 CSV（带 BOM，Excel 能直接打开）
   * 用 @Res() 直接写响应、绕开全局 { code, msg, data } 信封 —— 否则浏览器下到的是 JSON。
   * （Nest 源码：标注 @Res() 且未开 passthrough 时不会再 apply 拦截器结果，故不会重复发送）
   */
  @Get('export')
  @Roles(Role.ADMIN)
  async exportCsv(@Query() query: any, @Res() res: Response) {
    const csv = await this.service.adminExportCsv(query)
    // 文件名用**本地日期**：toISOString() 是 UTC，晚上导出会写成前一天
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="purchase-demand-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(
        `采购需求-${stamp}.csv`,
      )}`,
    )
    res.send(csv)
  }

  /** 通知预览：三类名单（可发订阅消息 / 48 小时内可发客服消息 / 发不了带原因） */
  @Get(':id/notify-preview')
  @Roles(Role.ADMIN)
  async notifyPreview(@Param('id') id: string) {
    return this.service.notifyPreview(Number(id))
  }

  /** 明细下钻（谁要的 / 时间 / 原话片段 / 数量 / 该客户能不能发） */
  @Get(':id')
  @Roles(Role.ADMIN)
  async detail(@Param('id') id: string) {
    return this.service.adminDetail(Number(id))
  }

  /** 改 status / note / name */
  @Put(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: DemandUpdateDto,
    @CurrentUser('userId') userId: bigint,
  ) {
    return this.service.adminUpdate(Number(id), dto, userId)
  }

  /** 合并到另一条（明细与计数并入，源行删除） */
  @Post(':id/merge')
  @Roles(Role.ADMIN)
  async merge(
    @Param('id') id: string,
    @Body() dto: DemandMergeDto,
    @CurrentUser('userId') userId: bigint,
  ) {
    return this.service.adminMerge(Number(id), dto, userId)
  }

  /** 实发到货通知（逐人落 demand_notify_log） */
  @Post(':id/notify')
  @Roles(Role.ADMIN)
  async notify(@Param('id') id: string, @CurrentUser('userId') userId: bigint) {
    return this.service.adminNotify(Number(id), userId)
  }

  /** 手动新增（电话/微信来的需求，source=2） */
  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: DemandCreateDto, @CurrentUser('userId') userId: bigint) {
    return this.service.adminCreate(dto, userId)
  }
}
