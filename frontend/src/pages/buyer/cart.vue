<template>
  <view class="page cart-page">
    <!-- 卡AQ：顶部标题条（原型 S1）—— 右上「清空」 -->
    <view class="pg-head">
      <text class="pg-title">订单草稿</text>
      <view class="pg-clear" @tap="clearAll">清空</view>
    </view>

    <!-- 卡AQ：上半 ≈45% 对话区（AI 下单助手） -->
    <view class="chat-zone">
      <view class="chat-hd"><view class="chat-dot"></view>AI 下单助手 · 说一句就写进草稿</view>
      <scroll-view class="chat" scroll-y :scroll-into-view="chatScrollTo" scroll-with-animation>
        <view v-for="(m, i) in messages" :key="i" :class="['brow', { me: m.role === 'me' }]">
          <view :class="['bubble', m.role === 'me' ? 'me' : 'ai']">{{ m.text }}</view>
        </view>
        <view id="cart-chat-bottom" style="height: 6px;"></view>
      </scroll-view>
    </view>

    <!-- 卡AQ：下半 ≈55% 实时草稿清单（可滚动，结算条在本区末尾随清单滚动） -->
    <scroll-view class="list-zone" scroll-y :scroll-into-view="listScrollTo" scroll-with-animation>
    <view v-if="!cart.length" class="empty">购物车空空如也，去挑点菜吧 🥬</view>

    <!-- 卡AQ：空态引导卡（原型 S2） -->
    <view v-if="!cart.length" class="dempty">
      <view class="de-ic">🧺</view>
      <view class="de-t1">还没有商品</view>
      <view class="de-t2">说一句「土豆50斤」，或点下面去商品页挑</view>
      <view class="de-go" @tap="goShop">去逛商品</view>
    </view>

    <view v-for="it in cart" :key="it.cartItemId" class="cart-item">
      <view class="ci-em">{{ emojiOf(it.name) }}</view>
      <view class="ci-main">
        <view class="ci-name">{{ it.name }}</view>
        <view class="ci-price">¥{{ it.salePrice }}/{{ it.unit }}</view>
      </view>
      <view class="ci-right">
        <view class="stepper">
          <view class="st-btn" @tap="changeQty(it, -1)">−</view>
          <text class="st-num">{{ it.qty }}</text>
          <view class="st-btn" @tap="changeQty(it, 1)">＋</view>
        </view>
        <view class="ci-sub">¥{{ (it.subtotal || 0).toFixed(2) }}</view>
        <view class="ci-del" @tap="remove(it)">✕</view>
      </view>
    </view>

    <!-- 卡AQ：没上架的菜 —— 不进清单，单走采购需求登记（红线 3） -->
    <view v-if="noticeText" class="dnotice">
      <view class="dn-tx">🤔 {{ noticeText }}</view>
    </view>

    <!-- 卡AQ：清单末尾三字段（配送日期 / 送达时段 / 备注）—— 前端持有，下单时才传给后端 -->
    <view v-if="cart.length" class="dmeta">
      <view class="dm-row">
        <view class="dm-k">配送日期</view>
        <view class="chip-group">
          <view v-for="d in dateOptions" :key="d.value" :class="['chip', { on: meta.deliveryDate === d.value }]" @tap="pickDate(d.value)">{{ d.label }}</view>
        </view>
      </view>
      <view class="dm-row">
        <view class="dm-k">送达时段</view>
        <view class="chip-group">
          <view v-for="w in winOptions" :key="w.value" :class="['chip', { on: meta.timeWindow === w.value }]" @tap="pickWindow(w.value)">{{ w.label }}</view>
        </view>
      </view>
      <view class="dm-row">
        <view class="dm-k">备注</view>
        <input class="dm-ipt" v-model="meta.remark" placeholder="选填" />
      </view>
    </view>

    <view v-if="cart.length" class="settle-bar">
      <view class="sb-total">
        合计 <text class="sb-price">¥{{ totalAmount }}</text>
      </view>
      <view class="sb-btn" @tap="submitOrder">提交订单</view>
      <view class="sb-go" @tap="goConfirm">去结算</view>
    </view>
      <view id="cart-list-bottom" style="height: 6px;"></view>
    </scroll-view>

    <!-- 卡AQ：输入栏吸底（话筒 + 输入框 + 发送），固定在页面最底部（tab 栏上方） -->
    <view class="dinput">
      <view
        v-if="voiceReady"
        class="mic"
        :class="{ on: voiceRecording, off: sending }"
        @touchstart="onMicStart"
        @touchend="onMicStop"
        @touchcancel="onMicStop"
      >{{ voiceRecording ? '🎤 聆听中…' : '🎤 按住说话' }}</view>
      <input class="dipt" v-model="inputText" placeholder="说一句：土豆50斤" confirm-type="send" @confirm="onSendTap" />
      <view class="send" :class="{ disabled: !inputText.trim() || sending }" @tap="onSendTap">发送</view>
    </view>

    <BuyerTabBar active="/pages/buyer/cart" />
    <!-- 卡AQ 复核（2026-10-01）：结算条从吸底挪到清单末尾后「去结算」会滚到列表底部停靠，
         原 offset=144 时 FAB 正好压住它。实测（390×753）：结算条停靠区 y=516.9~572.9、
         去结算按钮 y=528.9~560.9、吸底输入栏顶 y=593.6 —— FAB 56px 塞不进 560.9~593.6 的 32px 间隙，
         故取「整体抬到结算条之上」：offset ≥ 244（=753−56−508.9），这里取 248 留约 12px 余量。 -->
    <AiOrderFab :offset="248" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { onHide, onUnload } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'
