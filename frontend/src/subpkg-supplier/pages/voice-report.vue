<template>
  <view class="page">
    <!-- ══════════ 说话（原型②屏；确认/结果已抽到 components/VoiceConfirm.vue，卡X）══════════ -->
    <!-- 合规（2026-10-04）：AI 生成合成内容标识（微信《人工智能生成合成内容标识办法》）-->
    <view class="notice-ai-gen">🤖 识别与解析结果由人工智能（AI）生成，请核对后再提交</view>
    <view class="notice">🎙️ 说一句人话就能改价 / 报量 —— 说清「哪个菜、多少钱、有多少」<br>该审核的仍然走审核（改价要运营过目），日可供量免审即时生效</view>

    <!-- 没听清 / 反问提示（兜底 A：连说两次不行 → 提示改用打字） -->
    <view v-if="tipMessage" class="tip-warn">⚠️ {{ tipMessage }}</view>

    <!-- 卡V：主按钮已移到屏幕底部固定条（见下方 .mic-bar），说话流里只留打字与例句 -->

    <view class="card">
      <view class="card-title">⌨️ 打字也可以</view>
      <view class="typing-row">
        <input v-model="input" class="typing-ipt" placeholder="如：西红柿三块八，今天有两百斤" confirm-type="send" @confirm="onParseInput" />
        <view class="typing-btn" :class="{ disabled: !input.trim() || parsing }" @tap="onParseInput">解析</view>
      </view>
    </view>

    <view class="card example-card">
      <view class="card-title">🗣️ 这样说就行</view>
      <view class="example-li" @tap="fillExample('西红柿三块八，今天有两百斤')">「西红柿三块八，今天有两百斤」<text class="example-note">改价 + 报量</text></view>
      <view class="example-li" @tap="fillExample('大白菜一块二')">「大白菜一块二」<text class="example-note">只改价</text></view>
      <view class="example-li" @tap="fillExample('黄瓜今天有六十把')">「黄瓜今天有六十把」<text class="example-note">只报量</text></view>
    </view>

    <!-- ══════════ 底部固定条（卡V：说话态主按钮固定到底部，拇指够得着）══════════ -->
    <!-- 只在语音插件可用时出现（H5/无插件整条不出现，与商品管理页①屏同一策略）；
         录音期间保持挂载不摘除（touchend 必须还能落回这个节点），视觉被 z-index 更高的录音浮层盖住 -->
    <view v-if="voiceReady" class="mic-bar">
      <view class="mic-hint">例：「西红柿三块八，今天有两百斤」</view>
      <view
        class="mic-hold"
        :class="{ rec: recording }"
        @touchstart.prevent="onMicStart"
        @touchmove.prevent="onMicMove"
        @touchend.prevent="onMicStop"
        @touchcancel="onMicStop"
      >
        <view class="mic-hold-t">🎤 按住说话 改价 / 报量</view>
        <view class="mic-hold-d">{{ recording ? '松手结束' : '说完会念给你确认，认错了可以改' }}</view>
      </view>
    </view>

    <!-- 录音浮层（原型②屏：浮层从底部升起） -->
    <view v-if="recording" class="rec-mask" @touchmove.stop.prevent>
      <view class="rec-panel">
        <view class="rec-wave">
          <i v-for="(h, i) in waveBars" :key="i" :style="{ height: h + 'px' }"></i>
        </view>
        <view class="rec-heard">{{ recText || '正在听您说…' }}<text class="dim">（正在听）</text></view>
        <view class="rec-hint">松手结束 · 最长 30 秒 · 说慢点、说清「哪个菜、多少钱、有多少」</view>
      </view>
    </view>

    <!-- 确认/结果抽屉（卡X：唯一共享组件 VoiceConfirm，就地渲染不跳页） -->
    <VoiceConfirm
      v-if="drawerOpen"
      :key="parseSeq"
      :raw-text="confirmData.rawText"
      :draft="confirmData.draft"
      :unmatched-details="confirmData.unmatchedDetails"
      :candidates="confirmData.candidates"
      :question="confirmData.question"
      @close="onDrawerClose"
      @submitted="onDrawerSubmitted"
      @resay="onDrawerResay"
    />

    <!-- 页面级安全区占位（说话态加高：盖住底部固定条 + 安全区，滚到底例句卡不被压住） -->
    <view class="page-pad" :class="{ tall: voiceReady }"></view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app'
import { post } from '@/api/request'
import { createVoiceHold } from '@/utils/voice-record'
import VoiceConfirm from '@/components/VoiceConfirm.vue'

