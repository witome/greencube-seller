import { Injectable, Logger } from '@nestjs/common'
import { createDecipheriv, createSign, createVerify, randomBytes, X509Certificate } from 'crypto'
import { readFileSync } from 'fs'
import { BizException, ErrorCode } from '../../common/constants/error-codes'

/**
 * 微信支付 APIv3 HTTP 客户端（卡R1 2026-09-29）
 *
 * 验签方式 = 微信支付公钥模式（不是平台证书模式）：
 *  - 请求头带 Wechatpay-Serial: <WXPAY_PUBLIC_KEY_ID>；
 *  - 应答/回调按头里的 Wechatpay-Serial 选公钥验签（本项目只有一把公钥，serial 必须等于它）；
 *  - **不实现**「下载平台证书」（该商户号下接口返回 RESOURCE_NOT_EXISTS）。
 *
 * 请求签名串：`METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n`（URL 含 query；GET 无 body 时最后一行为空串）。
 * 回调/应答验签串：`TIMESTAMP\nNONCE\n原始BODY\n`。
 * 回调报文解密：AES-256-GCM，key = APIv3 密钥，nonce/associated_data/ciphertext 来自 resource。
 *
 * ⚠️ 签名/验签/解密实现**只此一份**，service 与 controller 不得自行实现。
 * ⚠️ 凭证只从 .env 读（WXPAY_*），任何日志/报错不得打印密钥、证书内容。
 * WXPAY_API_BASE / WXPAY_NOTIFY_URL 为可选覆盖（本机自测指向假微信服务器；生产用默认值）。
 */
@Injectable()
export class WechatPayClient {
  private readonly logger = new Logger(WechatPayClient.name)

  /// 进程内懒加载缓存（凭证文件启动后不变）
  private merchantKeyPem: string | null = null
  private platformKeyPem: string | null = null
  private loaded = false

