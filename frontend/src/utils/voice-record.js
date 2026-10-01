import { ref } from 'vue'

/**
 * 语音按住录音 —— 唯一共享实现（2026-09-25 卡W 拍板第 3 条）
 *
 * 背景：这套「按住说话」逻辑先在采购方助手页落地（已上生产，零改动；卡AT 起该页并入 cart.vue），
 * 卡U 复制到供应商 voice-report.vue，卡W 又要在 goods-manage.vue 就地按住 ——
 * 三处同源，抽成唯一实现，**全仓不许有第二份插件调用**（kefu.vue 除外，它已上生产不许动）。
 *
 * 🔒 兜底语义从 voice-report.vue（卡U 版）原样搬运，一个字节的语义都不许变：
 *   ① 首次授权弹窗会吃掉「松手」→ fingerDown 兜住，绝不能授权后一直录到 30 秒上限
 *   ② onError 要判「是否仍在录」—— 离页主动停录回 -30012 不弹给用户
 *   ③ stop() 幂等（touchend 与 touchcancel 连着来，重复 stop 会回 -30012）
 *   ④ 安全定时器超时给提示，不静默死
 *   ⑤ onHide / onUnload 必须停录（后台还在录、回调回来页面已销毁）
 *   ⑥ 按住期间 touchmove 防页面误滚（handleMove 配 @touchmove.prevent 用）
 *
 * 接口形状：
 *   const voice = createVoiceHold({ onPartial?, onDone, onFail, maxMs? })
 *   voice.ready      ref<boolean> 插件可用（话筒入口是否渲染）
 *   voice.recording  ref<boolean> 正在录音
 *   voice.partial    ref<string>  实时识别文字（浮层展示）
 *   voice.waveBars   ref<number[]> 波形装饰
 *   voice.handleStart()  绑 @touchstart.prevent（权限 toasts 在内部，不重复弹）
 *   voice.handleStop()   绑 @touchend.prevent / @touchcancel
 *   voice.handleMove()   绑 @touchmove.prevent（空实现，仅阻止滚动）
 *   voice.stopForLeave() 绑页面 onHide / onUnload
 *
 * 回调：
 *   onDone(text)          最终识别文字（非空才回调；调用方负责跳转/解析）
 *   onFail(msg, meta)     识别路径失败（meta.kind = 'empty' | 'error' | 'timeout'；meta.escalated = 连续两次没听清）
 *                         —— 权限类失败在内部 toast，不走 onFail，避免两页文案分叉
 */

const REC_ERR_MESSAGES = (code) =>
  code === -30001 ? '录音失败（请检查麦克风权限），可改用打字'
    : code === -40001 ? '说得太快啦，缓一下再试'
    : code === -30011 ? '还在识别上一句，稍等一下'
    : `语音识别失败(${code})，请改用打字或重试`

