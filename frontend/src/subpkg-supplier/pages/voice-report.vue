<template>
  <view class="page">
    <!-- ══════════ 说话（原型②屏）══════════ -->
    <template v-if="mode === 'listen'">
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
    </template>

    <!-- ══════════ 确认（原型③屏，最关键的一屏）══════════ -->
    <template v-if="mode === 'confirm'">
      <view class="draft-h">识别原文：「{{ rawText }}」</view>

      <!-- 草稿卡片 -->
      <view v-for="item in draftItems" :key="'d' + item.productId" class="draft-li">
        <view class="draft-row">
          <text class="draft-name">{{ item.name }}</text>
          <view class="tag" :class="item.setPrice !== undefined ? 'orange' : 'green'">
            {{ item.setPrice !== undefined ? '改价 · 要审核' : '即时生效' }}
          </view>
        </view>
        <!-- 改价行 -->
        <template v-if="item.setPrice !== undefined">
          <view class="kv"><text>供货价</text><text class="kv-val">{{ item.supplyPrice }} → <text class="v-orange">{{ item.setPrice }} 元/{{ item.unit }}</text></text></view>
          <view class="kv"><text>生效时间</text><text class="kv-val">运营审核通过后</text></view>
          <!-- 数字安全阀：不一致 → 三选一强制认数；一致 → 也要显示出来看一眼 -->
          <view v-if="item.priceCheck && !item.priceCheck.consistent" class="choose">
            <view class="choose-q">⚠️ 我怕听错数字 —— 你说的是哪个价？</view>
            <view class="choose-opts">
              <view
                v-for="opt in item.priceCheck.options"
                :key="'p' + opt"
                class="opt"
                :class="{ on: picked[priceKey(item.productId)] === opt }"
                @tap="pickNumber(item.productId, 'price', opt)"
              >{{ opt }}</view>
            </view>
          </view>
          <view v-else-if="item.priceCheck" class="check-ok">✅ 已核对：与识别原文的数字一致</view>
        </template>
        <!-- 改量行 -->
        <template v-if="item.setSupply !== undefined">
          <view class="kv"><text>今日可供量</text><text class="kv-val">{{ item.dailySupply }} → <text class="v-green">{{ item.setSupply }} {{ item.unit }}</text></text></view>
          <view class="kv"><text>生效时间</text><text class="kv-val">提交后立刻生效</text></view>
          <view v-if="item.supplyCheck && !item.supplyCheck.consistent" class="choose">
            <view class="choose-q">⚠️ 我怕听错数字 —— 你说的是多少{{ item.unit }}？</view>
            <view class="choose-opts">
              <view
                v-for="opt in item.supplyCheck.options"
                :key="'s' + opt"
                class="opt"
                :class="{ on: picked[supplyKey(item.productId)] === opt }"
                @tap="pickNumber(item.productId, 'supply', opt)"
              >{{ opt }}</view>
            </view>
          </view>
          <view v-else-if="item.supplyCheck" class="check-ok">✅ 已核对：与识别原文的数字一致</view>
        </template>
      </view>

      <!-- 没对上商品的：候选让他选（兜底 B：绝不自己编一个商品出来） -->
      <template v-for="(u, i) in unmatchedDetails" :key="'u' + i">
        <view class="draft-li unmatched-li">
          <view class="draft-row">
            <text class="draft-name">🤔 没对上商品：{{ u.name }}</text>
            <view class="tag gray">{{ u.op === 'setPrice' ? `说的是 ${u.value} 元` : `说的是 ${u.value} ${u.valueText && /斤/.test(u.valueText) ? '' : '斤'}` }}</view>
          </view>
          <view v-if="candidateFor(u.name).length" class="cand-list">
            <view class="cand-q">你说的是这些里的哪一个？点一下就套上这个数：</view>
            <view
              v-for="c in candidateFor(u.name)"
              :key="c.productId"
              class="cand-item"
              @tap="applyCandidate(u, c)"
            >{{ c.name }}（现价 {{ c.supplyPrice }} 元/{{ c.unit }} · 现供 {{ c.dailySupply }}{{ c.unit }}）</view>
          </view>
          <view v-else class="cand-none">你名下没有这个商品 —— 新品要先上架（回「商品管理」提交，走运营审核）。</view>
        </view>
      </template>

      <!-- 反问（口径：不确定就反问，草稿不动） -->
      <view v-if="needClarify" class="tip-warn">❓ {{ needClarify }}</view>
      <view v-if="tipMessage" class="tip-warn">⚠️ {{ tipMessage }}</view>

      <view class="draft-note">识别原文一律留着（后台可查）—— 以后有争议能翻出来对。</view>

      <!-- 底部两按钮 -->
      <view class="bottom-btns">
        <view class="bbtn plain" @tap="reSay">重新说</view>
        <view class="bbtn primary" :class="{ disabled: !canSubmit || submitting }" @tap="submit">{{ submitting ? '提交中…' : '确认提交' }}</view>
      </view>
    </template>

    <!-- ══════════ 结果（原型④屏）══════════ -->
    <template v-if="mode === 'result'">
      <view class="result-toast">✅ 已提交</view>
      <view class="card">
        <view v-for="(r, i) in resultItems" :key="i" class="result-li">
          <view>
            <view class="result-t">{{ r.op === 'setSupply' ? `日可供量 → ${r.value} ${r.unit}` : `供货价 → ${r.value} 元/${r.unit}` }}</view>
            <view class="result-d">{{ r.op === 'setSupply' ? '买家现在就按新可供量下单' : '运营审核通过后生效，现在还是原价' }}</view>
          </view>
          <view class="tag" :class="r.op === 'setSupply' ? 'green' : 'orange'">{{ r.op === 'setSupply' ? '已生效' : '待审核' }}</view>
        </view>
      </view>

      <view v-if="leftoverNote" class="card fallback-card orange-b">
        <view class="fallback-t">兜底 · 没提交上的</view>
        <view class="fallback-d">{{ leftoverNote }}</view>
      </view>

      <!-- 报完一条立刻能报下一条：按钮留在底部 -->
      <view class="result-again" @tap="again">
        <view class="result-again-t">🎤 按住再报一条</view>
        <view class="result-again-d">「大白菜今天少点，就一百斤」</view>
      </view>
    </template>

    <!-- ══════════ 底部固定条（卡V：说话态主按钮固定到底部，拇指够得着）══════════ -->
    <!-- 只在说话态 + 语音插件可用时出现（H5/无插件整条不出现，与商品管理页①屏同一策略）；
         录音期间保持挂载不摘除（touchend 必须还能落回这个节点），视觉被 z-index 更高的录音浮层盖住 -->
    <view v-if="mode === 'listen' && voiceReady" class="mic-bar">
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

    <!-- 页面级安全区占位（说话态加高：盖住底部固定条 + 安全区，滚到底例句卡不被压住） -->
    <view class="page-pad" :class="{ tall: mode === 'listen' && voiceReady }"></view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app'
