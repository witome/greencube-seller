import { Injectable, Logger } from '@nestjs/common'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { WxService } from './wx.service'

/**
 * 小程序「交易管理服务 · 发货信息管理」接口客户端（卡S1 · 2026-09-29）
 *
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/server/API/order_shipping/
 *
 * 为什么单独一个 client，不并进 WxService：
 *   WxService 的语义是「消息发送能力」（订阅消息/客服消息），失败一般是「这次通知没发出去」；
 *   发货管理是**交易合规能力**，它的 errcode 决定「要不要重试、还能不能重试」——
 *   两者错误口径不同，混在一起会让重试逻辑长在错误的层上。
 *
 * ⚠️ 四条实测契约（2026-09-29 用生产 access_token 逐条验过，别照博客/旧文档写）：
 *   1. 这一族接口**全部必须 POST**（用 GET 打回 `43002 require POST method`）。
 *   2. `is_trade_managed` / `is_trade_management_confirmation_completed` 的请求体
 *      **必填 `appid`**（POST 空体回 `40097 invalid args`）。
 *   3. `get_order`（查发货状态）的字段名与录入接口**不一样**：
 *      查询体是 `{merchant_id, merchant_trade_no}`（**不是** mchid/out_trade_no），
 *      传成录入那套回 `47001 data format error`（我们真踩过）。
 *   4. `opspecialorder` 的订单号字段叫 **`order_id`**，且可传「微信支付单号」**或「商户单号」**
 *      —— 我们用商户单号（= payment_record.payNo），不必存 transaction_id。
 */
@Injectable()
export class WxOrderClient {
  private readonly logger = new Logger(WxOrderClient.name)

  constructor(private readonly wx: WxService) {}

  private get apiBase(): string {
    return (process.env.WX_API_BASE || 'https://api.weixin.qq.com').replace(/\/+$/, '')
  }

  /** 统一 POST。网络层异常只回固定文案（URL 里带 access_token，绝不外泄） */
  private async post(path: string, body: any): Promise<any> {
    const token = await this.wx.getAccessToken()
    const url = `${this.apiBase}${path}?access_token=${token}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      return await res.json()
    } catch {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '连接微信服务失败，请稍后重试')
    }
  }

  /// 查小程序是否已开通发货信息管理服务（联调第一步；没开通报业务错，前端给「去后台接入」的提示）
  async isTradeManaged(): Promise<boolean> {
    const appid = process.env.WX_APPID
    if (!appid) throw new BizException(ErrorCode.INTERNAL_ERROR, 'WX_APPID 未配置')
    const data = await this.post('/wxa/sec/order/is_trade_managed', { appid })
    if (data?.errcode !== 0) {
      throw new BizException(
        ErrorCode.INTERNAL_ERROR,
        `查询发货信息管理开通状态失败（${data?.errcode ?? '未知'}）`,
      )
    }
    return !!data?.is_trade_managed
  }

  /// 查是否已完成「交易结算管理确认」（= 已关联的所有商户号都完成了订单管理授权或解绑）
  async isTradeManagementConfirmed(): Promise<boolean> {
    const appid = process.env.WX_APPID
    if (!appid) throw new BizException(ErrorCode.INTERNAL_ERROR, 'WX_APPID 未配置')
    const data = await this.post('/wxa/sec/order/is_trade_management_confirmation_completed', { appid })
    if (data?.errcode !== 0) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, `查询交易结算管理确认失败（${data?.errcode ?? '未知'}）`)
    }
    return !!data?.completed
  }

  /**
   * 发货信息录入（送达后调用）
   * 本项目是同城配送/自提，不需要快递单号：`shipping_list` 只填必填的 `item_desc`。
   * 返回原始 errcode/errmsg，由 service 翻译成「成功 / 幂等成功 / 不可重试 / 可重试」。
   */
  async uploadShippingInfo(params: {
    outTradeNo: string
    mchid: string
    logisticsType: number
    deliveryMode: number
    itemDesc: string
    openid: string
    uploadTime: string
  }): Promise<{ errcode: number; errmsg: string }> {
    const data = await this.post('/wxa/sec/order/upload_shipping_info', {
      // 订单单号类型 1 = 商户号 + 商户侧单号（我们不用微信支付单号，省得存 transaction_id）
      order_key: { order_number_type: 1, mchid: params.mchid, out_trade_no: params.outTradeNo },
      delivery_mode: params.deliveryMode,
      logistics_type: params.logisticsType,
      shipping_list: [{ item_desc: params.itemDesc }],
      upload_time: params.uploadTime, // RFC 3339
      payer: { openid: params.openid },
    })
    return { errcode: Number(data?.errcode ?? -1), errmsg: String(data?.errmsg ?? '') }
  }

  /// 查询订单发货状态（对账/补偿用。⚠️ 字段名是 merchant_id / merchant_trade_no）
  async getOrderShipping(merchantTradeNo: string, mchid: string): Promise<any> {
    return this.post('/wxa/sec/order/get_order', {
      merchant_id: mchid,
      merchant_trade_no: merchantTradeNo,
    })
  }

  /**
   * 特殊发货报备：type 1 预售商品订单 / 2 测试订单。
   * 测试单报备后**无需发货**，也不会被判超时发货 —— 真机验收造的测试单必须报备（或退款）。
   */
  async reportSpecialOrder(params: { orderId: string; type: 1 | 2; delayTo?: number }): Promise<{ errcode: number; errmsg: string }> {
    const body: any = { order_id: params.orderId, type: params.type }
    if (params.type === 1) {
      if (!params.delayTo) throw new BizException(ErrorCode.PARAM_ERROR, '预售报备必须给出预计发货时间')
      body.delay_to = params.delayTo
    }
    const data = await this.post('/wxa/sec/order/opspecialorder', body)
    return { errcode: Number(data?.errcode ?? -1), errmsg: String(data?.errmsg ?? '') }
  }

  /// 是否已配置能调用这一族接口（凭证齐全）。缺凭证时业务层给友好提示，不发请求
  isConfigured(): boolean {
    return !!(process.env.WX_APPID && process.env.WX_SECRET)
  }
}
