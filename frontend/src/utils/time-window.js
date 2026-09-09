/**
 * 配送时间段工具：下单时根据实际时间过滤已过时间段
 * 时间段：1 早 05-08 / 2 中 10-13 / 3 晚 16-19
 */

export const TIME_WINDOWS = [
  { value: 1, label: '早 05-08 点', startHour: 5 },
  { value: 2, label: '中 10-13 点', startHour: 10 },
  { value: 3, label: '晚 16-19 点', startHour: 16 },
]

// 本地日期 YYYY-MM-DD
export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function tomorrowStr() {
  return dateStr(new Date(Date.now() + 86400000))
}

/**
 * 根据配送日期返回可选时间段：
 * 当天配送时，开始时间已过的时间段不可选；非当天（次日等）全部可选
 */
export function availableTimeWindows(deliveryDate) {
  if (deliveryDate !== dateStr()) return TIME_WINDOWS
  const now = new Date()
  const nowHour = now.getHours() + now.getMinutes() / 60
  return TIME_WINDOWS.filter((w) => nowHour < w.startHour)
}