/**
 * 供应商「语音报量 / 改价」说话页（2026-09-25 卡U 建，卡V 按钮沉底，卡W 接共享录音，卡X 确认/结果抽组件）
 *
 * 🔴 红线（现随确认/结果搬进 components/VoiceConfirm.vue 唯一一份）：
 * 1. 改价走审核 —— 提交走 POST /supplier-goods/:id/change（applyChange），与手填同一通道
 * 2. 日可供量免审即时 —— 提交走 PUT /supplier-goods/:id/stock（quickStock）
 * 3. 数字安全阀 —— 服务端已比对「原文数字串 vs 结果数值」，不一致必须三选一认过才许提交
 *
 * 本页职责只剩：说话 / 打字 → /ai/supplier-parse → 打开 VoiceConfirm 抽屉（就地，不跳页）。
 */

const parsing = ref(false)
const input = ref('')
const tipMessage = ref('')
let failCount = 0

// 确认/结果抽屉（卡X：确认态计算全在组件内，页面只喂解析结果）
const drawerOpen = ref(false)
const parseSeq = ref(0) // 每轮解析自增 → 组件重建（一段对话一张草稿，草稿经 resay 续传）
const confirmData = ref({ rawText: '', draft: [], unmatchedDetails: [], candidates: [], question: '' })
let draftAccum = [] // 未提交草稿（「重新说」时组件交还，续对话；服务端合并）

onLoad(() => {
  // 历史链路兼容：storage 里若有预填文字（旧版商品管理页跳页带来）→ 就地解析
  const preset = uni.getStorageSync('voiceReportText')
  if (preset) {
    uni.removeStorageSync('voiceReportText')
    input.value = preset
    parse(preset)
  }
})

function fillExample(t) {
  input.value = t
}

const onParseInput = () => parse(input.value)

// ── 解析（走 /ai/supplier-parse，独立于采购方 /ai/parse）──
async function parse(text) {
  const t = (text || '').trim()
  if (!t || parsing.value) return
  parsing.value = true
  tipMessage.value = ''
  try {
    const res = await post('/ai/supplier-parse', {
      text: t,
      draft: draftAccum.map((it) => ({ productId: it.productId, setPrice: it.setPrice, setSupply: it.setSupply })),
    })

    // 一句有用的话都没有 → 当没听清处理（兜底 A：话筒还在，连说两次 → 提示打字）
    if (!res.needClarify && !(res.draft || []).length && !(res.unmatchedDetails || []).length && !(res.unmatched || []).length) {
      failCount++
      tipMessage.value = failCount >= 2 ? '连着两次没听清，建议直接用上面的打字输入' : '没听清，请再说一遍'
      return
    }
    failCount = 0
    confirmData.value = {
      rawText: res.rawText || t,
      draft: res.draft || [],
      unmatchedDetails: res.needClarify ? [] : (res.unmatchedDetails || []),
      candidates: res.needClarify ? [] : (res.candidates || []),
      question: res.needClarify || '',
    }
    parseSeq.value++
    drawerOpen.value = true
  } catch (e) {
    // 错误已由 request.js 统一提示；保持草稿不变，可再说一遍
    failCount++
    tipMessage.value = failCount >= 2 ? '连着两次没成功，建议直接用打字输入' : '没听清，请再说一遍'
  } finally {
    parsing.value = false
  }
}

// ── 抽屉事件（卡X）──
function onDrawerClose() {
  drawerOpen.value = false
  draftAccum = [] // 遮罩/✕ = 放弃本次
}
function onDrawerSubmitted() { /* 结果在组件内展示；无需页面动作 */ }
function onDrawerResay(payload) {
  drawerOpen.value = false
  draftAccum = (payload && payload.draft) || [] // 未提交的草稿续给下一轮
  input.value = ''
}

// ════════════════════════════════════════════════════════════
// 语音识别（卡W：录音逻辑已抽到 utils/voice-record.js 唯一共享实现，本页只接回调）
// 全部兜底都在共享实现里：fingerDown 首次授权 / onError 仍在录守卫 / stop 幂等(-30012)
// / 超时给提示 / onHide+onUnload 停录 / touchmove 防误滚 —— 本页零重复
// ════════════════════════════════════════════════════════════
const voice = createVoiceHold({
  onDone: (text) => parse(text),
  onFail: (msg) => { tipMessage.value = msg }, // 空结果/错误/超时 → 内联提示（文案由共享实现给，与卡U 一致）
})
const voiceReady = voice.ready
const recording = voice.recording
const recText = voice.partial
const waveBars = voice.waveBars
const onMicStart = () => { if (parsing.value) return; voice.handleStart() } // 解析中不接新录音（卡U 语义）
const onMicStop = voice.handleStop
const onMicMove = voice.handleMove
const stopVoiceIfNeeded = voice.stopForLeave

