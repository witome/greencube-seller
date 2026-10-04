<template>
  <view class="page">
    <view class="tip-bar">✅ 有货直接「确认备货完成」即可；缺货才需「异常申报」</view>

    <view v-for="o in orders" :key="o.orderId" class="stock-card">
      <view class="sc-head">
        <text class="sc-title">订单 #{{ o.orderId }}</text>
        <text class="sc-date">{{ o.deliveryDate }} 送达</text>
      </view>
      <!-- 卡BJ：接单状态（卡片头显示，未接单不显示这行） -->
      <view v-if="o.ackAt" class="sc-acked">备货中 · 已接单 {{ fmtHM(o.ackAt) }}</view>
      <view class="sc-items">
        <view v-for="it in o.items" :key="it.orderItemId" class="sc-item">
          <text>{{ it.productName }}</text>
          <text :class="{ shortage: isShortage(it) }">
            {{ isShortage(it) ? `缺货 · 实交 ${it.qtyDeclared}${it.unit}` : `订 ${it.qtyOrdered}${it.unit}` }}
          </text>
        </view>
      </view>
      <!-- 卡BN-3：未接单且已超阈值 → 红字提示（明细下方、按钮上方；阈值/createdAt 取不到不显示，不出 NaN） -->
      <view v-if="!o.ackAt && overThreshold(o)" class="sc-unacked">已超过 {{ notifyThreshold }} 分钟未接单，系统已打电话提醒你。请尽快接单，避免耽误配送。</view>
      <view class="sc-btns">
        <!-- 卡BJ：未接单 → 主按钮「收到，开始备货」（醒目实心绿）；接单后恢复原来的两个按钮 -->
        <template v-if="!o.ackAt">
          <view class="sc-btn ack" @tap="ackOrder(o)">收到，开始备货</view>
        </template>
        <template v-else>
          <view class="sc-btn ghost" @tap="goDeclare(o.orderId)">异常申报</view>
          <view class="sc-btn primary" @tap="handover(o)">确认备货完成</view>
        </template>
      </view>
    </view>
    <view v-if="!orders.length" class="empty">暂无待备货订单</view>

    <CustomTabBar :tabs="supplierTabs" active="/subpkg-supplier/pages/stock-list" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'
import { useNewOrderAlerter } from '@/utils/new-order-alerter'
import CustomTabBar from '@/components/CustomTabBar.vue'

const orders = ref([])

// 新单语音提示（2026-09-12 拍板 1A）：30s 轮询现有接口，比对订单 id，新单播预置音频
// 首次=基线不播；同单只播一次；onHide 停/onShow 启（见 @/utils/new-order-alerter）
useNewOrderAlerter(async () => (await supplierApi.getStockList()).map((o) => o.orderId), { tag: 'supplier-stock-list' })

const supplierTabs = [
  { path: '/subpkg-supplier/pages/home', icon: '📋', label: '今日待办' },
  { path: '/subpkg-supplier/pages/stock-list', icon: '📄', label: '备货单' },
  { path: '/subpkg-supplier/pages/handover', icon: '🤝', label: '交接' },
  { path: '/subpkg-supplier/pages/finance', icon: '💰', label: '应付' },
  { path: '/subpkg-supplier/pages/mine', icon: '👤', label: '我的' },
]

const isShortage = (it) => it.qtyDeclared !== null && Number(it.qtyDeclared) < Number(it.qtyOrdered)

const goDeclare = (orderId) => uni.navigateTo({ url: `/subpkg-supplier/pages/stock-declare?orderId=${orderId}` })

// 卡BJ：接单时间展示（HH:mm，本地时区）
const fmtHM = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
// 卡BJ：接单进行中标记（防双击重复请求；后端本就幂等，这里只为体验）
const acking = ref({})
const ackOrder = async (o) => {
  if (acking.value[o.orderId]) return
  acking.value = { ...acking.value, [o.orderId]: true }
  try {
    const res = await supplierApi.ackStock(o.orderId)
    // 局部更新：只改这张卡片的 ackAt，不整页刷新、不丢滚动位置
    o.ackAt = res?.ackAt || new Date().toISOString()
    uni.showToast({ title: '已接单', icon: 'success' })
  } catch (e) {
    // request.js 已统一 toast；保持未接单态，可重试
  } finally {
    const next = { ...acking.value }
    delete next[o.orderId]
    acking.value = next
  }
}

const handover = async (o) => {
  await supplierApi.handover(o.orderId)
  uni.showToast({ title: '已确认备货完成', icon: 'success' })
  orders.value = orders.value.filter((x) => x.orderId !== o.orderId)
}

onShow(async () => {
  orders.value = await supplierApi.getStockList()
})

// ─── 卡BN-3（2026-10-02）：未接单超阈值红字提示 ───
// 阈值进页拉一次缓存（onShow 拉一次，不轮询）；取不到 → null → 提示一律不显示
const notifyThreshold = ref(null)
onShow(async () => {
  try {
    const me = await supplierApi.getNotifySetting()
    notifyThreshold.value = (me && me.thresholdMinutes != null) ? me.thresholdMinutes : null
  } catch (e) {
    notifyThreshold.value = null
  }
})
// 判据与后端口径一致：minutesUnacked = now - createdAt，>= thresholdMinutes 即超时；
// 仅未接单（!ackAt）且阈值/createdAt 齐备时才成立
const overThreshold = (o) => {
  if (o.ackAt || notifyThreshold.value == null || !o.createdAt) return false
  return Date.now() - new Date(o.createdAt).getTime() >= notifyThreshold.value * 60000
}
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; padding-bottom: calc(70px + env(safe-area-inset-bottom)); padding-bottom: calc(70px + var(--ctb-safe-final, env(safe-area-inset-bottom))); } /* 卡BF: 三重声明，env 失效时由 CustomTabBar 写入的 --ctb-safe-final 兜底 */
.tip-bar { margin: 10px 12px; padding: 8px 12px; background: #E6F9F0; border-radius: 8px; font-size: 12px; color: $color-primary; }
.stock-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.sc-head { display: flex; justify-content: space-between; }
.sc-title { font-weight: 700; color: $text-title; }
.sc-date { font-size: 12px; color: $text-second; }
.sc-items { margin-top: 6px; }
.sc-item { display: flex; justify-content: space-between; font-size: 13px; color: $text-title; padding: 4px 0; }
.sc-item .shortage { color: #fa5151; font-weight: 600; }
/* 卡BJ：卡片头接单状态行 + 「收到，开始备货」实心绿主按钮 */
.sc-acked { font-size: 12px; color: #00b96b; font-weight: 600; margin-top: 3px; }
.sc-btn.ack { background: #00b96b; color: #fff; }
.sc-btns { display: flex; gap: 8px; margin-top: 10px; }
.sc-btn { flex: 1; text-align: center; padding: 8px 0; border-radius: 18px; font-size: 13px; font-weight: 600; }
.sc-btn.ghost { background: #f0f1f3; color: $text-second; }
.sc-btn.primary { background: $color-primary; color: #fff; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
/* 卡BN-3：未接单超阈值提示（浅红底 + 红字 + 圆角 8，照原型 S4） */
.sc-unacked { margin-top: 8px; padding: 8px 10px; background: #FFF3F3; border: 1px solid #FFD9D9; border-radius: 8px; font-size: 12px; line-height: 1.5; color: #C0392B; }
</style>
