<template>
  <!-- 卡X（2026-09-25）：确认③屏 + 结果④屏的唯一共享组件（从 voice-report.vue 原样抽出）
       底部抽屉自包含：遮罩（沿用页内 .mask 模式）+ 底部升起容器（≤85% 屏高，内部可滚动）
       商品管理页（就地抽屉，不跳页）与语音报价页共用同一份；
       🔴 数字安全阀三选一 / canSubmit 门槛 / quickStock+applyChange 提交 / 结果渲染 —— 全仓仅此一处 -->
  <view class="vc-mask" @tap="requestClose">
    <view class="vc-sheet" @tap.stop>
      <view class="vc-head">
        <text class="vc-head-t">{{ phase === 'result' ? '报量 / 改价结果' : '确认报量 / 改价' }}</text>
        <text class="vc-x" :class="{ disabled: submitting }" @tap="requestClose">✕</text>
      </view>

      <view class="vc-body">
        <!-- 合规（2026-10-04）：AI 生成合成内容显著标识（微信《人工智能生成合成内容标识办法》）-->
        <view class="vc-ai-gen">🤖 以下内容由人工智能（AI）生成，请核对后再提交</view>
        <!-- ══════════ 确认（原型③屏，最关键的一屏）══════════ -->
        <template v-if="phase === 'confirm'">
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
          <view v-if="question" class="tip-warn">❓ {{ question }}</view>

          <view class="draft-note">识别原文一律留着（后台可查）—— 以后有争议能翻出来对。</view>

          <!-- 底部两按钮 -->
          <view class="bottom-btns">
            <view class="bbtn plain" @tap="reSay">重新说</view>
            <view class="bbtn primary" :class="{ disabled: !canSubmit || submitting }" @tap="submit">{{ submitting ? '提交中…' : '确认提交' }}</view>
          </view>
        </template>

        <!-- ══════════ 结果（原型④屏）══════════ -->
        <template v-if="phase === 'result'">
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
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { post } from '@/api/request'
import { supplierApi } from '@/api/modules'

/**
 * 确认屏 + 结果屏唯一共享实现（卡X：从 voice-report.vue 原样搬出，文案/格式一个字没改）
 *
 * 接口：
 *   props:
 *     rawText          string  识别原文（草稿头 + 审计留痕用）
 *     draft            array   解析草稿 [{productId,name,unit,supplyPrice,dailySupply,setPrice,setSupply,priceCheck,supplyCheck}]
 *     unmatchedDetails array   没对上商品的 [{name,op,value,valueText,numberCheck}]
 *     candidates       array   unmatched 的候选商品 [{productId,name,unit,supplyPrice,dailySupply}]
 *     question         string  服务端反问（needClarify）
 *   emits:
 *     close            遮罩/✕ 关闭（等于放弃本次；submitting 期间无效，防半提交）
 *     submitted        全部提交成功（父页可刷新列表；结果仍由组件内展示）
 *     resay(payload)   「重新说」（payload.draft=未提交草稿，语音页续对话）/「按住再报一条」（payload.draft=[]）
 *   picked / submitting / resultItems / draftItems 由组件内部管理，页面不参与确认态计算
 */
const props = defineProps({
  rawText: { type: String, default: '' },
  draft: { type: Array, default: () => [] },
  unmatchedDetails: { type: Array, default: () => [] },
  candidates: { type: Array, default: () => [] },
  question: { type: String, default: '' },
})
const emit = defineEmits(['close', 'submitted', 'resay'])

const phase = ref('confirm') // confirm | result（卡U 语义：确认 → 提交 → 结果，组件内闭环）

// 草稿（props 挂载时拷贝进内部 —— 组件随父页 v-if 重建，一轮解析一个实例）
const draftItems = ref([...props.draft])
const unmatchedDetails = ref([...props.unmatchedDetails])
const candidates = ref([...props.candidates])
const picked = ref({}) // 数字安全阀三选一：key = productId:price / productId:supply → 选中的数
const submitting = ref(false)
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
      phase.value = 'result'
    }
    return
  }
  submitting.value = false

  // ── 留痕：识别原文 + 提交值 → 现有审计日志（audit_log 表，不新增表不改 schema）──
  // 失败不阻断业务结果（业务已落库成功），只打 warn
  try {
    await post('/ai/supplier-audit-trail', { rawText: props.rawText, entries: auditEntries })
  } catch (e) {
    console.warn('[语音报量] 审计留痕失败（业务已提交成功）：', e)
  }

  phase.value = 'result'
  emit('submitted')
}

const leftoverNote = computed(() => {
  const notes = []
  if (draftItems.value.length) notes.push(`还有 ${draftItems.value.length} 项没提交上，可回到确认页重试`)
  if (unmatchedDetails.value.length) notes.push(`「${unmatchedDetails.value.map((u) => u.name).join('、')}」没对上商品，新品要先上架`)
  return notes.join('；')
})

// 关闭（遮罩 / ✕）：提交中禁止，防半提交
function requestClose() {
  if (submitting.value) return
  emit('close')
}

// 重新说：回按住说话（未提交的草稿交还父页 —— 语音页一段对话一张草稿）
function reSay() {
  emit('resay', { draft: [...draftItems.value] })
}

// 结果页「再报一条」：清空本轮结果，回按住说话（全新一轮，不带旧草稿 —— 卡U 语义）
function again() {
  emit('resay', { draft: [] })
}
</script>

<style lang="scss" scoped>
/* 抽屉（卡X：沿用页内 .mask 模式 + 底部升起容器，高度 ≤ 85% 屏高，内部可滚动） */
.vc-mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); z-index: 98;
  display: flex; flex-direction: column; justify-content: flex-end;
}
.vc-sheet {
  background: #F5F6F8; border-radius: 32rpx 32rpx 0 0;
  max-height: 85vh; overflow: hidden;
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
}
.vc-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 28rpx 8rpx; flex: none;
}
.vc-head-t { font-size: 28rpx; font-weight: 700; color: #1F2329; }
.vc-x { font-size: 34rpx; color: #8A9099; padding: 0 8rpx; line-height: 1; }
.vc-x.disabled { opacity: 0.35; }
/* 内容自适应高度、封顶 85vh 内（头部约 100rpx）：内部滚动，草稿卡+三选一+候选多长都不撑爆 */
/* 合规（2026-10-04）：AI 生成合成内容显著标识 */
.vc-ai-gen { background: #FFF1F0; border: 1px solid #FFCCC7; color: #CF1322; font-size: 24rpx; line-height: 1.6; padding: 14rpx 18rpx; border-radius: 12rpx; margin: 8rpx 0 16rpx; }
.vc-body { max-height: calc(85vh - 100rpx); overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 8rpx 24rpx 0; box-sizing: border-box; }

.tip-warn { background: #FFF8E8; border: 1px solid #FFE3A3; color: #8A5A00; font-size: 26rpx; line-height: 1.6; padding: 16rpx 20rpx; border-radius: 12rpx; margin-bottom: 20rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; }

/* 确认页（原型③屏）—— 样式自 voice-report.vue 原样搬出 */
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
</style>