import { guardBuyerSuspended } from '@/utils/account-guard'
import { createVoiceHold } from '@/utils/voice-record'
import { sendUtterance } from '@/utils/ai-order'
import { setDraftFromCart, deliveryMeta, setMeta, clearMeta, emojiOf, syncCartDraft, clearDraft } from '@/utils/ai-draft'
import BuyerTabBar from '@/components/BuyerTabBar.vue'
import AiOrderFab from '@/components/AiOrderFab.vue'

const cart = ref([])

const totalAmount = computed(() => cart.value.reduce((s, i) => s + i.subtotal, 0).toFixed(2))

const load = async () => {
  const data = await buyerApi.getCart()
  cart.value = data.list
}

const changeQty = async (it, delta) => {
  const qty = it.qty + delta
  if (qty <= 0) { await remove(it); return }
  await buyerApi.updateCart(it.cartItemId, qty)
  it.qty = qty
  it.subtotal = Math.round(qty * it.salePrice * 100) / 100
  uni.$emit('cart-badge-refresh')
}

const remove = async (it) => {
  await buyerApi.removeCart(it.cartItemId)
  cart.value = cart.value.filter((i) => i.cartItemId !== it.cartItemId)
  uni.$emit('cart-badge-refresh')
}

const submitOrder = async () => {
  // 配送日期：当天有可选时段用当天，否则顺延次日；自动选最早可用时段（不弹窗）
  let deliveryDate = dateStr()
  let winList = availableTimeWindows(deliveryDate)
  if (!winList.length) {
    deliveryDate = tomorrowStr()
    winList = availableTimeWindows(deliveryDate)
  }
  const w = winList[0]
  const order = await buyerApi.placeOrder({
    deliveryDate,
    timeWindow: w.value,
    items: cart.value.map((i) => ({ productId: i.productId, qty: i.qty })),
  })
  uni.showToast({ title: '下单成功', icon: 'success' })
  uni.$emit('cart-badge-refresh')
  setTimeout(() => uni.redirectTo({ url: `/pages/buyer/order-detail?id=${order.orderId}` }), 600)
}

// ⚠️ tabBar 页面切换回来只触发 onShow 不触发 onMounted，必须用 onShow 刷新，否则加购后切回购物车看不到新商品
onShow(async () => {
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  load()
})

// ══════════════════════════════════════════════════════════════
// 卡AQ（2026-10-01）：购物车 = 订单草稿 —— 以下全部为**新增**
// 老逻辑（load / changeQty / remove / submitOrder / onShow 停用检查 / 角标刷新）一行未删。
// ══════════════════════════════════════════════════════════════

/** 草稿与服务端 cart_item 的镜像同步点：
 *  cart 一变（加载 / 手动 +/- / 删除 / AI 说话后重新加载）就把共享草稿换成服务端最新清单，
 *  这样右下角 FAB 角标、助手页 kefu.vue 的草稿卡、商品页「加入草稿」看到的都是同一份。
 *  ⚠️ 用 deep watch 而不是在每个函数末尾补一行 —— 老函数一行都不用改，也不会漏掉哪条路径。
 *  ⚠️ 只负责「镜像」，**不做合并**（合并只有服务端 /ai/parse 一处）。 */
watch(
  cart,
  (list) => {
    setDraftFromCart(list || [])
    uni.$emit('cart-badge-refresh')
  },
  { deep: true },
)

