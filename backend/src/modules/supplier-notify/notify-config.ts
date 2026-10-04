import { BizException, ErrorCode } from '../../common/constants/error-codes'

/**
 * 卡BN-1（2026-10-02）：供应商未接单电话催办 · 配置定义与校验
 *
 * 存储：platform_config 一行（key = supplier_ack_reminder，value = 本配置 JSON）。
 * 键不存在时用 DEFAULT_SUPPLIER_ACK_REMINDER（enabled=false —— 语音通道未开通前绝不拨号的硬红线）。
 * launchAt：首次保存配置时写入（保存时刻），之后任何保存不许改（「历史单不拨打」分界线）。
 */

export const SUPPLIER_ACK_REMINDER_KEY = 'supplier_ack_reminder'

/// 卡BP-1（2026-10-04）：网关心跳状态键（只写 {at}，读出后 180 秒内有值 = 网关在线）
export const SUPPLIER_NOTIFY_GATEWAY_STATE_KEY = 'supplier_notify_gateway_state'

/// 卡BP-1（2026-10-04）：催办通道 —— phone=手机专线网关（默认）/ aliyun=原阿里云 TTS 直拨 / off=关闭
export type NotifyChannel = 'phone' | 'aliyun' | 'off'
export const NOTIFY_CHANNELS: NotifyChannel[] = ['phone', 'aliyun', 'off']

export interface SupplierAckReminderConfig {
  enabled: boolean
  thresholdMinutes: number
  secondGapMinutes: number
  maxCalls: number
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
  launchAt: string
  // ── 卡BP-1 新增四字段 ──
  channel: NotifyChannel
  /** 网关侧响铃秒数（1~30，默认 5） */
  ringSeconds: number
  /** 接通后自动挂断秒数（0~30，默认 2） */
  hangupAfterAnswerSeconds: number
  /** 网关侧手机号（可空、≤20 字符，仅用于展示与复制，不是拨打目标） */
  gatewayPhoneNo: string | null
  /** 同一供应商的提醒冷却（分钟，默认 10）：防止一个供应商名下多张单被连打多通（1~1440） */
  supplierGapMinutes: number
}

export const DEFAULT_SUPPLIER_ACK_REMINDER: SupplierAckReminderConfig = {
  enabled: false,
  thresholdMinutes: 5,
  secondGapMinutes: 10,
  maxCalls: 2,
  quietEnabled: true,
  quietStart: '22:00',
  quietEnd: '05:00',
  launchAt: '2026-10-02T12:00:00.000Z',
  channel: 'phone',
  ringSeconds: 5,
  hangupAfterAnswerSeconds: 2,
  gatewayPhoneNo: null,
  supplierGapMinutes: 10,
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

/** 校验合并后的完整配置；非法抛 PARAM_ERROR（业务码 1001 → HTTP 400） */
export function validateReminderConfig(cfg: SupplierAckReminderConfig): void {
  if (typeof cfg.enabled !== 'boolean') throw new BizException(ErrorCode.PARAM_ERROR, 'enabled 必须为布尔')
  const intIn = (v: any, min: number, max: number, name: string) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new BizException(ErrorCode.PARAM_ERROR, `${name} 必须为 ${min}–${max} 的整数`)
  }
  intIn(cfg.thresholdMinutes, 1, 1440, 'thresholdMinutes')
  intIn(cfg.secondGapMinutes, 1, 1440, 'secondGapMinutes')
  intIn(cfg.maxCalls, 0, 5, 'maxCalls')
  if (typeof cfg.quietEnabled !== 'boolean') throw new BizException(ErrorCode.PARAM_ERROR, 'quietEnabled 必须为布尔')
  if (!HH_MM.test(cfg.quietStart || '')) throw new BizException(ErrorCode.PARAM_ERROR, 'quietStart 必须为 HH:mm')
  if (!HH_MM.test(cfg.quietEnd || '')) throw new BizException(ErrorCode.PARAM_ERROR, 'quietEnd 必须为 HH:mm')
  if (!cfg.launchAt || Number.isNaN(new Date(cfg.launchAt).getTime())) throw new BizException(ErrorCode.PARAM_ERROR, 'launchAt 非法')
  // ── 卡BP-1 新增四字段校验（非法 → 1001 → HTTP 400，与现有形态一致） ──
  if (!NOTIFY_CHANNELS.includes(cfg.channel)) throw new BizException(ErrorCode.PARAM_ERROR, 'channel 必须为 phone | aliyun | off')
  intIn(cfg.ringSeconds, 1, 30, 'ringSeconds')
  intIn(cfg.hangupAfterAnswerSeconds, 0, 30, 'hangupAfterAnswerSeconds')
  intIn(cfg.supplierGapMinutes, 1, 1440, 'supplierGapMinutes')
  if (cfg.gatewayPhoneNo !== null && cfg.gatewayPhoneNo !== undefined) {
    if (typeof cfg.gatewayPhoneNo !== 'string' || cfg.gatewayPhoneNo.length > 20) {
      throw new BizException(ErrorCode.PARAM_ERROR, 'gatewayPhoneNo 必须为不超过 20 字符的字符串')
    }
  }
}

/** 判断 now 是否落在免打扰时段 [start, end)，支持跨零点（22:00–05:00 = >=22:00 或 <05:00） */
export function inQuietWindow(now: Date, quietStart: string, quietEnd: string): boolean {
  // 以上海时区的「本地时刻」为准（服务器时区无关）
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  const minutes = local.getHours() * 60 + local.getMinutes()
  const [sh, sm] = quietStart.split(':').map(Number)
  const [eh, em] = quietEnd.split(':').map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  if (start <= end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end // 跨零点
}
