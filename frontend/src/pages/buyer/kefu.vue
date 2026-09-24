<template>
  <view class="kefu-page">
    <scroll-view class="chat-body" scroll-y :scroll-into-view="scrollTo" scroll-with-animation>
      <view class="chat-time">今天</view>
      <view class="notice">🤖 智能下单助手在线，发送想买的菜和数量即可生成订单草稿<br>🎤 按住左下角话筒说话也行<br>💬 也可把本页转发给同事或采购群，对方点一下就能下单</view>

      <!-- 欢迎气泡 -->
      <view class="bubble-row">
        <view class="bubble-av">🤖</view>
        <view class="bubble">您好，我是辉崧鲜配智能下单助手～<br>告诉我您要买什么，比如「土豆50斤，白菜两颗，明天早上送到」，我帮您整理成订单。</view>
      </view>

      <!-- 消息列表 -->
      <view v-for="(m, idx) in messages" :key="idx">
        <!-- 用户消息 -->
        <view v-if="m.role === 'me'" class="bubble-row me">
          <view class="bubble-av">👤</view>
          <view class="bubble">{{ m.text }}</view>
        </view>

        <!-- AI 识别结果 -->
        <view v-else-if="m.role === 'ai'" class="bubble-row">
          <view class="bubble-av">🤖</view>
          <view class="bubble">
            <template v-if="m.parse.items.length">
              收到！已为您识别出以下商品：
              <view class="ai-list">
                <view v-for="(it, i) in m.parse.items" :key="i" class="ai-item">
                  <text class="ai-item-emoji">{{ emojiOf(it.name) }}</text>
                  <text class="ai-item-name">{{ it.name }}</text>
                  <text class="ai-item-qty">{{ it.qtyText }}</text>
                  <text class="ai-item-amt">约 ¥{{ it.amount.toFixed(2) }}</text>
                </view>
                <view class="ai-item ai-item-date">📅 {{ m.parse.deliveryDateLabel }}（{{ m.parse.deliveryDate }}）送达 · 合计预估 ¥{{ m.parse.total.toFixed(2) }}</view>
                <view v-if="hasWeigh(m.parse)" class="ai-item ai-item-tip">💡 称重商品以实际称重为准，多退少补</view>
              </view>
            </template>
            <template v-else>
              抱歉，暂时没识别出可下单的商品，换个说法试试～比如「土豆10斤」
            </template>
          </view>
        </view>

        <!-- 草稿卡片 -->
        <view v-if="m.role === 'ai' && m.parse.items.length" class="bubble-row">
          <view class="bubble-av">🤖</view>
          <view class="bubble draft-bubble">
            <view class="draft-head">📋 订单草稿已生成</view>
            <view class="draft-body">共 {{ m.parse.items.length }} 项 · 预估合计 ¥{{ m.parse.total.toFixed(2) }}<br>点击下方核对商品和数量，<text class="b">可直接修改</text>后确认下单</view>
            <view class="draft-link" @tap="goConfirm(m.parse)">🔗 查看并确认订单 ›</view>
          </view>
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
import { onShareAppMessage, onHide, onUnload } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'

const input = ref('')
const messages = ref([])
const sending = ref(false)
const scrollTo = ref('')

const emojiOf = (name) => {
  const map = [
    ['白菜', '🥬'], ['菜', '🥬'], ['土豆', '🥔'], ['肉', '🥩'], ['姜', '🫚'], ['葱', '🌿'],
    ['蛋', '🥚'], ['鸡', '🍗'], ['鱼', '🐟'], ['米', '🌾'], ['面', '🍜'],
  ]
  for (const [k, e] of map) if (name.includes(k)) return e
  return '🥬'
}

const hasWeigh = (parse) => (parse.items || []).some((it) => it.weighType === 1)

const scrollBottom = () => {
  setTimeout(() => { scrollTo.value = 'chat-bottom' }, 50)
}

const send = async () => {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  messages.value.push({ role: 'me', text })
  sending.value = true
  scrollBottom()
  try {
    const parse = await buyerApi.aiParse(text)
    messages.value.push({ role: 'ai', parse })
  } catch (e) {
    messages.value.push({ role: 'ai', parse: { items: [], total: 0 } })
  } finally {
    sending.value = false
    scrollBottom()
  }
}

const goConfirm = (parse) => {
  uni.setStorageSync('aiDraft', parse)
  uni.navigateTo({ url: '/pages/buyer/ai-confirm' })
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

function bindRecordEvents() {
  if (!recManager) return
  // 中间结果（部分基础库会回调；官方文档只保证 onStop 的 result）
  recManager.onRecognize = (res) => { recText.value = String((res && res.result) || recText.value || '') }
  recManager.onStop = (res) => {
    clearTimeout(recSafetyTimer)
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
    recording.value = false
    recText.value = ''
    const code = (err && err.retcode) || 0
    const msg = code === -30001 ? '没有麦克风权限，请在「设置」里打开'
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
  if (!recManager || recording.value || sending.value) return
  const ok = await ensureRecordAuth()
  if (!ok) { uni.showToast({ title: '没有麦克风权限，无法语音下单', icon: 'none' }); return }
  recText.value = ''
  recording.value = true
  try {
    recManager.start({ lang: 'zh_CN', duration: 30000 })
  } catch (e) {
    recording.value = false
    uni.showToast({ title: '录音启动失败，请重试', icon: 'none' })
    return
  }
  // 兜底：插件万一没回调 onStop/onError，别让浮层卡住
  recSafetyTimer = setTimeout(() => { if (recording.value) { recording.value = false; recText.value = '' } }, 35000)
}

const onMicStop = () => {
  if (!recording.value || !recManager) return
  try { recManager.stop() } catch (e) { clearTimeout(recSafetyTimer); recording.value = false }
}

// 离开页面必须停掉录音（否则后台还在录、回调回来页面已销毁）
const stopVoiceIfNeeded = () => {
  if (!recording.value) return
  clearTimeout(recSafetyTimer)
  recording.value = false // 先置 false → onStop 回来时会被开头的判断挡住
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
.ai-item-amt { color: $danger; margin-left: auto; font-weight: 600; }
.ai-item-date { color: $text-second; }
.ai-item-tip { color: $text-second; font-size: 11px; }

.draft-bubble { padding: 0; overflow: hidden; width: 74%; }
.draft-head { background: $brand-soft; padding: 10px 12px; font-size: 12px; color: $brand; font-weight: 700; }
.draft-body { padding: 10px 12px; font-size: 12px; color: $text-body; line-height: 1.8; }
.draft-body .b { font-weight: 700; }
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