import { post } from '@/api/request'
import { supplierApi } from '@/api/modules'
import { createVoiceHold } from '@/utils/voice-record'

/**
 * 供应商「语音报量 / 改价」（2026-09-25 卡U，原型②③④屏）
 *
 * 🔴 三条红线：
 * 1. 改价走审核 —— 提交走 POST /supplier-goods/:id/change（applyChange），与手填同一通道
 * 2. 日可供量免审即时 —— 提交走 PUT /supplier-goods/:id/stock（quickStock）
 * 3. 数字安全阀 —— 服务端已把「原文数字串 vs 结果数值」比对过，不一致的必须三选一认过才许提交
 *
 * 录音逻辑**照搬**采购方 pages/buyer/kefu.vue 已修好的那套（含四处已修的坑：
 * ① 首次授权吃掉松手 ② onError「已主动停录」守卫 ③ stop() 幂等(-30012) ④ 超时兜底给提示）。
 * ⚠️ 是复制不是引用 —— kefu.vue 已上生产，一个字节不动。
 */

const mode = ref('listen') // listen | confirm | result
const parsing = ref(false)
const submitting = ref(false)
const input = ref('')
const rawText = ref('')
const needClarify = ref('')
const tipMessage = ref('')
let failCount = 0

// 草稿（一个对话 = 一张草稿；服务端合并，前端不合并）
const draftItems = ref([])
const unmatchedDetails = ref([])
const candidates = ref([])
const picked = ref({}) // 数字安全阀三选一：key = productId:price / productId:supply → 选中的数
const resultItems = ref([])

