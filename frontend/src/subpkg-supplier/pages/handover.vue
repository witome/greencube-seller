<template>
  <view class="page">
    <view class="notice">🤝 备好货后在此确认，配送员将扫码取货。有货直接备货，缺货请先到「备货单」异常申报。</view>

    <view v-for="o in orders" :key="o.orderId" class="ho-card">
      <view class="ho-head">
        <text class="ho-title">订单 #{{ o.orderId }}</text>
        <text class="ho-date">{{ o.deliveryDate }} 送达</text>
      </view>
      <view class="ho-items">
        <view v-for="it in o.items" :key="it.orderItemId" class="ho-item">
          <text>{{ it.productName }}</text>
          <text :class="{ shortage: isShortage(it) }">
            {{ isShortage(it) ? `缺货 ${it.qtyDeclared}${it.unit}` : `${it.qtyOrdered}${it.unit}` }}
          </text>
        </view>
      </view>
      <view class="ho-btn" @tap="handover(o)">确认备货完成</view>
    </view>
    <view v-if="!orders.length" class="empty">暂无待交接订单</view>

    <CustomTabBar :tabs="supplierTabs" active="/subpkg-supplier/pages/handover" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'

const supplierTabs = [
  { path: '/subpkg-supplier/pages/home', icon: '📋', label: '今日待办' },
  { path: '/subpkg-supplier/pages/stock-list', icon: '📄', label: '备货单' },
  { path: '/subpkg-supplier/pages/handover', icon: '🤝', label: '交接' },
  { path: '/subpkg-supplier/pages/finance', icon: '💰', label: '应付' },
  { path: '/subpkg-supplier/pages/mine', icon: '👤', label: '我的' },
]

const orders = ref([])
const isShortage = (it) => it.qtyDeclared !== null && Number(it.qtyDeclared) < Number(it.qtyOrdered)

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
.notice { margin: 10px 12px; padding: 8px 12px; background: #E8F1FF; border-radius: 8px; font-size: 12px; color: #3b7cff; }
.ho-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.ho-head { display: flex; justify-content: space-between; }
.ho-title { font-weight: 700; color: $text-title; }
.ho-date { font-size: 12px; color: $text-second; }
.ho-items { margin-top: 6px; }
.ho-item { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
.ho-item .shortage { color: #fa5151; font-weight: 600; }
.ho-btn { text-align: center; margin-top: 8px; padding: 8px; border-radius: 18px; background: $color-primary; color: #fff; font-size: 13px; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
</style>
