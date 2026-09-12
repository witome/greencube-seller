<template>
  <view class="page">
    <view class="tip-bar">✅ 有货直接「确认备货完成」即可；缺货才需「异常申报」</view>

    <view v-for="o in orders" :key="o.orderId" class="stock-card">
      <view class="sc-head">
        <text class="sc-title">订单 #{{ o.orderId }}</text>
        <text class="sc-date">{{ o.deliveryDate }} 送达</text>
      </view>
      <view class="sc-items">
        <view v-for="it in o.items" :key="it.orderItemId" class="sc-item">
          <text>{{ it.productName }}</text>
          <text :class="{ shortage: isShortage(it) }">
            {{ isShortage(it) ? `缺货 · 实交 ${it.qtyDeclared}${it.unit}` : `订 ${it.qtyOrdered}${it.unit}` }}
          </text>
        </view>
      </view>
      <view class="sc-btns">
        <view class="sc-btn ghost" @tap="goDeclare(o.orderId)">异常申报</view>
        <view class="sc-btn primary" @tap="handover(o)">确认备货完成</view>
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

const handover = async (o) => {
  await supplierApi.handover(o.orderId)
  uni.showToast({ title: '已确认备货完成', icon: 'success' })
  orders.value = orders.value.filter((x) => x.orderId !== o.orderId)
}

onShow(async () => {
  orders.value = await supplierApi.getStockList()
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.tip-bar { margin: 10px 12px; padding: 8px 12px; background: #E6F9F0; border-radius: 8px; font-size: 12px; color: $color-primary; }
.stock-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.sc-head { display: flex; justify-content: space-between; }
.sc-title { font-weight: 700; color: $text-title; }
.sc-date { font-size: 12px; color: $text-second; }
.sc-items { margin-top: 6px; }
.sc-item { display: flex; justify-content: space-between; font-size: 13px; color: $text-title; padding: 4px 0; }
.sc-item .shortage { color: #fa5151; font-weight: 600; }
.sc-btns { display: flex; gap: 8px; margin-top: 10px; }
.sc-btn { flex: 1; text-align: center; padding: 8px 0; border-radius: 18px; font-size: 13px; font-weight: 600; }
.sc-btn.ghost { background: #f0f1f3; color: $text-second; }
.sc-btn.primary { background: $color-primary; color: #fff; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
</style>