// ── 三字段：配送日期 / 送达时段 / 备注（前端持有，不落服务端表；下单时才传给 placeOrder）──
const meta = deliveryMeta
const dateOptions = [
  { value: dateStr(), label: `今天 ${dateStr().slice(5)}` },
  { value: tomorrowStr(), label: `明天 ${tomorrowStr().slice(5)}` },
  { value: dateStr(new Date(Date.now() + 2 * 86400000)), label: `后天 ${dateStr(new Date(Date.now() + 2 * 86400000)).slice(5)}` },
]
const winOptions = computed(() => availableTimeWindows(meta.value.deliveryDate))

/** 首次进来给三字段一个默认值（当天有可选时段用当天，否则次日；时段取最早可用）——与老 submitOrder 同口径 */
const ensureMeta = () => {
  if (!meta.value.deliveryDate) {
    let d = dateStr()
    if (!availableTimeWindows(d).length) d = tomorrowStr()
    setMeta({ deliveryDate: d })
  }
  const wins = winOptions.value
  if (!wins.some((w) => w.value === meta.value.timeWindow)) {
    setMeta({ timeWindow: wins.length ? wins[0].value : 2 })
  }
}

const pickDate = (v) => {
  setMeta({ deliveryDate: v })
  const wins = availableTimeWindows(v)
  if (!wins.some((w) => w.value === meta.value.timeWindow)) setMeta({ timeWindow: wins.length ? wins[0].value : 2 })
}
const pickWindow = (v) => setMeta({ timeWindow: v })

// ── 对话区（页面本地，不共享、不落库 —— 口径：不带历史原话）──
const messages = ref([
  { role: 'ai', text: '你好，我是下单助手。说一句要买的菜，我直接写进草稿～' },
])
const inputText = ref('')
const sending = ref(false)
const noticeText = ref('')
const chatScrollTo = ref('')
const listScrollTo = ref('')

const pushMsg = (role, text) => {
  messages.value.push({ role, text })
  setTimeout(() => { chatScrollTo.value = 'cart-chat-bottom' }, 60)
}

/**
 * AI 回什么：全部用服务端给的文案，前端不自己拼（与助手页 kefu.vue 口径一致）
 * ⚠️ 「没上架的菜」绝不能报成「没听清」—— 那是两条完全不同的路
 */
const replyOf = (res) => {
  if (res.error) return '抱歉，刚才没听清（网络或服务异常）。草稿没变，可以再说一遍～'
  if (res.needClarify) return `❓ ${res.needClarify}（草稿先没动，直接回我是哪个就行）`
  const parts = []
  const changes = res.changes || []
  if (changes.length) parts.push(`好的，已写进草稿：${changes.map((c) => c.text).join('、')}。`)
  const unmatched = res.unmatched || []
  if (unmatched.length) {
    // 红线 3：没上架的菜不进清单，走「采购需求登记 + 到货通知」；
    // 「已帮你记下」只在**真的登记成功**时才说（与助手页同口径，不做假装记下）
    parts.push(`${unmatched.join('、')}我还没上架${res.demandRecorded ? '，已帮你记下' : ''}，到货通知你～`)
  }
  if (!parts.length) return '没听清菜名和数量，再说一次试试，比如「土豆50斤」。'
  return parts.join('')
}

/** 一句话 → 写进服务端草稿（cart_item）→ 刷新清单。红线 1：只动清单，**从不回写对话历史** */
const doSend = async (text) => {
  const t = String(text == null ? '' : text).trim()
  if (!t || sending.value) return
  sending.value = true
  pushMsg('me', t)
  const res = await sendUtterance(t)
  pushMsg('ai', replyOf(res))
  if ((res.unmatched || []).length) {
    noticeText.value = `${res.unmatched.join('、')}${res.demandRecorded ? ' 我还没上架，已帮你记下' : ' 我还没上架'}`
  } else {
    noticeText.value = ''
  }
  if (!res.error && !res.needClarify) {
    await load()
    setTimeout(() => { listScrollTo.value = 'cart-list-bottom' }, 60)
  }
  sending.value = false
}

const onSendTap = () => {
  const t = inputText.value
  inputText.value = ''
  doSend(t)
}

// ── 语音：必须复用 utils/voice-record.js（全仓不许有第二份插件调用）──
const voice = createVoiceHold({
  onDone: (text) => doSend(text),
  onFail: (msg, m) => {
    if (m && m.kind === 'empty') pushMsg('ai', `${msg}，可以再说一遍或改用打字`)
    else uni.showToast({ title: msg, icon: 'none' })
  },
})
const { ready: voiceReady, recording: voiceRecording } = voice
const onMicStart = voice.handleStart
const onMicStop = voice.handleStop
// ⑤ 离页必须停录（否则后台还在录、回调回来页面已销毁）
onHide(voice.stopForLeave)
onUnload(voice.stopForLeave)

