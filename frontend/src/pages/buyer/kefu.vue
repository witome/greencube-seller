<template>
  <view class="kefu-page">
    <scroll-view class="chat-body" scroll-y :scroll-into-view="scrollTo" scroll-with-animation>
      <view class="chat-time">今天</view>
      <view class="notice">🤖 智能下单助手在线，发送想买的菜和数量即可整理订单草稿<br>💬 可以一句一句来（「土豆5斤」→「再加5斤土豆」），草稿会一直累加；要改说「土豆改成20斤」<br>🎤 按住左下角话筒说话也行<br>💬 也可把本页转发给同事或采购群，对方点一下就能下单</view>

      <!-- 欢迎气泡 -->
      <view class="bubble-row">
        <view class="bubble-av">🤖</view>
        <view class="bubble">您好，我是辉崧鲜配智能下单助手～<br>告诉我您要买什么，比如「土豆50斤，白菜两颗，明天早上送到」，我帮您整理成订单。<br>后面还想加菜，直接接着说就行。</view>
      </view>

      <!-- 消息列表 -->
      <view v-for="(m, idx) in messages" :key="idx">
        <!-- 用户消息 -->
        <view v-if="m.role === 'me'" class="bubble-row me">
          <view class="bubble-av">👤</view>
          <view class="bubble">{{ m.text }}</view>
        </view>

        <!-- 系统提示（清空草稿等） -->
        <view v-else-if="m.role === 'sys'" class="sys-tip">{{ m.text }}</view>

        <!-- AI 识别结果：只报「本次变化」，完整清单永远看下面那张草稿卡 -->
        <view v-else class="bubble-row">
          <view class="bubble-av">🤖</view>
          <view class="bubble">
            <!-- 需要反问（口径：不确定就反问，草稿不动） -->
            <template v-if="m.needClarify">
              ❓ {{ m.needClarify }}<br><text class="ai-hint">草稿先没动，直接回我是哪个就行</text>
            </template>
            <!-- 请求异常 -->
            <template v-else-if="m.error">
              抱歉，刚才没听清（网络或服务异常）。草稿没变，可以再说一遍～
            </template>
            <!-- 本次有变化 -->
            <template v-else-if="m.changes.length">
              收到！本次改动：
              <view class="ai-list">
                <view v-for="(c, i) in m.changes" :key="i" class="ai-item">
                  <text class="ai-item-emoji">{{ changeIcon(c) }}</text>
                  <text class="ai-item-name">{{ c.text }}</text>
                </view>
                <view v-if="m.unmatched.length" class="ai-item ai-item-tip">🤔 没认出来的：{{ m.unmatched.join('、') }}</view>
              </view>
            </template>
            <!-- 没变化 -->
            <template v-else>
              <template v-if="m.unmatched.length">这几样我还没对上商品：{{ m.unmatched.join('、') }}，换个说法试试～</template>
              <template v-else>好的，记下了（这一句清单没有变化）</template>
            </template>

            <!-- 采购需求登记（2026-09-25）：没认出来的菜 → 已记下 + 「到货通知我」
                 只在服务端**真的登记成功**（demandRecorded）时才出现——
                 上报失败就退回原来的样子，不做「假装记下了」。
                 授权弹窗只能在用户刚说完话的这一刻弹（口径 4：此时转化最高，失败也不打扰他）。 -->
            <view v-if="m.demandRecorded" class="demand-note">
              <view class="demand-note-t">🤔 我还没上架，已帮你记下，到货通知你 📩</view>
              <view
                v-if="demandTmplId"
                class="demand-note-btn"
                :class="{ done: m.notifySubscribed }"
                @tap="onSubscribeDemand(m)"
              >{{ m.notifySubscribed ? '✅ 已开启到货通知' : '到货通知我' }}</view>
            </view>
          </view>
        </view>
      </view>

      <!-- 唯一的一张实时草稿卡：每句话之后都更新成合并后的完整清单 -->
      <view v-if="draft && draft.items.length" class="bubble-row">
        <view class="bubble-av">🤖</view>
        <view class="bubble draft-bubble">
          <view class="draft-head">
            <text>📋 当前订单草稿（{{ draft.items.length }} 项）</text>
            <text class="draft-clear" @tap="clearDraft">清空重来</text>
          </view>
          <view class="draft-list">
            <view v-for="(it, i) in draft.items" :key="i" class="ai-item">
              <text class="ai-item-emoji">{{ emojiOf(it.name) }}</text>
              <text class="ai-item-name">{{ it.name }}</text>
              <text class="ai-item-qty">{{ it.qtyText }}</text>
            </view>
            <view class="ai-item ai-item-date">📅 {{ draft.deliveryDateLabel }}（{{ draft.deliveryDate }}）送达 · 预估合计 ¥{{ draft.total.toFixed(2) }}</view>
            <view v-if="hasWeigh(draft)" class="ai-item ai-item-tip">💡 称重商品以实际称重为准，多退少补</view>
          </view>
          <view class="draft-link" @tap="goConfirm">🔗 查看并确认订单 ›</view>
        </view>
      </view>

      <view id="chat-bottom" style="height: 8px;"></view>
    </scroll-view>

    <!-- 输入栏 -->
    <view class="chat-input">
      <view
        v-if="voiceReady"
        class="mic-btn"
        :class="{ rec: recording, off: sending }"
        @touchstart="onMicStart"
        @touchend="onMicStop"
        @touchcancel="onMicStop"
      >
        <text class="mic-ico">🎤</text>
      </view>
      <input v-model="input" placeholder="输入想买的菜品和数量…" confirm-type="send" @confirm="send" />
      <view class="send-btn" :class="{ disabled: !input.trim() || sending }" @tap="send">发送</view>
    </view>

    <!-- 录音浮层 -->
    <view v-if="recording" class="rec-mask">
      <view class="rec-box">
        <view class="rec-mic">🎤</view>
        <view class="rec-title">{{ recText || '正在听您说话…' }}</view>
        <view class="rec-tip">松开即识别并生成订单草稿 · 最长 30 秒</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShareAppMessage, onHide, onUnload } from '@dcloudio/uni-app'
