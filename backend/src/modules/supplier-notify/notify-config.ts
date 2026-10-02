import { BizException, ErrorCode } from '../../common/constants/error-codes'

/**
 * 卡BN-1（2026-10-02）：供应商未接单电话催办 · 配置定义与校验
 *
 * 存储：platform_config 一行（key = supplier_ack_reminder，value = 本配置 JSON）。
 * 键不存在时用 DEFAULT_SUPPLIER_ACK_REMINDER（enabled=false —— 语音通道未开通前绝不拨号的硬红线）。
 * launchAt：首次保存配置时写入（保存时刻），之后任何保存不许改（「历史单不拨打」分界线）。
 */

export const SUPPLIER_ACK_REMINDER_KEY = 'supplier_ack_reminder'

export interface SupplierAckReminderConfig {
  enabled: boolean
  thresholdMinutes: number
  secondGapMinutes: number
  maxCalls: number
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
  launchAt: string
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