// ── 清空（原型 S1 右上）／去逛商品（S2）／去结算（S1 结算条）──
const clearAll = async () => {
  if (!cart.value.length) return
  uni.showModal({
    title: '清空草稿',
    content: '会把这份草稿里的商品全部清掉，对话历史保留。确定吗？',
    confirmText: '清空',
    success: async (r) => {
      if (!r.confirm) return
      try {
        // 整体替换成空数组 —— 与 AI 说话同一个写口（/cart/sync），不另开清空接口
        await syncCartDraft([])
        clearMeta()
        clearDraft()
        noticeText.value = ''
        await load()
        uni.showToast({ title: '草稿已清空', icon: 'none' })
      } catch (e) {
        /* 错误已由 request.js 统一提示 */
      }
    },
  })
}

const goShop = () => {
  uni.switchTab({ url: '/pages/buyer/goods' })
}

/** 「去结算」→ 进确认页。三字段走共享 ref（ai-draft 的 deliveryMeta），确认页直接读，不靠 URL 传 */
const goConfirm = () => {
  if (!cart.value.length) return
  ensureMeta()
  uni.navigateTo({ url: '/pages/buyer/ai-confirm' })
}

// 首次进页面给三字段默认值（onShow 之后，避免挡住停用检查）
onShow(() => {
  ensureMeta()
})
</script>

