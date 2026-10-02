import * as crypto from 'crypto'

/**
 * 卡BN-1（2026-10-02）：阿里云语音通知（VMS）适配器 · 零依赖（原生 fetch + 手写 RPC 签名）
 *
 * 环境变量（四者齐备才真拨，任一为空 ⇒ dry-run，绝不发任何 HTTP 请求）：
 *   ALIYUN_VMS_AK_ID / ALIYUN_VMS_AK_SECRET / ALIYUN_VMS_TTS_CODE / ALIYUN_VMS_CALLER_NUMBER
 *
 * 红线：AK 只进 backend/.env；本文件任何日志/异常信息/返回值都不携带 AK。
 * 真拨错误码（isv.* 等）只记错误码字符串进台账，不透传响应原文（防泄漏）。
 */

export interface DialResult {
  result: 'dry_run' | 'initiated' | 'failed'
  callId?: string
  note?: string
}

export function isVmsConfigured(): boolean {
  return !!(
    process.env.ALIYUN_VMS_AK_ID &&
    process.env.ALIYUN_VMS_AK_SECRET &&
    process.env.ALIYUN_VMS_TTS_CODE &&
    process.env.ALIYUN_VMS_CALLER_NUMBER
  )
}

/** 阿里云 RPC 百分号编码（POP 规则：空格→%20、*→%2A、~不编码） */
function popEncode(s: string): string {
  return encodeURIComponent(s).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

/** 参数按 key 升序拼 canonical → StringToSign = "POST&%2F&" + enc(canonical) → HMAC-SHA1(secret + "&") */
function signRpc(params: Record<string, string>): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${popEncode(params[k])}`)
    .join('&')
  const stringToSign = 'POST&%2F&' + popEncode(canonical)
  return crypto.createHmac('sha1', process.env.ALIYUN_VMS_AK_SECRET + '&').update(stringToSign).digest('base64')
}

async function vmsPost(extra: Record<string, string>): Promise<any> {
  const params: Record<string, string> = {
    AccessKeyId: process.env.ALIYUN_VMS_AK_ID!,
    Version: '2017-05-25',
    Format: 'JSON',
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...extra,
  }
  params.Signature = signRpc(params)
  const res = await fetch('https://dyvmsapi.aliyuncs.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  return res.json()
}

/** 播报一通 TTS 语音（SingleCallByTts）。未配置四值 → dry-run（不发请求）。 */
export async function dialTts(phone: string): Promise<DialResult> {
  if (!isVmsConfigured()) return { result: 'dry_run' }
  try {
    const j = await vmsPost({
      Action: 'SingleCallByTts',
      CalledShowNumber: process.env.ALIYUN_VMS_CALLER_NUMBER!,
      CalledNumber: phone,
      TtsCode: process.env.ALIYUN_VMS_TTS_CODE!,
      PlayTimes: '1',
    })
    if (j?.Code === 'OK') return { result: 'initiated', callId: j.CallId ? String(j.CallId) : undefined }
    return { result: 'failed', note: String(j?.Code || 'UNKNOWN') } // isv.* 错误码进台账
  } catch {
    return { result: 'failed', note: 'NETWORK_ERROR' } // 不透传异常原文（防 AK 泄漏）
  }
}

/**
 * 按主叫 CallId 查询通话结果（QueryCallDetailByCallId），发起 90 秒后由 cron 调用。
 * ⚠️ 响应字段名以实测为准（dry-run 环境拿不到真实响应，大辉填齐四值后首拨即验证）；
 *    这里按官方文档做保守映射：StatusCode 200000=接通；21xxxx 无应答类=no_answer；其它=failed。
 *    查询失败/解析失败返回空对象，调用方保留 initiated，不丢台账。
 */
export async function queryCallDetail(callId: string, dateYmd: string): Promise<{ result?: 'connected' | 'no_answer' | 'failed'; statusCode?: number }> {
  if (!isVmsConfigured()) return {}
  try {
    const j = await vmsPost({ Action: 'QueryCallDetailByCallId', CallId: callId, QueryDate: dateYmd, ProductId: 'dyvms' })
    if (j?.Code !== 'OK') return {}
    const data = j.Data ?? j
    const code = Number(data?.StatusCode ?? NaN)
    if (Number.isNaN(code)) return {}
    if (code === 200000) return { result: 'connected', statusCode: code }
    if (code >= 210000 && code < 300000) return { result: 'no_answer', statusCode: code }
    return { result: 'failed', statusCode: code }
  } catch {
    return {} // 查询失败保留 initiated
  }
}

/** 手机号脱敏（138****1234）；非 11 位一律只露前 3 后 1，越短越糊 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  if (phone.length === 11) return phone.slice(0, 3) + '****' + phone.slice(7)
  if (phone.length > 4) return phone.slice(0, 3) + '****' + phone.slice(-1)
  return '****'
}