const priceKey = (id) => id + ':price'
const supplyKey = (id) => id + ':supply'

const canSubmit = computed(() => {
  if (!draftItems.value.length && !unmatchedDetails.value.length) return false
  for (const item of draftItems.value) {
    if (item.priceCheck && !item.priceCheck.consistent && picked.value[priceKey(item.productId)] === undefined) return false
    if (item.supplyCheck && !item.supplyCheck.consistent && picked.value[supplyKey(item.productId)] === undefined) return false
  }
  return true
})

onLoad(() => {
  // goods-manage 打字入口带过来的预填内容 → 直接解析（H5 无语音插件的等价链路）
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
      draft: draftItems.value.map((it) => ({ productId: it.productId, setPrice: it.setPrice, setSupply: it.setSupply })),
    })
    if (res.needClarify) {
      needClarify.value = res.needClarify
      mode.value = 'confirm'
      rawText.value = res.rawText || t
      draftItems.value = res.draft || []
      unmatchedDetails.value = []
      candidates.value = []
      picked.value = {}
      return
    }
    rawText.value = res.rawText || t
    needClarify.value = ''
    draftItems.value = res.draft || []
    unmatchedDetails.value = res.unmatchedDetails || []
    candidates.value = res.candidates || []
    picked.value = {}

    // 一句有用的话都没有 → 当没听清处理（兜底 A：话筒还在，连说两次 → 提示打字）
    if (!draftItems.value.length && !unmatchedDetails.value.length && !res.unmatched?.length) {
      failCount++
      tipMessage.value = failCount >= 2 ? '连着两次没听清，建议直接用上面的打字输入' : '没听清，请再说一遍'
      mode.value = 'listen'
      return
    }
    failCount = 0
    mode.value = 'confirm'
  } catch (e) {
    // 错误已由 request.js 统一提示；保持草稿不变，可再说一遍
    failCount++
    tipMessage.value = failCount >= 2 ? '连着两次没成功，建议直接用打字输入' : '没听清，请再说一遍'
  } finally {
    parsing.value = false
  }
}

// ── 数字安全阀三选一 ──
function pickNumber(productId, kind, opt) {
  picked.value = { ...picked.value, [kind === 'price' ? priceKey(productId) : supplyKey(productId)]: opt }
}

// 认了三选一之后，提交值以认的为准
function resolvedValue(item, kind) {
  const key = kind === 'price' ? priceKey(item.productId) : supplyKey(item.productId)
  const pickedVal = picked.value[key]
  if (pickedVal !== undefined) return pickedVal
  return kind === 'price' ? item.setPrice : item.setSupply
}

// ── 兜底 B：unmatched → 候选让他选（绝不自己编商品）──
function candidateFor(name) {
  return (candidates.value || []).filter((c) => c.name.includes(name) || name.length >= 2 && c.name.replace(/[（(].*?[)）]/g, '').includes(name))
}