export function createVoiceHold({ onPartial, onDone, onFail, maxMs = 30000 } = {}) {
  const ready = ref(false)
  const recording = ref(false)
  const partial = ref('')
  const waveBars = ref([14, 30, 42, 22, 36, 16, 28, 12])

  let manager = null
  let safetyTimer = null
  let stopTimer = null
  let waveTimer = null
  let fingerDown = false // ① 手指是否还按在按钮上（首次授权弹窗会吃掉松手）
  let stopping = false   // ③ 已发出 stop()、等回调 —— 防重复 stop（-30012）
  let failCount = 0      // 「没听清」连击计数（只有空结果计数，与卡U 版一致）

  const clearStopTimer = () => {
    if (stopTimer) {
      clearTimeout(stopTimer)
      stopTimer = null
    }
  }

  // ── 波形装饰（纯装饰，随机高度营造「正在听」的感觉）──
  function startWave() {
    stopWave()
    waveTimer = setInterval(() => {
      waveBars.value = waveBars.value.map(() => 10 + Math.floor(Math.random() * 34))
    }, 180)
  }
  function stopWave() {
    if (waveTimer) clearInterval(waveTimer)
    waveTimer = null
  }

  // ── 插件探测（失败不抛给用户，ready=false → 话筒入口不渲染）──
  // #ifdef MP-WEIXIN
  try {
    if (typeof requirePlugin === 'function') {
      const si = requirePlugin('WechatSI')
      if (si && typeof si.getRecordRecognitionManager === 'function') {
        manager = si.getRecordRecognitionManager()
        bindRecordEvents()
        ready.value = true
      }
    }
  } catch (e) {
    console.warn('[语音按住] 同声传译插件不可用，已隐藏语音入口：', e && e.message)
  }
  // #endif

  function bindRecordEvents() {
    if (!manager) return
    manager.onRecognize = (res) => {
      const t = String((res && res.result) || partial.value || '')
      partial.value = t
      if (onPartial) onPartial(t)
    }
    manager.onStop = (res) => {
      clearTimeout(safetyTimer)
      clearStopTimer()
      stopping = false
      stopWave()
      // ⑤ 离页主动停过录 → 不再喂给调用方
      if (!recording.value) return
      recording.value = false
      const text = String((res && res.result) || '').trim()
      partial.value = ''
      if (!text) {
        failCount++
        const escalated = failCount >= 2
        if (onFail) onFail(escalated ? '连着两次没听清，建议改用打字' : '没听清，请再说一遍', { kind: 'empty', escalated })
        return
      }
      failCount = 0
      if (onDone) onDone(text)
    }
    manager.onError = (err) => {
      clearTimeout(safetyTimer)
      clearStopTimer()
      stopping = false
      stopWave()
      // ② 离页时主动 stop 会回 -30012（当前无识别任务）—— 吞掉，别弹给用户
      if (!recording.value) return
      recording.value = false
      partial.value = ''
      const code = (err && err.retcode) || 0
      if (onFail) onFail(REC_ERR_MESSAGES(code), { kind: 'error', code })
    }
  }

  // ── 麦克风权限（kefu.vue 原样：已授权直接用；被拒过一次后引导去设置页）──
  const ensureRecordAuth = () => new Promise((resolve) => {
    uni.getSetting({
      success: (r) => {
        const cur = r.authSetting && r.authSetting['scope.record']
        if (cur === true) return resolve(true)
        if (cur === false) {
          uni.showModal({
            title: '需要麦克风权限',
            content: '语音报量要用麦克风听懂您说的话，请在设置里打开',
            confirmText: '去设置',
            success: (m) => {
              if (!m.confirm) return resolve(false)
              uni.openSetting({
                success: (o) => resolve(!!(o.authSetting && o.authSetting['scope.record'])),
                fail: () => resolve(false),
              })
            },
            fail: () => resolve(false),
          })
          return
        }
        uni.authorize({ scope: 'scope.record', success: () => resolve(true), fail: () => resolve(false) })
      },
      fail: () => resolve(true),
    })
  })

  async function handleStart() {
    if (!manager || recording.value || stopping) return
    fingerDown = true
    const ok = await ensureRecordAuth()
    // ① 首次会弹系统授权窗，手指必然已经离开 —— 此时绝不能开录（否则会一直录到 30 秒上限）
    if (!fingerDown) {
      uni.showToast({ title: ok ? '麦克风已开启，请按住说话' : '没有麦克风权限，无法语音报量', icon: 'none' })
      return
    }
    if (!ok) { uni.showToast({ title: '没有麦克风权限，无法语音报量', icon: 'none' }); return }
    partial.value = ''
    stopping = false
    recording.value = true
    clearStopTimer() // 清掉上一次 stop 后未回调的兜底，别让它误杀这一轮新录音
    try {
      manager.start({ lang: 'zh_CN', duration: maxMs })
    } catch (e) {
      clearTimeout(safetyTimer)
      clearStopTimer()
      recording.value = false
      stopWave()
      uni.showToast({ title: '录音启动失败，请重试', icon: 'none' })
      return
    }
    startWave()
    // ④ 兜底：插件万一没回调 onStop/onError，别让浮层卡住（超时要给提示，不静默）
    safetyTimer = setTimeout(() => {
      if (recording.value) {
        recording.value = false
        partial.value = ''
        stopping = false
        stopWave()
        if (onFail) onFail('录音超时，请重试', { kind: 'timeout' })
      }
    }, maxMs + 5000)
  }

  function handleStop() {
    fingerDown = false
    // ③ touchend 与 touchcancel 可能连着来，重复 stop 会被插件拒（-30012）
    if (!recording.value || stopping || !manager) return
    stopping = true
    try {
      manager.stop()
    } catch (e) {
      clearTimeout(safetyTimer)
      clearStopTimer()
      stopping = false
      recording.value = false
      stopWave()
      return
    }
    // ⑥ 松手兜底（2026-09-30）：录音太短时 WechatSI 偶发不回调 onStop，浮层就一直挂着。
    //    给一个短超时 —— stop() 后 5 秒仍没有 onStop/onError 就强制收尾，绝不把客户晾在
    //    全屏遮罩里 35 秒（safetyTimer 只管「一直录到上限」这条线，救不了「stop 后丢回调」）。
    clearStopTimer()
    stopTimer = setTimeout(() => {
      stopTimer = null
      if (recording.value) {
        recording.value = false
        partial.value = ''
        stopping = false
        stopWave()
        clearTimeout(safetyTimer)
        if (onFail) onFail('没听清，请再说一遍', { kind: 'empty' })
      }
    }, 5000)
  }

  // ⑥ 按住期间防页面误滚：配 @touchmove.prevent 用，仅吞事件
  function handleMove() {}

  // ⑤ 离开页面必须停掉录音（否则后台还在录、回调回来页面已销毁）
  function stopForLeave() {
    fingerDown = false
    stopWave()
    clearStopTimer()
    if (!recording.value) return
    clearTimeout(safetyTimer)
    recording.value = false
    stopping = true
    try { manager && manager.stop() } catch (e) { /* 忽略：离开页面时的失败无意义 */ }
  }

  return { ready, recording, partial, waveBars, handleStart, handleStop, handleMove, stopForLeave }
}
