import { Injectable, Logger } from '@nestjs/common'
import { BizException, ErrorCode } from '../../common/constants/error-codes'

/**
 * 微信服务端接口（小程序侧发送能力）
 *
 * 目前只服务于「采购需求 · 到货通知」：
 *   · 订阅消息 `POST /cgi-bin/message/subscribe/send`
 *   · 客服消息 `POST /cgi-bin/message/custom/send`（48 小时窗口内可用）
 *
 * 🔒 三条硬约束（写在这里，别在调用点各自发挥）：
 *   1. **AppSecret / access_token 全程不打印、不进日志、不进错误信息。**
 *      本项目生产 `.env` 里是**真实凭证**；一旦被日志落盘（Apache/Nginx 错误日志、
 *      PM2 日志、巡检脚本回显），等于把整个公众号/小程序后台权限泄出去了。
 *      所以下面所有 catch 分支都**只回固定文案**，绝不 `throw new Error(String(e))`
 *      —— fetch 失败时异常信息里往往带着完整 URL（URL 里就有 appid 和 secret）。
 *   2. **access_token 必须缓存**（expires_in 7200）。微信侧对取 token 有频率限制，
 *      每次现取会把配额刷爆、还会让已发出的 token 提前失效。这里做内存缓存 +
 *      提前 5 分钟过期（`TOKEN_SAFETY_MS`），避免边界上拿到即将失效的 token。
 *   3. **接口 base 可注入**（`WX_API_BASE`，默认线上 `https://api.weixin.qq.com`）。
 *      本地自测靠它指向「假微信服务」，**绝不真打微信**（没有真模板 id、
 *      也不允许拿测试流量去碰线上接口）。
 */

export interface WxSendResult {
  ok: boolean
  errcode: number
  errmsg: string
}

/** 缓存有效期安全余量：提前 5 分钟作废，避免拿到边界上就要过期的 token */
const TOKEN_SAFETY_MS = 5 * 60 * 1000

/** 微信接口默认地址（生产） */
const DEFAULT_API_BASE = 'https://api.weixin.qq.com'

/** 本地假微信服务用的固定 token（仅自测脚本使用，生产永远走真接口） */
@Injectable()
export class WxService {
  private readonly logger = new Logger(WxService.name)

  /** access_token 内存缓存（口径：不每次现取） */
  private tokenCache: { token: string; expireAt: number } | null = null

  /** 接口 base —— 可注入，自测指本地假微信 */
  private get apiBase(): string {
    return (process.env.WX_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
  }

  /** 取 access_token（带缓存）。凭证缺失 → 业务错，不裸 500 */
  async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.tokenCache && this.tokenCache.expireAt > now + TOKEN_SAFETY_MS) {
      return this.tokenCache.token
    }

    const appid = process.env.WX_APPID
    const secret = process.env.WX_SECRET
    if (!appid || !secret) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '微信凭证未配置，无法发送通知')
    }

    // ⚠️ 这个 URL 里带 appid 与 secret —— 绝不打印、绝不放进异常信息
    const url =
      `${this.apiBase}/cgi-bin/token?grant_type=client_credential` +
      `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`

    let data: any
    try {
      const res = await fetch(url)
      data = await res.json()
    } catch {
      // 只回固定文案：异常里可能带完整 URL（含 secret）
      throw new BizException(ErrorCode.INTERNAL_ERROR, '连接微信服务失败，请稍后重试')
    }

    if (!data?.access_token) {
      // errmsg 是微信给的（不含 secret），可以回显；errcode 便于排障
      this.logger.error(`获取 access_token 失败：errcode=${data?.errcode} errmsg=${data?.errmsg}`)
      throw new BizException(
        ErrorCode.INTERNAL_ERROR,
        `微信拒绝下发 access_token（${data?.errcode ?? '未知'}）`,
      )
    }

    const expiresIn = Number(data.expires_in) || 7200
    this.tokenCache = { token: data.access_token, expireAt: now + expiresIn * 1000 }
    // 只记有效期，不记 token 本身
    this.logger.log(`access_token 已刷新，有效期 ${expiresIn}s`)
    return data.access_token
  }

  /** 仅供自测：清掉 token 缓存（验证「取一次就复用」） */
  clearTokenCache() {
    this.tokenCache = null
  }

  /** 供自测断言用：当前缓存是否命中（不暴露 token 值） */
  hasCachedToken(): boolean {
    return !!this.tokenCache && this.tokenCache.expireAt > Date.now()
  }

  /**
   * 统一 POST（token 放 query，和微信文档一致）。
   * 返回值原样透传给调用方做落库：{ errcode, errmsg }。
   */
  private async post(pathWithToken: string, body: any): Promise<WxSendResult> {
    let data: any
    try {
      const res = await fetch(`${this.apiBase}${pathWithToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      data = await res.json()
    } catch {
      // 同样只回固定文案（URL 带 access_token）
      return { ok: false, errcode: -1, errmsg: '连接微信服务失败' }
    }
    const errcode = Number(data?.errcode ?? -1)
    const errmsg = String(data?.errmsg ?? '')
    return { ok: errcode === 0, errcode, errmsg }
  }

  /**
   * 发送订阅消息
   * @param openid     接收人 openid
   * @param templateId 模板 id（**只从配置读**，绝不写死/猜测）
   * @param data       模板字段数据，形如 { thing1: { value: '荷兰豆' }, time2: { value: '2026-09-25 10:00' } }
   * @param page       点击后跳转的小程序页面（不带前导斜杠）
   */
  async sendSubscribeMessage(
    openid: string,
    templateId: string,
    data: Record<string, { value: string }>,
    page?: string,
  ): Promise<WxSendResult> {
    const token = await this.getAccessToken()
    return this.post(`/cgi-bin/message/subscribe/send?access_token=${token}`, {
      touser: openid,
      template_id: templateId,
      page,
      lang: 'zh_CN',
      miniprogram_state: process.env.WX_MINIPROGRAM_STATE || 'formal',
      data,
    })
  }

  /**
   * 发送客服消息（纯文本）
   * ⚠️ 只能在用户最近一次与小程序交互后 48 小时内发送；
   *    超时微信返回 **45015**（response out of time limit or subscription is canceled），
   *    由调用方按错误码判定并落库，**这里不吞错误**。
   */
  async sendCustomText(openid: string, content: string, page?: string): Promise<WxSendResult> {
    const token = await this.getAccessToken()
    const body: any = { touser: openid, msgtype: 'text', text: { content } }
    // 客服消息的跳转是 miniprogrampage 类型才有；纯文本用 text + 小程序卡片会超字数，
    // 这里按需求只发文本 + 让用户在「我的 → 我的需求」里下单（口径：不假装发过链接）
    if (page) body.text.content = `${content}\n（打开小程序 → 我的 → 我的需求）`
    return this.post(`/cgi-bin/message/custom/send?access_token=${token}`, body)
  }
}
