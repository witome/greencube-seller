import { Injectable, Logger } from '@nestjs/common'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { parseTemplateContent, TmplKeyword } from './wx.format'

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

/** 模板关键字探测结果 */
export interface TmplKeywordResult {
  ok: boolean
  keywords: TmplKeyword[]
  template?: { priTmplId: string; title: string; type: number | string }
  /** ok=false 时：人话原因（会落日志） */
  reason?: string
}

/**
 * 微信错误码 → 人话（**唯一实现**）
 *
 * 为什么必须翻译：运营在后台看到的是这一句话，看到「47003」只会一头雾水、
 * 然后来问「为什么发不出去」。这里给的是**可行动**的说明。
 * 原始 errmsg 会附在后面，方便排障（也是我们唯一能拿到的微信侧细节）。
 */
export function wxErrorText(errcode: number, errmsg?: string): string {
  const raw = errmsg ? `（微信原话：${String(errmsg).slice(0, 120)}）` : ''
  switch (Number(errcode)) {
    case 43101:
      return `客户已拒收订阅消息（43101），需要他自己重新点一次「到货通知我」授权${raw}`
    case 45015:
      return `客服消息已超 48 小时窗口（45015），只能等他主动打开小程序${raw}`
    case 47003:
      return (
        `模板字段对不上（47003）：模板字段名/格式与代码里的映射不一致。` +
        `请核对 .env 的 WX_SUBSCRIBE_TMPL_DEMAND_FIELDS（键必须是模板 content 里 {{xxx.DATA}} 的 xxx）${raw}`
      )
    case 40003:
      return `客户的 openid 无效（40003），可能是账号数据有问题${raw}`
    case 40037:
      return `模板 id 不合法（40037），请核对 .env 的 WX_SUBSCRIBE_TMPL_DEMAND 是否被改过${raw}`
    case 41030:
      return `跳转页面不存在（41030），请确认小程序已发布且页面路径正确${raw}`
    default:
      return `微信返回 ${errcode}${raw}`
  }
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

  // ────────────────────────────────────────────────────────────
  // 模板关键字探测（2026-09-25 补：真实模板字段与最初假设不同）
  // ────────────────────────────────────────────────────────────
  //
  // 为什么需要：公众号后台申请到的模板，字段名（`thing1` / `amount2` …）与字段顺序
  // 只有微信知道。写死字段名 = 换一次模板就全挂；猜字段名 = 运营收到 47003 看不懂。
  // 所以这里调官方「获取已有模板列表」把字段**问出来**，再按字段**中文名**自动映射到
  // {name}/{price}/{note} 三个变量。
  //
  // 官方接口：GET /wxaapi/newtmpl/gettemplate?access_token=…
  // 返回 data[] 里每项：priTmplId / title / content / example / type(2 一次性, 3 长期)
  //   ⚠️ **返回里没有 kid/type 数组** —— 字段名必须从 content 的 `{{xxx.DATA}}` 里取
  //      （`thing1` 就是发送时 data 的键，前半段是类型、尾数是序号）。
  //   文档核对：https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/
  //             subscribe-message/api_getwxapubnewtemplate.html

  /** 模板列表缓存（模板很少变，缓存 1 小时；也省掉每次通知都打一次微信） */
  private tmplCache: { at: number; list: any[] } | null = null
  private static readonly TMPL_CACHE_MS = 60 * 60 * 1000

  /** 取模板列表（带缓存）。失败返回 null 并记日志，**绝不抛给业务** */
  async getTemplateList(force = false): Promise<any[] | null> {
    if (!force && this.tmplCache && Date.now() - this.tmplCache.at < WxService.TMPL_CACHE_MS) {
      return this.tmplCache.list
    }
    let token: string
    try {
      token = await this.getAccessToken()
    } catch (e: any) {
      this.logger.warn(`取 access_token 失败，模板关键字探测跳过：${e?.message || e}`)
      return null
    }
    let data: any
    try {
      const res = await fetch(`${this.apiBase}/wxaapi/newtmpl/gettemplate?access_token=${token}`)
      data = await res.json()
    } catch {
      this.logger.warn('调用 wxaapi/newtmpl/gettemplate 失败（网络），模板关键字探测跳过')
      return null
    }
    if (Number(data?.errcode ?? -1) !== 0 || !Array.isArray(data?.data)) {
      this.logger.warn(`获取模板列表失败：errcode=${data?.errcode} errmsg=${data?.errmsg}`)
      return null
    }
    this.tmplCache = { at: Date.now(), list: data.data }
    return data.data
  }

  /** 仅供自测：清模板缓存 */
  clearTemplateCache() {
    this.tmplCache = null
  }

  /**
   * 按 priTmplId 找到模板并解析出字段列表。
   * ⚠️ **任何失败都不抛**，只返回 ok=false + 人话 reason —— 调用方据此降级到默认映射，
   *    绝不允许「探测失败」把通知整体干掉。
   */
  async getTemplateKeywords(priTmplId: string): Promise<TmplKeywordResult> {
    const id = String(priTmplId || '').trim()
    if (!id) return { ok: false, keywords: [], reason: '未配置到货通知模板 id' }

    const list = await this.getTemplateList()
    if (!list) return { ok: false, keywords: [], reason: '拿不到模板列表（微信接口不可用或凭证异常）' }

    const hit = list.find((t) => String(t?.priTmplId) === id)
    if (!hit) {
      return { ok: false, keywords: [], reason: `账号下的模板列表里没有 ${id}（模板可能被删了或 id 变了）` }
    }
    const keywords = parseTemplateContent(String(hit.content || ''))
    if (!keywords.length) {
      return {
        ok: false,
        keywords: [],
        template: { priTmplId: id, title: String(hit.title || ''), type: hit.type },
        reason: '模板 content 里解析不出任何 {{字段.DATA}}',
      }
    }
    const template = { priTmplId: id, title: String(hit.title || ''), type: hit.type }
    this.logger.log(
      `模板关键字已探测：${template.title}（type=${hit.type}）→ ` +
        keywords.map((k) => `${k.name}=${k.key}(${k.type})`).join(' / '),
    )
    if (Number(hit.type) !== 2) {
      // 2=一次性订阅（我们自己记额度）；3=长期订阅（额度语义不同）—— 说清楚别猜
      this.logger.warn(`该模板 type=${hit.type}（不是 2 一次性订阅），额度记账口径可能不适用，请核对`)
    }
    return { ok: true, keywords, template }
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