import { buyerApi, demandApi } from '@/api/modules'

const input = ref('')
const messages = ref([])
const sending = ref(false)
const scrollTo = ref('')
// 整段对话就是**一张草稿**（2026-09-24）：后面每句话都作用在它上面。
// ⚠️ 前端**不做合并**——合并只有服务端一处实现（parser/draft.ts），这里只负责把服务端返回的
// 合并结果整份换上来。前端要是自己再拼一遍，就又会回到「同一张单两个数」的老毛病。
// ⚠️ 不落缓存：退出小程序再进来就是新的草稿（口径 4，不带历史原话）。
const draft = ref(null)

// ── 采购需求登记 + 到货通知授权（2026-09-25）──
// 「到货通知我」按钮要不要显示，取决于**服务端有没有配到货通知模板**（口径 8：
// 绝不写死模板 id）。拿不到配置就不显示按钮 —— 宁可不显示，也不给客户一个点了没用的按钮。
const demandTmplId = ref('')

onLoad(async () => {
  try {
    const cfg = await demandApi.subscribeConfig()
    demandTmplId.value = cfg && cfg.configured ? cfg.templateId || '' : ''
  } catch (e) {
    demandTmplId.value = ''
  }
})

/** 上报「没认出来的菜」→ 后台「采购需求」；**失败静默**，气泡退回原来的样子 */
const recordDemand = async (msg, unmatched) => {
  try {
    // ⚠️ 只上报**被识别成菜名的那一段**（unmatched 每项就是菜名），
    //    绝不把客户整句原话塞上去 —— 原话里常带电话/地址，会被后台导出成 CSV 发出去
    await demandApi.report(unmatched.map((t) => ({ rawText: t })), 1)
    msg.demandRecorded = true
  } catch (e) {
    msg.demandRecorded = false
  }
}