onHide(stopVoiceIfNeeded)
onUnload(stopVoiceIfNeeded)
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; background: #F5F6F8; padding: 20rpx 24rpx 0; box-sizing: border-box; }
.page-pad { height: calc(200rpx + env(safe-area-inset-bottom)); }
/* 卡V：说话态留白 = 底部固定条实高（约 230rpx）+ 安全区 + 余量，滚到底例句卡不被压住 */
.page-pad.tall { height: calc(300rpx + env(safe-area-inset-bottom)); }

/* 合规（2026-10-04）：AI 生成合成内容标识 */
.notice-ai-gen { background: #FFF1F0; border: 1px solid #FFCCC7; color: #CF1322; font-size: 24rpx; line-height: 1.6; padding: 14rpx 20rpx; border-radius: 12rpx; margin-bottom: 16rpx; }
.notice { background: #E6F9F0; color: #00995A; font-size: 24rpx; line-height: 1.7; padding: 16rpx 20rpx; border-radius: 12rpx; margin-bottom: 20rpx; }

/* 底部固定条（卡V；视觉沿用商品管理页 .voice-bar 同一套） */
.mic-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
  background: #fff; border-top: 1px solid #EEF1F4;
  padding: 16rpx 24rpx calc(20rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -8rpx 28rpx rgba(0, 0, 0, 0.05);
}
.mic-hint { font-size: 20rpx; color: #8A9099; text-align: center; margin-bottom: 12rpx; }

/* 按住说话大按钮（真机；H5 无插件不出现） */
.mic-hold {
  background: linear-gradient(120deg, #00B96B, #35C98D); color: #fff;
  border-radius: 28rpx; padding: 22rpx; text-align: center;
  box-shadow: 0 12rpx 32rpx rgba(0, 185, 107, 0.28);
}
.mic-hold.rec { background: #1F2329; box-shadow: none; opacity: 0.92; }
.mic-hold-t { font-size: 34rpx; font-weight: 700; }
.mic-hold-d { font-size: 22rpx; opacity: 0.92; margin-top: 6rpx; }
.tip-warn { background: #FFF8E8; border: 1px solid #FFE3A3; color: #8A5A00; font-size: 26rpx; line-height: 1.6; padding: 16rpx 20rpx; border-radius: 12rpx; margin-bottom: 20rpx; }

.card { background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; }
.card-title { font-size: 28rpx; font-weight: 700; margin-bottom: 16rpx; }

/* 说话页 */
.typing-row { display: flex; gap: 16rpx; align-items: center; }
.typing-ipt { flex: 1; min-height: 76rpx; height: 76rpx; line-height: 76rpx; background: #F5F6F8; border-radius: 16rpx; padding: 0 20rpx; font-size: 26rpx; }
.typing-btn { flex: none; background: #00B96B; color: #fff; font-size: 26rpx; font-weight: 600; padding: 18rpx 30rpx; border-radius: 16rpx; }
.typing-btn.disabled { opacity: 0.5; }
.example-li { font-size: 26rpx; color: #1F2329; padding: 14rpx 0; border-bottom: 1px solid #F2F4F6; }
.example-li:last-child { border-bottom: none; }
.example-note { color: #8A9099; font-size: 22rpx; margin-left: 12rpx; }

/* 录音浮层（原型②屏：深色面板从底部升起） */
.rec-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 99;
  background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end;
}
.rec-panel {
  width: 100%; background: #1F2329; color: #fff;
  padding: 40rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  display: flex; flex-direction: column; align-items: center; gap: 24rpx;
}
.rec-wave { display: flex; align-items: flex-end; gap: 8rpx; height: 84rpx; }
.rec-wave i { display: block; width: 10rpx; border-radius: 6rpx; background: #35C98D; }
.rec-heard { font-size: 28rpx; line-height: 1.75; text-align: center; background: rgba(255, 255, 255, 0.09); border-radius: 20rpx; padding: 18rpx 22rpx; width: 100%; box-sizing: border-box; }
.rec-heard .dim { color: #9AA3AD; font-size: 22rpx; }
.rec-hint { font-size: 22rpx; color: #C6CDD6; text-align: center; line-height: 1.7; }
</style>
