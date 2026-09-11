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

    <!-- 订单时间：下单 / 交付确认 -->
    <view class="card">
      <view class="row">
        <text class="k">下单时间</text>
        <text class="v">{{ fmtTime(order.createdAt) || '—' }}</text>
      </view>
      <view class="row">
        <text class="k">交付确认时间</text>
        <text v-if="order.deliveredAt" class="v">{{ fmtTime(order.deliveredAt) }}</text>
        <text v-else class="v" style="color:#c0c6cd;">待交付</text>
      </view>
    </view>

    <!-- 配送信息（待确认未支付：日期/时间段直接点选修改，无需进入编辑态） -->
    <view class="card">
      <view class="row">
        <text class="k">配送日期</text>
        <picker v-if="canEdit" mode="date" :value="order.deliveryDate" :start="todayStr" @change="onDateChange">
          <text class="v picker-link">{{ order.deliveryDate }} ▾</text>
        </picker>
        <text v-else class="v">{{ order.deliveryDate }}</text>
      </view>
      <view class="row">
        <text class="k">时间段</text>
        <picker v-if="canEdit && order.urgent !== 1" :range="timeWindows" :value="(order.timeWindow || 1) - 1" @change="onTimeChange">
          <text class="v picker-link">{{ timeWindowText(order.timeWindow) }} ▾</text>
        </picker>
        <text v-else-if="order.urgent === 1" class="v" style="color:#fa5151;font-weight:600;">已按加急处理</text>
        <text v-else class="v">{{ timeWindowText(order.timeWindow) }}</text>
      </view>
      <view class="row">
        <text class="k">加急配送</text>
        <view v-if="canEdit" class="urgent-toggle" :class="{ on: order.urgent === 1 }" @tap="toggleUrgent">
          {{ order.urgent === 1 ? '✅ 已加急' : '⚡ 加急' }}
        </view>
        <text v-else class="v" :style="order.urgent === 1 ? 'color:#fa5151;font-weight:600;' : ''">{{ order.urgent === 1 ? '已加急' : '普通' }}</text>
      </view>
    </view>

    <!-- 明细（待确认未支付：直接加减/删除，改动自动保存） -->
    <view class="card">
      <view class="card-title">商品明细</view>
      <view v-for="it in order.items" :key="it.orderItemId" class="oi">
        <view class="oi-top">
          <view class="oi-name">{{ it.name }}</view>
          <view v-if="canEdit" class="oi-del" @tap="removeItem(it)">✕</view>
        </view>
        <view v-if="canEdit" class="oi-edit">
          <view class="stepper">
            <view class="st-btn" @tap="decrease(it)">−</view>
            <input class="st-num" type="number" :value="it.qtyOrdered" @input="onQtyInput(it, $event)" @blur="onQtyBlur(it)" />
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
        <view v-if="canEdit" class="oi-remark">
          <input class="remark-input" v-model="it.remark" placeholder="单品备注（选填，如：切块、要嫩）" @blur="scheduleSave()" />
        </view>
        <view v-else-if="it.remark" class="oi-remark-text">备注：{{ it.remark }}</view>
      </view>
      <view class="row" style="margin-top:10px;">
        <text class="k">下单金额</text><text class="v">¥{{ canEdit ? editTotal : order.amountOrdered }}</text>
      </view>
      <view class="row">
        <text class="k">运费</text>
        <view class="v" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">
          <text :style="displayDeliveryFee > 0 ? 'color:#fa5151;' : 'color:#00b96b;'">
            {{ displayDeliveryFee > 0 ? '¥' + displayDeliveryFee : '免运费' }}
          </text>
          <!-- 加急时：显示加急满额免运费 + 次日配送免运费 -->
          <template v-if="order.urgent === 1">
            <text v-if="order.urgentFreeThreshold > 0" class="fee-tip">加急满 ¥{{ order.urgentFreeThreshold }} 免运费</text>
            <text v-if="order.freeNextDay" class="fee-tip">次日配送免运费</text>
          </template>
          <!-- 非加急时：显示满额免运费 + 次日配送免运费 -->
          <template v-else>
            <text v-if="order.freeDeliveryThreshold && order.deliveryDate === todayStr" class="fee-tip">满 ¥{{ order.freeDeliveryThreshold }} 免运费</text>
            <text v-if="order.freeNextDay && order.deliveryDate === todayStr" class="fee-tip">次日配送免运费</text>
          </template>
        </view>
      </view>
      <view v-if="!canEdit && order.amountFinal !== null" class="row">
        <text class="k">交付金额</text><text class="v" style="color:#fa5151;font-weight:700;">¥{{ order.amountFinal }}</text>
      </view>
      <view class="row">
        <text class="k">订单总金额</text><text class="v" style="color:#fa5151;font-weight:700;">¥{{ orderTotal }}</text>
      </view>
      <view class="row order-remark-row">
        <text class="k">订单备注</text>
        <input v-if="canEdit" class="order-remark-input" v-model="order.remark" placeholder="选填" @blur="saveOrderRemark" />
        <text v-else class="v">{{ order.remark || '无' }}</text>
      </view>
    </view>

    <!-- 支付方式 / 操作 -->
    <view class="pay-card" v-if="order.status === 10 && order.payMethod === 0">
      <view class="card-title">确认订单并支付</view>
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

