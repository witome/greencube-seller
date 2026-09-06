<template>
  <view class="page">
    <view v-if="order">
    <!-- 状态 + 进度条 -->
    <view class="card">
      <view class="od-status">{{ order.statusText }}</view>
      <view class="timeline">
        <view v-for="s in order.timeline" :key="s.status" class="tl-step">
          <view :class="['tl-dot', { done: s.done, cur: s.current }]"></view>
          <view :class="['tl-text', { done: s.done }]">{{ s.text }}</view>
        </view>
      </view>
    </view>

    <!-- 配送信息（待确认未支付：日期/时间段直接点选修改，无需进入编辑态） -->
    <view class="card">
      <view class="row">
        <text class="k">配送日期</text>
        <picker v-if="canEditDelivery" mode="date" :value="order.deliveryDate" :start="todayStr" @change="onDateChange">
          <text class="v picker-link">{{ order.deliveryDate }} ▾</text>
        </picker>
        <text v-else class="v">{{ order.deliveryDate }}</text>
      </view>
      <view class="row">
        <text class="k">时间段</text>
        <picker v-if="canEditDelivery" :range="timeWindows" :value="(order.timeWindow || 1) - 1" @change="onTimeChange">
          <text class="v picker-link">{{ timeWindowText(order.timeWindow) }} ▾</text>
        </picker>
        <text v-else class="v">{{ timeWindowText(order.timeWindow) }}</text>
      </view>
      <view v-if="order.remark" class="row"><text class="k">备注</text><text class="v">{{ order.remark }}</text></view>
    </view>

    <!-- 明细（待确认未支付可编辑） -->
    <view class="card">
      <view class="card-title">商品明细</view>
      <view v-for="it in order.items" :key="it.orderItemId" class="oi">
        <view class="oi-top">
          <view class="oi-name">{{ it.name }}</view>
          <view v-if="editing" class="oi-del" @tap="removeItem(it)">✕</view>
        </view>
        <view v-if="editing" class="oi-edit">
          <view class="stepper">
            <view class="st-btn" @tap="decrease(it)">−</view>
            <text class="st-num">{{ it.qtyOrdered }}</text>
            <view class="st-btn" @tap="increase(it)">＋</view>
          </view>
          <text class="st-unit">{{ it.unit }}</text>
        </view>
        <view v-else class="oi-qty">
          订 {{ it.qtyOrdered }}{{ it.unit }}
          <text v-if="it.qtyDeclared !== null"> · 报 {{ it.qtyDeclared }}</text>
          <text v-if="it.qtyAccepted !== null"> · 交 {{ it.qtyAccepted }}</text>
          <text v-if="it.qtyReceived !== null"> · 收 {{ it.qtyReceived }}</text>
        </view>
        <view class="oi-price">¥{{ (it.qtyOrdered * it.salePrice).toFixed(2) }}</view>
      </view>
      <view class="row" style="margin-top:10px;">
        <text class="k">下单金额</text><text class="v">¥{{ editing ? editTotal : order.amountOrdered }}</text>
      </view>
      <view v-if="!editing && order.amountFinal !== null" class="row">
        <text class="k">交付金额</text><text class="v" style="color:#fa5151;font-weight:700;">¥{{ order.amountFinal }}</text>
      </view>
    </view>

    <!-- 支付方式 / 操作 -->
    <view class="pay-card" v-if="order.status === 10 && order.payMethod === 0">
      <view class="card-title">确认订单并支付</view>
      <view v-if="editing" class="row-btns">
        <view class="pbtn" @tap="cancelEdit">取消编辑</view>
        <view class="pbtn primary" @tap="saveEdit">保存修改</view>
      </view>
      <view v-else class="row-btns">
        <view class="pbtn" @tap="startEdit">✏️ 编辑修改</view>
      </view>
      <view class="pay-row">
        <view class="pay-btn wechat" @tap="pay(1)">💚 微信支付</view>
        <view class="pay-btn cod" @tap="pay(2)">💰 货到付款</view>
      </view>
      <view class="cancel-link" @tap="cancel">取消订单</view>
    </view>

    <!-- 已支付提示 -->
    <view class="card" v-else-if="order.payMethod > 0">
      <view class="row"><text class="k">支付方式</text><text class="v" style="color:#00b96b;font-weight:600;">{{ payMethodText }}</text></view>
    </view>

    <!-- 收货操作 -->
    <view class="row-btns" v-if="order.status === 60">
      <view class="pbtn primary" @tap="receive">确认收货（全部接受）</view>
    </view>
    </view>

    <CustomTabBar :tabs="buyerTabs" active="/pages/buyer/order-list" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'

// 采购方底部导航（订单详情为二级页，原生 tabBar 不显示，用自定义栏补齐）
const buyerTabs = [
  { path: '/pages/buyer/home', icon: '🏠', label: '首页' },
  { path: '/pages/buyer/goods', icon: '🥬', label: '商品' },
  { path: '/pages/buyer/cart', icon: '🛒', label: '购物车' },
  { path: '/pages/buyer/order-list', icon: '📋', label: '订单' },
  { path: '/pages/buyer/mine', icon: '👤', label: '我的' },
]

const order = ref(null)
const orderId = ref('')
const editing = ref(false)