function applyCandidate(u, c) {
  // 把「说到的值」套到挑中的商品上（服务端已做过安全阀结论，沿用）
  draftItems.value.push({
    productId: c.productId,
    name: c.name,
    unit: c.unit,
    supplyPrice: c.supplyPrice,
    dailySupply: c.dailySupply,
    setPrice: u.op === 'setPrice' ? u.value : undefined,
    setSupply: u.op === 'setSupply' ? u.value : undefined,
    priceCheck: u.op === 'setPrice' ? u.numberCheck : undefined,
    supplyCheck: u.op === 'setSupply' ? u.numberCheck : undefined,
  })
  unmatchedDetails.value = unmatchedDetails.value.filter((x) => x !== u)
}

// ── 提交（🔴 落库走现有接口：改量 quickStock 免审 / 改价 applyChange 审核制，通道不变）──
async function submit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  const auditEntries = []
  try {
    // 逐条提交：一条失败不清前面的账（request.js 已统一 toast 错误）
    for (const item of [...draftItems.value]) {
      if (item.setSupply !== undefined) {
        await supplierApi.quickStock(item.productId, resolvedValue(item, 'supply'))
        resultItems.value.push({ op: 'setSupply', productId: item.productId, name: item.name, value: resolvedValue(item, 'supply'), unit: item.unit })
        auditEntries.push({ productId: item.productId, op: 'setSupply', value: resolvedValue(item, 'supply') })
        draftItems.value = draftItems.value.filter((x) => x !== item)
      }
      if (item.setPrice !== undefined) {
        await supplierApi.applyChange(item.productId, { changes: { supplyPrice: resolvedValue(item, 'price') } })
        resultItems.value.push({ op: 'setPrice', productId: item.productId, name: item.name, value: resolvedValue(item, 'price'), unit: item.unit })
        auditEntries.push({ productId: item.productId, op: 'setPrice', value: resolvedValue(item, 'price') })
        draftItems.value = draftItems.value.filter((x) => x !== item)
      }
    }
  } catch (e) {
    submitting.value = false
    if (resultItems.value.length) {
      // 部分成功：先展示已生效的，没提交的留在确认页可重试
      mode.value = 'result'
    }
    return
  }
  submitting.value = false

  // ── 留痕：识别原文 + 提交值 → 现有审计日志（audit_log 表，不新增表不改 schema）──
  // 失败不阻断业务结果（业务已落库成功），只打 warn
  try {
    await post('/ai/supplier-audit-trail', { rawText: rawText.value, entries: auditEntries })
  } catch (e) {
    console.warn('[语音报量] 审计留痕失败（业务已提交成功）：', e)
  }

  mode.value = 'result'
}

const leftoverNote = computed(() => {
  const notes = []
  if (draftItems.value.length) notes.push(`还有 ${draftItems.value.length} 项没提交上，可回到确认页重试`)
  if (unmatchedDetails.value.length) notes.push(`「${unmatchedDetails.value.map((u) => u.name).join('、')}」没对上商品，新品要先上架`)
  return notes.join('；')
})

// 重新说：回到说话页（草稿保留 —— 一段对话一张草稿）
function reSay() {
  mode.value = 'listen'
  input.value = ''
}

