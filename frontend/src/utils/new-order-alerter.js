/**
 * 新单语音提示组合式函数（2026-09-12 拍板 1A：纯前端，不改后端接口、不动 schema）
 *
 * 用法（页面 setup 内）：
 *   useNewOrderAlerter(async () => (await supplierApi.getStockList()).map(o => o.orderId), { tag: 'supplier-stock' })
 *   useNewOrderAlerter(async () => {
 *     const ts = await courierApi.getTodayTasks()
 *     return ts.flatMap(t => (t.stationList || []).filter(s => s.type === 'deliver').map(s => s.orderId))
 *   }, { tag: 'courier-tasks' })
 *
 * 行为：
 * - 每 30 秒轮询一次现有接口，比对订单 id 集合（比对逻辑见 new-order-diff.js）
 * - 首次拉到的列表作为基线，不播报
 * - 发现新 id → 播报一次（uni.createInnerAudioContext 播预置音频，不念订单内容）
 * - 同一单只播一次（seen 集合去重）；onHide 清定时器、onShow 重启
 *
 * ⚠️ 平台限制（如实写明，不绕）：
 * - 微信小程序只有在前台时能播音频；切后台/杀进程后无法播（微信不允许）。
 *   本方案不做后台播放、不做订阅消息（那是另一件事）。
 * - 音频文件：/static/audio/new-order-alert.wav（程序生成的叮咚提示音；真人语音版
 *   「您有一笔新订单，请及时处理」可直接替换同路径文件，代码无需改动）
 */
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { pickFreshIds } from './new-order-diff'
import { registerPoller, isPermissionError, toastOnce } from './poller-registry'

const POLL_MS = 30000 // 拍板：30 秒轮询
const AUDIO_PATH = '/static/audio/new-order-alert.wav'

export function useNewOrderAlerter(fetchIds, opts = {}) {
  const tag = opts.tag || 'alerter'
  let timer = null
  let seen = null // null = 未建立基线
  let playing = false

  const play = () => {
    if (playing) return
    try {
      const ctx = uni.createInnerAudioContext()
      ctx.src = AUDIO_PATH
      ctx.obeyMuteSwitch = false
      playing = true
      ctx.onEnded(() => { playing = false; ctx.destroy() })
      ctx.onError((e) => { playing = false; ctx.destroy() })
      ctx.play()
      console.log(`[new-order-alerter:${tag}] 播报新单提示音`)
    } catch (e) {
      playing = false
      console.log(`[new-order-alerter:${tag}] 播放失败`, e)
    }
  }

  const check = async () => {
    try {
      const ids = await fetchIds()
      const r = pickFreshIds(seen, ids)
      seen = r.seen
      if (r.fresh.length) {
        console.log(`[new-order-alerter:${tag}] 发现新单 id=`, r.fresh)
        play()
      }
    } catch (e) {
      // 权限类错误（2001 未登录 / 2002 当前身份无此权限 / 4001）→ 立即自停：
      // 场景是「已切到其它身份但本页面轮询还活着」，继续轮只会反复弹权限提示
      if (isPermissionError(e)) {
        stop()
        toastOnce(`alerter:${tag}`, '身份已切换，提醒已停止')
        return
      }
      // 其余失败（网络抖动等）静默，下轮再试
    }
  }

  const start = () => {
    if (timer) return
    check() // onShow 立即查一次（首次=建基线）
    timer = setInterval(check, POLL_MS)
    console.log(`[new-order-alerter:${tag}] 轮询已启动(${POLL_MS}ms)`)
  }
  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
      console.log(`[new-order-alerter:${tag}] 轮询已停止`)
    }
    unregister()
  }

  // 全局登记：切换身份/退出登录时由 stopAllPollers() 强制停（reLaunch 不一定触发 onHide）
  const unregister = registerPoller(`alerter:${tag}`, stop)

  // onHide 停/onShow 启 + onUnload 兜底销毁（页面实例销毁时定时器必须清，防后台空转）
  onShow(start)
  onHide(stop)
  onUnload(stop)

  return { start, stop }
}