// 配送日期/时间段：待确认未支付时直接点选修改（无需进入编辑态）
const timeWindows = ['早 05-08 点', '中 10-13 点', '晚 16-19 点']
const timeWindowText = (w) => ({ 1: '早 05-08', 2: '中 10-13', 3: '晚 16-19' }[w] || '')
const _now = new Date()
const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`

const payMethodText = computed(() => ({ 1: '微信支付', 2: '货到付款' }[order.value?.payMethod] || ''))
const editTotal = computed(() => (order.value?.items || []).reduce((s, i) => s + i.qtyOrdered * i.salePrice, 0).toFixed(2))
// 配送日期/时间段可改：仅待确认(10)且未支付(0)
const canEditDelivery = computed(() => order.value?.status === 10 && order.value?.payMethod === 0)

const load = async () => {
  order.value = await buyerApi.getOrderDetail(orderId.value)
}

// ── 编辑 ──
const startEdit = () => { editing.value = true }
const cancelEdit = () => { editing.value = false; load() }

// 配送日期/时间段：改动后立即保存（复用 updateOrder，商品清单保持原样）
const saveDelivery = async (patch) => {
  const items = (order.value?.items || []).map((it) => ({ productId: it.productId, qty: it.qtyOrdered }))
  if (!items.length) return
  await buyerApi.updateOrder(orderId.value, { items, ...patch })
  uni.showToast({ title: '已更新配送时间', icon: 'none' })
  load()
}
const onDateChange = (e) => saveDelivery({ deliveryDate: e.detail.value })
const onTimeChange = (e) => saveDelivery({ timeWindow: Number(e.detail.value) + 1 })

const increase = (it) => { it.qtyOrdered = (it.qtyOrdered || 0) + 1 }
const decrease = (it) => { if (it.qtyOrdered > 1) it.qtyOrdered -= 1 }
const removeItem = (it) => { order.value.items = order.value.items.filter((x) => x.orderItemId !== it.orderItemId) }

const saveEdit = async () => {
  if (!order.value.items.length) {
    uni.showToast({ title: '订单至少保留一件商品', icon: 'none' })
    return
  }
  const items = order.value.items.map((it) => ({ productId: it.productId, qty: it.qtyOrdered }))
  await buyerApi.updateOrder(orderId.value, { items })
  uni.showToast({ title: '已保存修改', icon: 'success' })
  editing.value = false
  load()
}

// ── 支付 ──
const pay = async (payMethod) => {
  await buyerApi.payOrder(orderId.value, payMethod)
  uni.showToast({ title: payMethod === 1 ? '微信支付成功' : '已选货到付款', icon: 'success' })
  load()
}

const cancel = async () => {
  await buyerApi.cancelOrder(orderId.value)
  uni.showToast({ title: '已取消', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 600)
}

const receive = async () => {
  await buyerApi.receiveOrder(orderId.value, {
    items: order.value.items.map((i) => ({ orderItemId: i.orderItemId, qtyReceived: i.qtyAccepted ?? i.qtyOrdered, rejectQty: 0 })),
  })
  uni.showToast({ title: '已确认收货', icon: 'success' })
  setTimeout(load, 600)
}

onLoad((opts) => {
  orderId.value = opts.id
  load()
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.od-status { font-size: 18px; font-weight: 700; color: $color-primary; margin-bottom: 12px; }
.timeline { display: flex; justify-content: space-between; }
.tl-step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tl-dot { width: 10px; height: 10px; border-radius: 50%; background: #e5e7eb; }
.tl-dot.done { background: $color-primary; }
.tl-dot.cur { background: #ff8f1f; }
.tl-text { font-size: 10px; color: #c0c6cd; }
.tl-text.done { color: $text-title; }
.row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
.k { color: $text-second; }
.v { color: $text-title; }
.picker-link { color: $color-primary; font-weight: 600; }
.oi { padding: 8px 0; border-bottom: 1px solid #f0f1f3; }
.oi-top { display: flex; justify-content: space-between; align-items: center; }
.oi-name { font-size: 14px; font-weight: 600; color: $text-title; }
.oi-del { color: #fa5151; font-size: 15px; padding: 2px 6px; }
.oi-qty { font-size: 12px; color: $text-second; margin-top: 3px; }
.oi-edit { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.stepper { display: flex; align-items: center; gap: 12px; }
.st-btn { width: 26px; height: 26px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 15px; }
.st-num { font-size: 15px; font-weight: 600; min-width: 28px; text-align: center; }
.st-unit { font-size: 12px; color: $text-second; }
.oi-price { font-size: 13px; color: #fa5151; margin-top: 3px; }
.row-btns { padding: 12px; }
.pay-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.card-title { font-size: 14px; font-weight: 700; color: $text-title; margin-bottom: 8px; }
.pay-row { display: flex; gap: 10px; margin-top: 4px; }
.pay-btn { flex: 1; text-align: center; padding: 12px; border-radius: 22px; font-size: 15px; font-weight: 600; }
.pay-btn.wechat { background: #00b96b; color: #fff; }
.pay-btn.cod { background: #ff8f1f; color: #fff; }
.cancel-link { text-align: center; color: $text-placeholder; font-size: 13px; padding: 10px; }
</style>