  /// 凭证是否齐备（决定 prepay/refund 是否可用；缺任一项视为「微信支付未配置」）
  isConfigured(): boolean {
    const e = process.env
    return !!(
      e.WXPAY_MCHID &&
      e.WXPAY_APIV3_KEY &&
      e.WXPAY_CERT_SERIAL &&
      e.WXPAY_PUBLIC_KEY_ID &&
      e.WXPAY_KEY_PATH &&
      e.WXPAY_PUBLIC_KEY_PATH
    )
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '微信支付未配置，请联系运营')
    }
  }

  /** 懒加载商户私钥 + 微信支付公钥（顺带用商户证书做一次序列号自检，失配仅告警不阻断） */
  private loadKeys() {
    if (this.loaded) return
    const e = process.env
    this.merchantKeyPem = readFileSync(e.WXPAY_KEY_PATH as string, 'utf8')
    this.platformKeyPem = readFileSync(e.WXPAY_PUBLIC_KEY_PATH as string, 'utf8')
    // 商户证书序列号自检（证书可选；X509Certificate 需要 Node ≥ 15）
    if (e.WXPAY_CERT_PATH) {
      try {
        const cert = new X509Certificate(readFileSync(e.WXPAY_CERT_PATH as string))
        const certSerial = cert.serialNumber.toLowerCase()
        const configured = (e.WXPAY_CERT_SERIAL as string).toLowerCase()
        if (certSerial !== configured) {
          this.logger.warn(`[wxpay] WXPAY_CERT_SERIAL 与证书序列号不一致（${configured} ≠ ${certSerial}），请核对 .env`)
        }
      } catch {
        this.logger.warn('[wxpay] 商户证书读取失败（WXPAY_CERT_PATH），跳过序列号自检')
      }
    }
    this.loaded = true
  }

  private apiBase(): string {
    return process.env.WXPAY_API_BASE || 'https://api.mch.weixin.qq.com'
  }

  private notifyUrl(): string {
    return process.env.WXPAY_NOTIFY_URL || 'https://api.hsfresh.com/api/v1/payment/wechat/notify'
  }

  /** 生成 Authorization 头（WECHATPAY2-SHA256-RSA2048） */
  private authorization(method: string, pathWithQuery: string, body: string): string {
    const e = process.env
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = randomBytes(16).toString('hex')
    const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`
    this.loadKeys()
    const signature = createSign('RSA-SHA256').update(message).sign(this.merchantKeyPem as string, 'base64')
    return (
      `WECHATPAY2-SHA256-RSA2048 mchid="${e.WXPAY_MCHID}",nonce_str="${nonce}",` +
      `signature="${signature}",timestamp="${timestamp}",serial_no="${e.WXPAY_CERT_SERIAL}"`
    )
  }

  /** 应答复验（公钥模式）：serial 必须等于公钥 ID；message = `ts\nnonce\nbody\n` */
  private verifyResponseHeaders(headers: Headers, body: string) {
    const e = process.env
    const serial = headers.get('wechatpay-serial') || ''
    const ts = headers.get('wechatpay-timestamp') || ''
    const nonce = headers.get('wechatpay-nonce') || ''
    const signature = headers.get('wechatpay-signature') || ''
    if (!ts && !signature) return // 部分错误应答可能无签名头，跳过（不构成放行：调用方按 HTTP 状态判定）
    if (serial !== e.WXPAY_PUBLIC_KEY_ID || !ts || !nonce || !signature) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '微信支付应答验签失败（serial/头缺失）')
    }
    this.loadKeys()
    const ok = createVerify('RSA-SHA256')
      .update(`${ts}\n${nonce}\n${body}\n`)
      .verify(this.platformKeyPem as string, signature, 'base64')
    if (!ok) throw new BizException(ErrorCode.INTERNAL_ERROR, '微信支付应答验签失败')
  }

  /** 发起 v3 请求：签名 → 请求 → 应答复验 → 解析；非 2xx 抛 BizException（不打印报文，只打 code） */
  private async request<T = any>(method: 'GET' | 'POST', pathWithQuery: string, bodyObj?: Record<string, any>): Promise<T> {
    this.assertConfigured()
    const body = bodyObj ? JSON.stringify(bodyObj) : ''
    const res = await fetch(this.apiBase() + pathWithQuery, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: this.authorization(method, pathWithQuery, body),
        'Wechatpay-Serial': process.env.WXPAY_PUBLIC_KEY_ID as string,
        'User-Agent': 'lvlifang-backend/1.0',
      },
      body: method === 'GET' ? undefined : body,
    })
    const text = await res.text()
    if (text) this.verifyResponseHeaders(res.headers, text)
    let data: any = {}
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = {}
    }
    if (!res.ok) {
      // 只落错误码，不落报文（报文可能含商户号/单号等，且日志红线禁止泄密钥类内容）
      const code = data?.code ? String(data.code) : `HTTP_${res.status}`
      this.logger.error(`[wxpay] ${method} ${pathWithQuery} 失败：${code}`)
      throw new BizException(ErrorCode.INTERNAL_ERROR, `微信支付请求失败（${code}），请稍后重试`)
    }
    return data as T
  }

  /** JSAPI 下单，返回 prepay_id */
  async jsapiPrepay(params: {
    appid: string
    description: string
    outTradeNo: string
    openid: string
    totalCents: number
    attach?: string
  }): Promise<string> {
    const data = await this.request<{ prepay_id?: string }>('POST', '/v3/pay/transactions/jsapi', {
      appid: params.appid,
      mchid: process.env.WXPAY_MCHID,
      description: params.description,
      out_trade_no: params.outTradeNo,
      notify_url: this.notifyUrl(),
      amount: { total: params.totalCents, currency: 'CNY' },
      payer: { openid: params.openid },
      ...(params.attach ? { attach: params.attach } : {}),
    })
    if (!data?.prepay_id) throw new BizException(ErrorCode.INTERNAL_ERROR, '微信下单未返回 prepay_id')
    return data.prepay_id
  }

  /** 查询订单（对账/补偿用） */
  async queryOutTradeNo(outTradeNo: string) {
    return this.request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${process.env.WXPAY_MCHID}`)
  }

  /** 申请退款（out_refund_no 幂等由微信侧保证） */
  async refund(params: {
    outTradeNo: string
    outRefundNo: string
    refundCents: number
    totalCents: number
    reason?: string
  }) {
    return this.request('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: params.outTradeNo,
      out_refund_no: params.outRefundNo,
      reason: params.reason || '订单退款',
      amount: { refund: params.refundCents, total: params.totalCents, currency: 'CNY' },
    })
  }

  /**
   * 验回调签名（公钥模式）。
   * serial 必须等于 WXPAY_PUBLIC_KEY_ID；message = `${ts}\n${nonce}\n${原始body}\n`；
   * 时间戳偏移超过 10 分钟视为重放拒绝。
   */
  verifyNotify(headers: Record<string, string | undefined>, rawBody: string): boolean {
    const e = process.env
    const serial = headers['wechatpay-serial']
    const ts = headers['wechatpay-timestamp']
    const nonce = headers['wechatpay-nonce']
    const signature = headers['wechatpay-signature']
    if (!serial || !ts || !nonce || !signature) return false
    if (serial !== e.WXPAY_PUBLIC_KEY_ID) return false
    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts))
    if (!Number.isFinite(skew) || skew > 600) return false
    this.loadKeys()
    try {
      return createVerify('RSA-SHA256')
        .update(`${ts}\n${nonce}\n${rawBody}\n`)
        .verify(this.platformKeyPem as string, signature, 'base64')
    } catch {
      return false
    }
  }

  /** AES-256-GCM 解回调 resource；失败抛错（调用方负责留痕） */
  decryptResource(resource: { ciphertext?: string; nonce?: string; associated_data?: string }): Record<string, any> {
    const key = Buffer.from(process.env.WXPAY_APIV3_KEY as string, 'utf8')
    if (key.length !== 32) throw new Error('WXPAY_APIV3_KEY 必须为 32 字节')
    const cipherBuf = Buffer.from(resource.ciphertext as string, 'base64')
    const authTag = cipherBuf.subarray(cipherBuf.length - 16)
    const data = cipherBuf.subarray(0, cipherBuf.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce as string, 'utf8'))
    if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
    decipher.setAuthTag(authTag)
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'))
  }

  /** 小程序 requestPayment 的 paySign：对 `${appId}\n${timeStamp}\n${nonceStr}\n${package}\n` 用商户私钥签名 */
  signForMiniProgram(appId: string, timeStamp: string, nonceStr: string, pkg: string): string {
    this.loadKeys()
    return createSign('RSA-SHA256')
      .update(`${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`)
      .sign(this.merchantKeyPem as string, 'base64')
  }
}
