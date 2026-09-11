<template>
  <view class="aic-page" v-if="draft">
    <view class="notice">🤖 本单由 AI 识别生成，请核对商品与数量——可直接调整数量、删除商品，确认后正式下单</view>

    <!-- 商品清单 -->
    <view class="card list-card">
      <view v-for="(it, i) in items" :key="i" class="cart-row">
        <view class="c-img">{{ emojiOf(it.name) }}</view>
        <view class="c-main">
          <view class="c-t">{{ it.name }}</view>
          <view class="c-s">{{ specText(it) }}</view>
          <view class="c-p">¥{{ (it.qty * it.price).toFixed(2) }}</view>
        </view>
        <view class="c-right">
          <view class="ai-del" @tap="remove(i)">✕</view>
          <view class="stepper">
            <view class="st-btn" @tap="change(i, -1)">−</view>
            <view class="st-val">{{ it.qty }}</view>
            <view class="st-btn" @tap="change(i, 1)">+</view>
          </view>
        </view>
      </view>
      <view v-if="!items.length" class="empty-tip">暂未选择商品</view>
    </view>

    <!-- 添加商品 -->
    <view class="add-row">
      <view class="add-btn" @tap="addMore">＋ 添加商品</view>
    </view>

    <!-- 配送信息 -->
    <view class="card">
      <view class="form-row">
        <view class="fr-l">配送日期</view>
        <view class="chip-group">
          <view v-for="d in dateOptions" :key="d.value" :class="['chip', { on: deliveryDate === d.value }]" @tap="deliveryDate = d.value">{{ d.label }}</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">送达时段</view>
        <view class="chip-group">
          <view v-for="w in winOptions" :key="w.value" :class="['chip', { on: timeWindow === w.value }]" @tap="timeWindow = w.value">{{ w.label }}</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">收货地址</view>
        <view class="fr-r">{{ address || '未设置收货地址' }}</view>
      </view>
      <view class="form-row">
        <view class="fr-l">备注</view>
        <input class="ipt" v-model="remark" placeholder="选填" />
      </view>
    </view>

    <view class="notice">⚖️ 称重商品按验收实际重量结算，多退少补</view>

    <!-- 底部合计 + 确认 -->
    <view class="action-bar">
      <view class="ab-total">共 {{ items.length }} 项 · 预估合计 <b>¥{{ total.toFixed(2) }}</b></view>
      <view class="pbtn primary" :class="{ disabled: !items.length || submitting }" @tap="submit">确认下单</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi, authApi } from '@/api/modules'
import { dateStr, availableTimeWindows } from '@/utils/time-window'

const draft = ref(null)
const items = ref([])
const deliveryDate = ref('')
const timeWindow = ref(2)
const remark = ref('')
const address = ref('')
const submitting = ref(false)

const emojiOf = (name) => {
  const map = [['白菜','🥬'],['菜','🥬'],['土豆','🥔'],['肉','🥩'],['姜','🫚'],['葱','🌿'],['蛋','🥚'],['鸡','🍗'],['鱼','🐟'],['米','🌾']]
  for (const [k, e] of map) if (name.includes(k)) return e
  return '🥬'
}
const specText = (it) => {
  const weigh = it.weighType === 1 ? '称重' : '固定规格'
  const spec = it.specText ? ` · ${it.specText}` : ''
  return `${weigh} · ¥${it.price}/${it.unit}${spec}`
}

const dateOptions = [
  { value: dateStr(), label: `今天 ${dateStr().slice(5)}` },
  { value: dateStr(new Date(Date.now() + 86400000)), label: `明天 ${dateStr(new Date(Date.now() + 86400000)).slice(5)}` },
  { value: dateStr(new Date(Date.now() + 2 * 86400000)), label: `后天 ${dateStr(new Date(Date.now() + 2 * 86400000)).slice(5)}` },
]
const winOptions = computed(() => availableTimeWindows(deliveryDate.value))

const total = computed(() => items.value.reduce((s, it) => s + it.qty * it.price, 0))

