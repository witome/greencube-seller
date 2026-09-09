<template>
  <view class="page">
    <!-- 状态筛选 -->
    <scroll-view scroll-x class="chips-row">
      <view v-for="s in statusTabs" :key="s.value" :class="['chip', { on: activeStatus === s.value }]" @tap="switchStatus(s.value)">{{ s.label }}</view>
    </scroll-view>

    <view v-for="o in orders" :key="o.orderId" class="order-card" @tap="goDetail(o.orderId)">
      <view class="oc-head">
        <text class="oc-date">{{ o.deliveryDate }} · {{ timeText(o.timeWindow) }}</text>
        <text class="oc-status">{{ o.statusText }}</text>
      </view>
      <view class="oc-body">
        <text>{{ o.itemCount }} 项商品</text>
        <text v-if="o.amountFinal" class="oc-amount">¥{{ o.amountFinal }}</text>
      </view>
    </view>

    <view v-if="!orders.length && !loading" class="empty">暂无订单</view>

    <BuyerTabBar active="/pages/buyer/order-list" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import BuyerTabBar from '@/components/BuyerTabBar.vue'

const orders = ref([])
const activeStatus = ref('')
const loading = ref(false)

const statusTabs = [
  { label: '全部', value: '' },
  { label: '待确认', value: 10 },
  { label: '备货中', value: 30 },
  { label: '配送中', value: 50 },
  { label: '已完成', value: 70 },
]

const timeText = (w) => ({ 1: '早 05-08', 2: '中 10-13', 3: '晚 16-19' }[w] || '')

const load = async () => {
  loading.value = true
  // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成 "undefined"，导致后端误过滤
  const params = { page: 1, pageSize: 20 }
  if (activeStatus.value) params.status = activeStatus.value
  const data = await buyerApi.getOrderList(params)
  orders.value = data.list
  loading.value = false
}

const switchStatus = (v) => { activeStatus.value = v; load() }
const goDetail = (id) => uni.navigateTo({ url: `/pages/buyer/order-detail?id=${id}` })

// tabBar 页用 onShow 刷新（原 onMounted 未导入会导致订单不加载）
onShow(() => {
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  load()
})
</script>

<style lang="scss" scoped>
.chips-row { white-space: nowrap; padding: 10px 12px; }
.chip { display: inline-block; padding: 6px 14px; border-radius: 16px; background: #f0f1f3; font-size: 13px; color: $text-second; margin-right: 8px; }
.chip.on { background: $color-primary; color: #fff; }
.order-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.oc-head { display: flex; justify-content: space-between; font-size: 13px; }
.oc-date { color: $text-title; font-weight: 600; }
.oc-status { color: $color-primary; }
.oc-body { display: flex; justify-content: space-between; font-size: 12px; color: $text-second; margin-top: 8px; }
.oc-amount { color: #fa5151; font-weight: 700; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
</style>