<style lang="scss" scoped>
.cart-page { padding: 12px; padding-bottom: 140px; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 14px; }
.cart-item { display: flex; align-items: center; justify-content: space-between; background: #fff; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
.ci-name { font-size: 15px; font-weight: 600; color: $text-title; }
.ci-price { font-size: 12px; color: #fa5151; margin-top: 4px; }
.ci-right { display: flex; align-items: center; gap: 10px; }
.stepper { display: flex; align-items: center; gap: 10px; }
.st-btn { width: 26px; height: 26px; border-radius: 50%; background: #f0f1f3; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.st-num { font-size: 15px; font-weight: 600; min-width: 24px; text-align: center; }
.ci-del { color: $text-placeholder; font-size: 14px; }
/* 结算栏：bottom 抬高避开自定义 tabBar（实际约 64px + 安全区） */
.settle-bar { position: fixed; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom)); background: #fff; padding: 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 -2px 8px rgba(0,0,0,.05); z-index: 10; }
.sb-price { color: #fa5151; font-size: 18px; font-weight: 700; }
.sb-btn { background: $color-primary; color: #fff; padding: 10px 28px; border-radius: 22px; font-size: 15px; font-weight: 600; }

/* ══════════════════════════════════════════════════════════
   卡AQ（2026-10-01）新增样式 —— 全部写在后面：
   ① 覆盖在上面的是**本次改造**要的形状（同特异性后者胜 / 更高特异性直接胜），
      老规则一行没删，回滚时把这一段整段删掉即可恢复老页面；
   ② 老规则之所以还留着，是因为验收要求本文件删除数 = 0。
   ══════════════════════════════════════════════════════════ */

/* 页面改成「上对话 / 下清单 / 输入栏吸底」的纵向三段（原规则 padding 12px + 140px 不再适用） */
.cart-page {
  padding: 0;
  padding-bottom: calc(120px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: $bg-page;
}
/* 老的空态文案被原型 S2 的引导卡取代 —— 保留在模板里但不再渲染（删除数＝0 的代价） */
.cart-page .empty { display: none; }

/* ── 顶部标题条 ── */
.pg-head {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; background: #fff; border-bottom: 1px solid $border;
}
.pg-title { font-size: 15px; font-weight: 600; color: $text-title; }
.pg-clear { font-size: 13px; color: $text-second; padding: 2px 4px; border-radius: 6px; }

/* ── 上半：对话区（约 45%）── */
.chat-zone {
  flex: 0 0 45%; min-height: 0; display: flex; flex-direction: column;
  background: #fff; border-bottom: 1px solid $border;
}
.chat-hd {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
  padding: 8px 14px 6px; font-size: 11.5px; color: $brand-deep; font-weight: 700;
  border-bottom: 1px dashed $border;
}
.chat-dot { width: 6px; height: 6px; border-radius: 50%; background: $brand; }
.chat { flex: 1; min-height: 0; padding: 12px 14px 6px; box-sizing: border-box; }
.brow { display: flex; margin-bottom: 8px; }
.brow.me { justify-content: flex-end; }
.bubble {
  max-width: 80%; padding: 8px 11px; border-radius: 12px; font-size: 12.5px; line-height: 1.6;
}
.bubble.me { background: $brand; color: #fff; border-top-right-radius: 4px; }
.bubble.ai { background: #fff; color: $text-title; border: 1px solid $border; border-top-left-radius: 4px; }

/* ── 下半：草稿清单（约 55%，可滚动）── */
.list-zone { flex: 1 1 0; min-height: 0; background: $bg-page; box-sizing: border-box; padding-bottom: 8px; }
/* 结算条改回文档流，随清单滚动（不再 fixed）—— 被原型 S1 挪到清单末尾 */
.cart-page .settle-bar {
  position: static; margin: 12px; border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
}
/* 老的「提交订单」被原型 S1 的「去结算」取代 —— 同样保留在模板里、不渲染 */
.cart-page .settle-bar .sb-btn { display: none; }
.sb-go {
  background: $brand; color: #fff; padding: 9px 18px; border-radius: 22px;
  font-size: 14px; font-weight: 600; line-height: 1;
}

/* 草稿行：emoji + 菜名 + 单价 + 步进器 + 行小计 + 删除 */
.cart-page .cart-item { margin: 8px 12px 0; padding: 9px 10px; gap: 8px; }
.ci-em { font-size: 21px; width: 24px; flex: 0 0 auto; text-align: center; line-height: 1; }
.ci-main { flex: 1; min-width: 0; }
.cart-page .ci-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cart-page .ci-price { font-size: 10.5px; color: $text-second; margin-top: 3px; }
.ci-sub { font-size: 13px; font-weight: 700; color: $danger; width: 58px; text-align: right; flex: 0 0 auto; }

/* ── 清单末尾三字段 ── */
.dmeta { background: #fff; border-radius: 8px; margin: 8px 12px 10px; padding: 0 12px; }
.dm-row { display: flex; align-items: center; padding: 9px 0; border-bottom: 1px solid $bg-soft; }
.dm-row:last-child { border-bottom: none; }
.dm-k { font-size: 13px; color: $text-second; width: 72px; flex: 0 0 auto; }
.dm-ipt { flex: 1; font-size: 13px; color: $text-title; }
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; min-width: 0; }
.chip {
  padding: 6px 12px; border-radius: 16px; border: 1.5px solid $border-strong;
  font-size: 12px; color: $text-body; background: #fff;
}
.chip.on { background: $brand-soft; border-color: $brand; color: $brand; font-weight: 600; }

/* ── 没上架的菜（原型 S3 黄条；不进清单、不进金额、不进角标）── */
.dnotice {
  display: flex; align-items: center; gap: 8px; margin: 8px 12px 0;
  background: $warn-soft; border: 1px solid #FFE4BA; border-radius: 10px; padding: 9px 11px;
}
.dn-tx { flex: 1; min-width: 0; font-size: 11.5px; color: #C87000; line-height: 1.5; }

/* ── 空态引导卡（原型 S2）── */
.dempty { margin: 26px 12px 12px; background: #fff; border-radius: 14px; padding: 26px 18px; text-align: center; }
.de-ic { font-size: 38px; line-height: 1; }
.de-t1 { font-size: 15px; font-weight: 700; margin-top: 10px; }
.de-t2 { font-size: 11.5px; color: $text-second; line-height: 1.7; margin-top: 8px; }
.de-go {
  margin: 14px auto 0; width: 150px; padding: 10px 0; border-radius: 22px;
  background: $brand; color: #fff; font-size: 13.5px; font-weight: 700; text-align: center;
}

/* ── 输入栏吸底（tab 栏上方）── */
.dinput {
  position: fixed; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: 8px; padding: 8px 12px 12px;
  background: #fff; border-top: 1px solid $border; box-shadow: 0 -3px 10px rgba(0, 0, 0, .06); z-index: 20;
}
.mic {
  flex: 0 0 auto; height: 34px; padding: 0 11px; border-radius: 17px; background: $brand;
  color: #fff; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;
}
.mic.on { background: $brand-deep; }
.dipt {
  flex: 1; min-width: 0; background: $bg-page; border-radius: 18px;
  padding: 9px 12px; font-size: 12.5px; color: $text-title;
}
.send {
  flex: 0 0 auto; height: 34px; padding: 0 14px; border-radius: 17px; background: $brand;
  color: #fff; font-size: 12.5px; font-weight: 700; display: flex; align-items: center;
}
.send.disabled { opacity: .5; }
</style>
