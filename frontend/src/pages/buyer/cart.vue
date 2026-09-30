<template>
  <view class="page cart-page">
    <view v-if="!cart.length" class="empty">购物车空空如也，去挑点菜吧 🥬</view>

    <view v-for="it in cart" :key="it.cartItemId" class="cart-item">
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
        <view class="ci-del" @tap="remove(it)">✕</view>
      </view>
    </view>

    <view v-if="cart.length" class="settle-bar">
      <view class="sb-total">
        合计 <text class="sb-price">¥{{ totalAmount }}</text>
      </view>
      <view class="sb-btn" @tap="submitOrder">提交订单</view>
    </view>

    <BuyerTabBar active="/pages/buyer/cart" />
    <AiOrderFab :offset="144" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'
import { guardBuyerSuspended } from '@/utils/account-guard'
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
</style>