/** 点「到货通知我」→ 拉起微信订阅授权 → 把结果报给服务端落额度 */
const onSubscribeDemand = (msg) => {
  const tmpl = demandTmplId.value
  if (!tmpl) return
  // H5 / 非微信环境没有这个 API → 给一句人话提示，别留「点了没反应」的假按钮
  if (typeof uni.requestSubscribeMessage !== 'function') {
    uni.showToast({ title: '请在微信小程序里开启到货通知', icon: 'none' })
    return
  }
  uni.requestSubscribeMessage({
    tmplIds: [tmpl],
    success: async (res) => {
      const accepted = []
      const rejected = []
      Object.keys(res || {}).forEach((k) => {
        if (k === 'errMsg') return
        if (res[k] === 'accept') accepted.push(k)
        else rejected.push(k)
      })
      msg.notifySubscribed = accepted.includes(tmpl)
      // ⚠️ 服务端**只能**靠这次上报知道能不能发（授权只发生在客户端）
      try {
        await demandApi.subscribe({ templateId: tmpl, accepted, rejected })
      } catch (e) {
        /* 上报失败不打断客户：下次补授权还能把额度加上 */
      }
      uni.showToast({
        title: msg.notifySubscribed ? '已开启，到货就通知你' : '好的，需要时可在「我的需求」里再开',
        icon: 'none',
      })
    },
    fail: () => uni.showToast({ title: '开启失败，稍后可在「我的需求」里再试', icon: 'none' }),
  })
}

const emojiOf = (name) => {
  const map = [
    ['白菜', '🥬'], ['菜', '🥬'], ['土豆', '🥔'], ['肉', '🥩'], ['姜', '🫚'], ['葱', '🌿'],
    ['蛋', '🥚'], ['鸡', '🍗'], ['鱼', '🐟'], ['米', '🌾'], ['面', '🍜'],
  ]
  for (const [k, e] of map) if (name.includes(k)) return e
  return '🥬'
}

const hasWeigh = (parse) => (parse.items || []).some((it) => it.weighType === 1)

const changeIcon = (c) => (c.type === 'remove' ? '➖' : c.type === 'clear' ? '🗑️' : c.type === 'set' ? '✏️' : '➕')

const scrollBottom = () => {
  setTimeout(() => { scrollTo.value = 'chat-bottom' }, 50)
}

/** 把当前草稿行回传给服务端（只带草稿，不带历史原话） */
const draftPayload = () => ({
  draft: (draft.value?.items || []).map((it) => ({ productId: it.productId, qty: it.qty, unit: it.unit, name: it.name })),
  draftDeliveryDate: draft.value?.deliveryDate || '',
  draftRemark: draft.value?.remark || '',
})

const send = async () => {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  messages.value.push({ role: 'me', text })
  sending.value = true
  scrollBottom()
  try {
    const parse = await buyerApi.aiParse(text, draftPayload())
    // 服务端已经把这句话合并到草稿上了 —— 整份换上来即可（前端不合并）
    draft.value = parse
    const aiMsg = {
      role: 'ai',
      changes: parse.changes || [],
      needClarify: parse.needClarify || '',
      unmatched: parse.unmatched || [],
      demandRecorded: false,
      notifySubscribed: false,
    }
    messages.value.push(aiMsg)
    // ── 采购需求登记（2026-09-25）──────────────────────────────
    // 客户要的菜我们没收录 → 上报给后台整理成采购清单（口径 1①）。
    // ⚠️ 三条纪律：
    //   ① **不在 /ai/parse 里写库** —— 那条接口必须保持只读（所有生产只读探针都依赖它），
    //      所以登记走这里单独调 report 接口；
    //   ② **失败一律静默** —— 登记不成功也绝不能让客户的正常下单受影响；
    //   ③ 只有**真的登记成功**才显示「已帮你记下」，不做假装记下。
    if (!parse.needClarify && (parse.unmatched || []).length) {
      await recordDemand(aiMsg, parse.unmatched)
    }
  } catch (e) {
    // 错误已由 request.js 统一提示；这里只留一条可见回复，草稿保持不变
    messages.value.push({ role: 'ai', error: true, changes: [], needClarify: '', unmatched: [] })
  } finally {
    sending.value = false
    scrollBottom()
  }
}