// 配送日期/时间段：待确认未支付时直接点选修改（无需进入编辑态）
const timeWindows = ['早 05-08 点', '中 10-13 点', '晚 16-19 点']
const timeWindowText = (w) => ({ 1: '早 05-08', 2: '中 10-13', 3: '晚 16-19' }[w] || '')
const _now = new Date()
const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
const _tomorrow = new Date(_now.getTime() + 86400000)
const tomorrowStr = `${_tomorrow.getFullYear()}-${String(_tomorrow.getMonth() + 1).padStart(2, '0')}-${String(_tomorrow.getDate()).padStart(2, '0')}`

const payMethodText = computed(() => ({ 1: '微信支付', 2: '货到付款' }[order.value?.payMethod] || ''))

// 后端返回 ISO 时间 → 本地 YYYY-MM-DD HH:mm
const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const editTotal = computed(() => (order.value?.items || []).reduce((s, i) => s + i.qtyOrdered * i.salePrice, 0).toFixed(2))
// 可编辑（配送日期/时间段/商品明细）：仅待确认(10)且未支付(0)
const canEdit = computed(() => order.value?.status === 10 && order.value?.payMethod === 0)

// 实时运费（本地按运费规则计算，改商品数量即时联动）：
// 加急：运费 = 加急运费（单独计，不叠加常规运费；满 urgentFreeThreshold 免）
// 非加急：次日达免运费 > 满额免运费 > 否则收基础运费
const liveDeliveryFee = computed(() => {
  const o = order.value
  if (!o) return 0
  const amount = Number(editTotal.value)
  // 加急：单独计加急运费（不叠加常规运费）
  if (o.urgent === 1) {
    if (o.urgentFreeThreshold > 0 && amount >= o.urgentFreeThreshold) return 0
    return o.urgentFee ?? 0
  }
  // 非加急：常规运费
  if (o.freeNextDay && o.deliveryDate === tomorrowStr) return 0
  if (o.freeDeliveryThreshold > 0 && amount >= o.freeDeliveryThreshold) return 0
  return o.baseDeliveryFee ?? 0
})
// 展示运费：可编辑时用实时值，否则用后端已确定的运费
const displayDeliveryFee = computed(() => (canEdit.value ? liveDeliveryFee.value : Number(order.value?.deliveryFee || 0)))

// 订单总金额 = 下单金额 + 运费（编辑态实时联动）
const orderTotal = computed(() => {
  const o = order.value
  if (!o) return '0.00'
  if (canEdit.value) {
    return (Number(editTotal.value) + displayDeliveryFee.value).toFixed(2)
  }
  return (Number(o.amountOrdered) + Number(o.deliveryFee || 0)).toFixed(2)
})

const load = async () => {
  order.value = await buyerApi.getOrderDetail(orderId.value)
}

// 统一构造提交的商品清单（含商品备注）
const buildItems = () => (order.value?.items || []).map((it) => ({ productId: it.productId, qty: it.qtyOrdered, remark: it.remark || null }))

// ── 商品明细：直接加减/删除，改动后自动保存（debounce 600ms） ──
let saveTimer = null
// 立即保存（支付前调用，确保最新改动已提交到后端）
const flushSave = async () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const items = buildItems()
  if (!items.length) return
  await buyerApi.updateOrder(orderId.value, { items })
}
const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const items = buildItems()
      if (!items.length) return
      await buyerApi.updateOrder(orderId.value, { items })
    } catch (e) {
      uni.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  }, 600)
}