const change = (i, delta) => {
  const next = items.value[i].qty + delta
  if (next < 1) return
  items.value[i].qty = Math.round(next * 10) / 10
}
const remove = (i) => items.value.splice(i, 1)
const addMore = () => uni.switchTab({ url: '/pages/buyer/goods' })

const submit = async () => {
  if (!items.value.length || submitting.value) return
  submitting.value = true
  try {
    const order = await buyerApi.placeOrder({
      deliveryDate: deliveryDate.value,
      timeWindow: timeWindow.value,
      remark: remark.value || undefined,
      items: items.value.map((it) => ({ productId: it.productId, qty: it.qty })),
    })
    uni.removeStorageSync('aiDraft')
    uni.redirectTo({ url: `/pages/buyer/order-detail?id=${order.orderId}` })
  } catch (e) {
    // 错误已由 request.js 统一提示
  } finally {
    submitting.value = false
  }
}

onLoad(async () => {
  draft.value = uni.getStorageSync('aiDraft') || null
  if (!draft.value) {
    uni.showToast({ title: '未找到订单草稿', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 800)
    return
  }
  items.value = (draft.value.items || []).map((it) => ({ ...it }))
  deliveryDate.value = draft.value.deliveryDate || dateStr(new Date(Date.now() + 86400000))
  remark.value = draft.value.remark || ''
  const win = availableTimeWindows(deliveryDate.value)
  timeWindow.value = win.length ? win[0].value : 2
  try {
    const profile = await authApi.getProfile()
    address.value = profile?.purchaser?.address || ''
  } catch (e) { /* 忽略 */ }
})
</script>

<style lang="scss" scoped>
.aic-page { padding-bottom: 70px; }
.notice { background: $warn-soft; color: $warn; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 10px 12px; }
.card { background: $bg-card; border-radius: 12px; margin: 6px 12px; padding: 4px 12px; }
.list-card { padding: 4px 10px; }
.cart-row { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid $bg-soft; }
.cart-row:last-child { border-bottom: none; }
.c-img { width: 46px; height: 46px; border-radius: 10px; background: $bg-soft; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
.c-main { flex: 1; min-width: 0; }
.c-t { font-size: 13px; font-weight: 600; color: $text-title; }
.c-s { font-size: 10px; color: $text-second; margin-top: 2px; }
.c-p { font-size: 13px; color: $danger; font-weight: 700; margin-top: 3px; }
.c-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.ai-del { color: $text-disabled; font-size: 15px; padding: 0 4px; }
.stepper { display: flex; align-items: center; gap: 8px; }
.st-btn { width: 26px; height: 26px; border-radius: 8px; border: 1px solid $border-strong; background: #fff; font-size: 16px; color: $text-body; display: flex; align-items: center; justify-content: center; }
.st-val { min-width: 40px; text-align: center; font-size: 14px; font-weight: 700; color: $text-title; }
.empty-tip { text-align: center; color: $text-placeholder; padding: 24px 0; font-size: 13px; }

.add-row { padding: 4px 12px; }
.add-btn { text-align: center; padding: 11px 0; border-radius: 10px; border: 1.5px solid $brand; color: $brand; font-size: 13px; font-weight: 600; background: #fff; }

.form-row { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid $bg-soft; }
.form-row:last-child { border-bottom: none; }
.fr-l { width: 72px; font-size: 13px; color: $text-second; flex-shrink: 0; }
.fr-r { flex: 1; font-size: 13px; color: $text-body; }
.ipt { flex: 1; font-size: 13px; }
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 12px; border-radius: 16px; border: 1.5px solid $border-strong; font-size: 12px; color: $text-body; background: #fff; }
.chip.on { background: $brand-soft; border-color: $brand; color: $brand; font-weight: 600; }

.action-bar { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; border-top: 1px solid $border; padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
.ab-total { flex: 1; font-size: 12px; color: $text-second; }
.ab-total b { font-size: 17px; color: $danger; }
.pbtn { flex: none; border-radius: 10px; padding: 11px 24px; text-align: center; font-size: 14px; font-weight: 600; }
.pbtn.primary { background: $brand; color: #fff; }
.pbtn.disabled { opacity: 0.5; }
</style>