// 写进确认页的必须是**合并后的完整草稿**（不是某一句的解析结果）
const goConfirm = () => {
  const d = draft.value
  if (!d || !(d.items || []).length) return
  uni.setStorageSync('aiDraft', { ...d, items: d.items.map((it) => ({ ...it })) })
  uni.navigateTo({ url: '/pages/buyer/ai-confirm' })
}

// 清空重来（口径 3）：只清本地这一张草稿，下一句从空草稿开始
const clearDraft = () => {
  if (!draft.value || !(draft.value.items || []).length) return
  uni.showModal({
    title: '清空重来',
    content: '会把这张草稿里的商品全部清掉，然后重新说一遍。确定吗？',
    confirmText: '清空',
    success: (r) => {
      if (!r.confirm) return
      draft.value = null
      messages.value.push({ role: 'sys', text: '已清空草稿，重新说要买什么吧' })
      scrollBottom()
    },
  })
}

// ── 语音下单：微信官方「同声传译」插件（WechatSI）── 2026-09-24
// 老板在市场/厨房手上是湿的，打字慢 → 按住话筒说一句「土豆50斤、白菜两颗」松开即出草稿卡。
// 两道前置，缺一不可：
//   ① 公众平台「设置 → 第三方设置 → 插件管理」已添加「同声传译」(provider wx069ba97219f66d99) —— 已办
//   ② manifest.json 的 mp-weixin.plugins 里声明 WechatSI，**版本号必须与后台给的一致**
// 任一不满足时 requirePlugin 会直接抛错 —— 这里必须兜住（否则整页白屏）；兜住后话筒按钮不出现，
// 文字下单、分享入口等其余功能完全不受影响。
const voiceReady = ref(false)
const recording = ref(false)
const recText = ref('')
let recManager = null
let recSafetyTimer = null
let fingerDown = false // 手指是否还按在话筒上（首次授权弹窗会吃掉松手，靠它兜住）
let stopping = false // 已发出 stop()、等回调 —— 防重复 stop（插件会回 -30012）

function bindRecordEvents() {
  if (!recManager) return
  // 中间结果（部分基础库会回调；官方文档只保证 onStop 的 result）
  recManager.onRecognize = (res) => { recText.value = String((res && res.result) || recText.value || '') }
  recManager.onStop = (res) => {
    clearTimeout(recSafetyTimer)
    stopping = false
    // 页面已隐藏/卸载时主动停过录音 → 这里不再喂给解析（避免在销毁的页面上发请求）
    if (!recording.value) return
    recording.value = false
    const text = String((res && res.result) || '').trim()
    recText.value = ''
    if (!text) { uni.showToast({ title: '没听清，请再说一遍', icon: 'none' }); return }
    input.value = text
    send() // 直接送进 AI 解析出草稿卡；成单还要在确认页人工点一次，不会有误单风险
  }
  recManager.onError = (err) => {
    clearTimeout(recSafetyTimer)
    stopping = false
    // 离开页面时主动 stop 会回 -30012（当前无识别任务）—— 这种"已经不在录了"的报错直接吞掉，别弹给用户
    if (!recording.value) return
    recording.value = false
    recText.value = ''
    const code = (err && err.retcode) || 0
    const msg = code === -30001 ? '录音失败（请检查麦克风权限），可改用打字'
      : code === -40001 ? '说得太快啦，缓一下再试'
      : code === -30011 ? '还在识别上一句，稍等一下'
      : `语音识别失败(${code})，请改用打字或重试`
    uni.showToast({ title: msg, icon: 'none' })
  }
}