// 配送日期/时间段：改动后立即保存（复用 updateOrder，商品清单保持原样）
const saveDelivery = async (patch) => {
  const items = buildItems()
  if (!items.length) return
  await buyerApi.updateOrder(orderId.value, { items, ...patch })
  uni.showToast({ title: '已更新配送时间', icon: 'none' })
  load()
}
const onDateChange = (e) => saveDelivery({ deliveryDate: e.detail.value })
const onTimeChange = (e) => saveDelivery({ timeWindow: Number(e.detail.value) + 1 })

// 订单备注：失焦保存
const saveOrderRemark = async () => {
  const items = buildItems()
  if (!items.length) return
  await buyerApi.updateOrder(orderId.value, { items, remark: order.value?.remark || null })
}

const increase = (it) => { it.qtyOrdered = (it.qtyOrdered || 0) + 1; scheduleSave() }
const decrease = (it) => {
  if (it.qtyOrdered > 1) { it.qtyOrdered -= 1; scheduleSave() }
  else uni.showToast({ title: '数量至少为 1', icon: 'none' })
}
// 输入数量（实时联动金额，失焦时校验并保存）
const onQtyInput = (it, e) => {
  const val = Number(e.detail.value)
  if (val > 0) it.qtyOrdered = val
}
const onQtyBlur = (it) => {
  const val = Number(it.qtyOrdered)
  if (!val || val < 1) it.qtyOrdered = 1
  else it.qtyOrdered = Math.floor(val)
  scheduleSave()
}
const removeItem = (it) => {
  if (order.value.items.length <= 1) {
    uni.showToast({ title: '订单至少保留一件商品', icon: 'none' })
    return
  }
  order.value.items = order.value.items.filter((x) => x.orderItemId !== it.orderItemId)
  scheduleSave()
}

// ── 加急 / 取消加急 ──
const toggleUrgent = async () => {
  const target = order.value.urgent === 1 ? 0 : 1
  await buyerApi.setUrgent(orderId.value, target)
  uni.showToast({ title: target === 1 ? '已加急' : '已取消加急', icon: 'none' })
  load()
}

// ── 支付 ──
const pay = async (payMethod) => {
  await flushSave() // 支付前先保存最新改动（防止 debounce 未触发就支付）
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
.fee-tip { font-size: 11px; color: $text-placeholder; }
.picker-link { color: $color-primary; font-weight: 600; }
.urgent-toggle { color: #fa5151; font-size: 13px; font-weight: 600; padding: 2px 10px; border: 1px solid #fa5151; border-radius: 14px; }
.urgent-toggle.on { color: #fff; background: #fa5151; }
.oi { padding: 8px 0; border-bottom: 1px solid #f0f1f3; }
.oi-top { display: flex; justify-content: space-between; align-items: center; }
.oi-name { font-size: 14px; font-weight: 600; color: $text-title; }
.oi-del { color: #fa5151; font-size: 15px; padding: 2px 6px; }
.oi-qty { font-size: 12px; color: $text-second; margin-top: 3px; }
.oi-edit { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.stepper { display: flex; align-items: center; gap: 12px; }
.st-btn { width: 26px; height: 26px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 15px; }
.st-num { font-size: 15px; font-weight: 600; min-width: 48px; width: 48px; height: 30px; text-align: center; background: #f7f8fa; border-radius: 6px; }
.st-unit { font-size: 12px; color: $text-second; }
.oi-price { font-size: 13px; color: #fa5151; margin-top: 3px; }
.oi-remark { margin-top: 6px; }
.remark-input { font-size: 12px; background: #f7f8fa; border-radius: 6px; padding: 6px 8px; }
.oi-remark-text { font-size: 12px; color: #fa8c16; margin-top: 4px; }
.order-remark-row { align-items: center; }
.order-remark-input { flex: 1; margin-left: 12px; font-size: 12px; background: #f7f8fa; border-radius: 6px; padding: 6px 8px; text-align: right; }
.row-btns { padding: 12px; }
.pay-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.card-title { font-size: 14px; font-weight: 700; color: $text-title; margin-bottom: 8px; }
.pay-row { display: flex; gap: 10px; margin-top: 4px; }
.pay-btn { flex: 1; text-align: center; padding: 12px; border-radius: 22px; font-size: 15px; font-weight: 600; }
.pay-btn.wechat { background: #00b96b; color: #fff; }
.pay-btn.cod { background: #ff8f1f; color: #fff; }
.cancel-link { text-align: center; color: $text-placeholder; font-size: 13px; padding: 10px; }
</style>