// 结果页「再报一条」：清空本轮结果，回到说话页
function again() {
  resultItems.value = []
  mode.value = 'listen'
  input.value = ''
  rawText.value = ''
  needClarify.value = ''
  tipMessage.value = ''
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

/* 确认页（原型③屏） */
.draft-h { font-size: 24rpx; color: #8A9099; padding: 8rpx 8rpx 16rpx; line-height: 1.6; }
.draft-li { background: #fff; border-radius: 24rpx; margin-bottom: 20rpx; padding: 24rpx; }
.draft-row { display: flex; justify-content: space-between; align-items: center; gap: 16rpx; margin-bottom: 8rpx; }
.draft-name { font-size: 30rpx; font-weight: 600; }
.kv { display: flex; justify-content: space-between; font-size: 24rpx; color: #6B7280; padding: 10rpx 0; }
.kv-val { color: #1F2329; }
.v-orange { color: #C87000; font-weight: 600; }
.v-green { color: #00B96B; font-weight: 600; }
.check-ok { margin-top: 8rpx; font-size: 22rpx; color: #00995A; background: #E6F9F0; border-radius: 12rpx; padding: 10rpx 16rpx; display: inline-block; }

/* 数字安全阀三选一 */
.choose { background: #FFF8E8; border: 1px solid #FFE3A3; border-radius: 20rpx; padding: 20rpx; margin-top: 16rpx; }
.choose-q { font-size: 24rpx; color: #8A5A00; margin-bottom: 16rpx; line-height: 1.6; }
.choose-opts { display: flex; gap: 16rpx; }
.opt { flex: 1; text-align: center; font-size: 28rpx; font-weight: 600; padding: 18rpx 0; border-radius: 16rpx; background: #fff; border: 3rpx solid #E5E8EB; color: #1F2329; }
.opt.on { border-color: #00B96B; background: #E6F9F0; color: #00995A; }

/* 没对上商品的候选（兜底 B） */
.unmatched-li { border: 1px dashed #A9D8FF; background: #F7FBFF; }
.tag { font-size: 20rpx; padding: 4rpx 14rpx; border-radius: 40rpx; white-space: nowrap; }
.tag.green { background: #E6F9F0; color: #00995A; }
.tag.orange { background: #FFF3E6; color: #C87000; }
.tag.gray { background: #F2F4F6; color: #8A9099; }
.cand-list { margin-top: 12rpx; }
.cand-q { font-size: 24rpx; color: #1A73E8; margin-bottom: 12rpx; line-height: 1.6; }
.cand-item { background: #fff; border: 3rpx solid #E5E8EB; border-radius: 16rpx; padding: 16rpx 20rpx; font-size: 26rpx; margin-bottom: 12rpx; }
.cand-none { margin-top: 12rpx; font-size: 24rpx; color: #6B7280; line-height: 1.7; }

.draft-note { font-size: 22rpx; color: #8A9099; padding: 0 8rpx 12rpx; line-height: 1.6; }

/* 底部两按钮（原型③屏） */
.bottom-btns { display: flex; gap: 20rpx; padding: 12rpx 0 24rpx; }
.bbtn { flex: 1; text-align: center; font-size: 30rpx; font-weight: 600; padding: 24rpx 0; border-radius: 24rpx; }
.bbtn.primary { background: #00B96B; color: #fff; box-shadow: 0 12rpx 32rpx rgba(0, 185, 107, 0.28); }
.bbtn.plain { background: #fff; color: #1F2329; border: 1px solid #E5E8EB; }
.bbtn.disabled { opacity: 0.5; }

/* 结果页（原型④屏） */
.result-toast { margin: 8rpx 0 20rpx; background: #1F2329; color: #fff; font-size: 24rpx; border-radius: 16rpx; padding: 20rpx; text-align: center; }
.result-li { display: flex; justify-content: space-between; align-items: center; gap: 16rpx; padding: 18rpx 0; border-bottom: 1px solid #F2F4F6; }
.result-li:last-child { border-bottom: none; }
.result-t { font-size: 28rpx; font-weight: 500; }
.result-d { font-size: 22rpx; color: #8A9099; margin-top: 6rpx; line-height: 1.5; }
.fallback-card.orange-b { border: 1px dashed #FFD08A; background: #FFFDF7; }
.fallback-t { font-size: 26rpx; font-weight: 700; color: #C87000; margin-bottom: 8rpx; }
.fallback-d { font-size: 24rpx; color: #6B7280; line-height: 1.7; }
.result-again {
  background: #fff; border: 3rpx solid #00B96B; border-radius: 28rpx;
  text-align: center; padding: 22rpx; margin-top: 8rpx;
}
.result-again-t { font-size: 32rpx; font-weight: 700; color: #00995A; }
.result-again-d { font-size: 20rpx; color: #8A9099; margin-top: 6rpx; }

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