// #ifdef MP-WEIXIN
try {
  // 插件未声明/未授权时 requirePlugin 抛错 → 话筒按钮不出现
  if (typeof requirePlugin === 'function') {
    const si = requirePlugin('WechatSI')
    if (si && typeof si.getRecordRecognitionManager === 'function') {
      recManager = si.getRecordRecognitionManager()
      bindRecordEvents()
      voiceReady.value = true
    }
  }
} catch (e) {
  console.warn('[语音下单] 同声传译插件不可用，已隐藏语音入口：', e && e.message)
}
// #endif

// 麦克风权限：已授权直接用；被拒过一次后不能再弹窗，得引导去设置页
const ensureRecordAuth = () => new Promise((resolve) => {
  uni.getSetting({
    success: (r) => {
      const cur = r.authSetting && r.authSetting['scope.record']
      if (cur === true) return resolve(true)
      if (cur === false) {
        uni.showModal({
          title: '需要麦克风权限',
          content: '语音下单要用麦克风听懂您说的话，请在设置里打开',
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
    fail: () => resolve(true), // 拿不到设置就交给 start() 自己报错
  })
})

const onMicStart = async () => {
  if (!recManager || recording.value || stopping || sending.value) return
  fingerDown = true
  const ok = await ensureRecordAuth()
  // ⚠️ 首次会弹系统授权窗，手指必然已经离开 —— 此时绝不能开录（否则会一直录到 30 秒上限）
  if (!fingerDown) {
    uni.showToast({
      title: ok ? '麦克风已开启，请按住话筒说话' : '没有麦克风权限，无法语音下单',
      icon: 'none',
    })
    return
  }
  if (!ok) { uni.showToast({ title: '没有麦克风权限，无法语音下单', icon: 'none' }); return }
  recText.value = ''
  stopping = false
  recording.value = true
  try {
    recManager.start({ lang: 'zh_CN', duration: 30000 })
  } catch (e) {
    clearTimeout(recSafetyTimer)
    recording.value = false
    uni.showToast({ title: '录音启动失败，请重试', icon: 'none' })
    return
  }
  // 兜底：插件万一没回调 onStop/onError，别让浮层卡住
  recSafetyTimer = setTimeout(() => {
    if (recording.value) {
      recording.value = false
      recText.value = ''
      stopping = false
      uni.showToast({ title: '录音超时，请重试', icon: 'none' })
    }
  }, 35000)
}

const onMicStop = () => {
  fingerDown = false
  // stopping 幂等：touchend 与 touchcancel 可能连着来，重复 stop 会被插件拒（-30012）
  if (!recording.value || stopping || !recManager) return
  stopping = true
  try {
    recManager.stop()
  } catch (e) {
    clearTimeout(recSafetyTimer)
    stopping = false
    recording.value = false
  }
}

// 离开页面必须停掉录音（否则后台还在录、回调回来页面已销毁）
const stopVoiceIfNeeded = () => {
  fingerDown = false
  if (!recording.value) return
  clearTimeout(recSafetyTimer)
  recording.value = false // 先置 false → onStop/onError 回来时会被开头的判断挡住
  stopping = true
  try { recManager && recManager.stop() } catch (e) { /* 忽略：离开页面时的失败无意义 */ }
}

onHide(stopVoiceIfNeeded)
onUnload(stopVoiceIfNeeded)

// ── 分享入口（2026-09-23）──
// 老板可以把这一页直接转发给客户、或丢进「XX餐馆采购群」，客户点一下卡片就落在本页，
// 说一句话即可出订单草稿。不需要后端、不需要 access_token、不需要小程序码。
// ⚠️ 微信的限制：**小程序正式发布前，分享出去的卡片只有「项目成员」能打开** ——
//    非成员会看到「暂无此权限」，这不是 bug（详见 vault《开发配套-AI下单升级方案》）。
onShareAppMessage(() => ({
  title: '说一句话就能下单 · 辉崧鲜配',
  path: '/pages/buyer/kefu',
}))
</script>

<style lang="scss" scoped>
.kefu-page { display: flex; flex-direction: column; height: 100vh; background: $bg-page; }
.chat-body { flex: 1; overflow: hidden; padding: 8px 12px; box-sizing: border-box; }
.chat-time { text-align: center; font-size: 10px; color: #B8BEC6; margin: 8px 0; }
.notice { background: $brand-soft; color: $brand-deep; font-size: 12px; padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; }

.bubble-row { display: flex; gap: 8px; margin: 12px 0; align-items: flex-start; }
.bubble-row.me { flex-direction: row-reverse; }
.bubble-av { width: 34px; height: 34px; border-radius: 8px; background: $brand; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
.bubble-row.me .bubble-av { background: $text-body; }
.bubble { max-width: 74%; background: #fff; border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.7; color: $text-body; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.bubble-row.me .bubble { background: #95EC69; }

.ai-list { background: $bg-soft; border-radius: 8px; margin-top: 8px; padding: 8px 10px; font-size: 12px; line-height: 2; }
.ai-item { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ai-item-emoji { font-size: 14px; }
.ai-item-name { font-weight: 600; }
.ai-item-qty { color: $text-second; }
.ai-item-date { color: $text-second; }
.ai-item-tip { color: $text-second; font-size: 11px; }
.ai-hint { color: $text-second; font-size: 11px; }
.sys-tip { text-align: center; font-size: 11px; color: $text-second; margin: 10px 0; }

/* 采购需求登记提示 + 「到货通知我」（2026-09-25） */
.demand-note { margin-top: 10px; padding-top: 8px; border-top: 1px dashed $bg-soft; }
.demand-note-t { font-size: 12px; color: $brand-deep; line-height: 1.6; }
.demand-note-btn {
  margin-top: 8px; display: inline-block; background: $brand; color: #fff;
  font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: 16px;
}
.demand-note-btn.done { background: $bg-soft; color: $text-second; }

.draft-bubble { padding: 0; overflow: hidden; width: 74%; }
.draft-head { background: $brand-soft; padding: 10px 12px; font-size: 12px; color: $brand; font-weight: 700; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.draft-clear { color: $text-second; font-weight: 400; text-decoration: underline; flex: none; }
.draft-list { padding: 8px 12px; font-size: 12px; line-height: 2; }
.draft-link { padding: 10px 12px; border-top: 1px solid $bg-soft; color: $info; font-weight: 700; font-size: 13px; }

.chat-input { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 8px 10px; background: $bg-soft; border-top: 1px solid $border; align-items: center; }
.chat-input input { flex: 1; border: none; border-radius: 8px; padding: 9px 12px; font-size: 13px; background: #fff; }
.send-btn { flex: none; background: $brand; color: #fff; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; }
.send-btn.disabled { opacity: 0.5; }

/* 语音下单：按住说话 */
.mic-btn { flex: none; width: 40px; height: 36px; border-radius: 8px; background: #fff; border: 1px solid $border; display: flex; align-items: center; justify-content: center; }
.mic-btn .mic-ico { font-size: 17px; }
.mic-btn.rec { background: $brand; border-color: $brand; }
.mic-btn.rec .mic-ico { transform: scale(1.15); }
.mic-btn.off { opacity: 0.45; }

.rec-mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 99; }
.rec-box { width: 240px; background: #fff; border-radius: 14px; padding: 22px 18px; text-align: center; }
.rec-mic { font-size: 40px; line-height: 1; }
.rec-title { margin-top: 12px; font-size: 14px; color: $text-body; font-weight: 600; min-height: 20px; }
.rec-tip { margin-top: 8px; font-size: 11px; color: $text-second; }
</style>
