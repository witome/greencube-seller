<template>
  <view class="page">
    <!-- 月份选择 -->
    <picker mode="date" fields="month" :value="period" @change="onPeriodChange">
      <view class="period-picker">{{ periodLabel }} · 切换月份 ▾</view>
    </picker>

    <!-- 汇总 -->
    <view v-if="bill" class="stat-row">
      <view class="stat-chip">
        <view class="num">¥{{ bill.grossAmount }}</view>
        <view class="lbl">本月应付</view>
      </view>
      <view class="stat-chip">
        <view class="num green">¥{{ bill.paidAmount }}</view>
        <view class="lbl">已支付</view>
      </view>
      <view class="stat-chip">
        <view class="num red">¥{{ bill.unpaidAmount }}</view>
        <view class="lbl">未支付</view>
      </view>
    </view>

    <!-- 明细 -->
    <view class="section-title">账单明细（{{ bill ? bill.orderCount : 0 }}）</view>
    <view v-for="o in (bill && bill.orders) || []" :key="o.orderId" class="list-item" @tap="goOrder(o.orderId)">
      <view class="li-ico" style="background:#E8F1FF;">📦</view>
      <view class="li-main">
        <view class="li-t">订单 #{{ o.orderId }}</view>
        <view class="li-d">{{ o.deliveryDate }} · {{ o.itemCount }} 项 · {{ o.statusText }}</view>
      </view>
      <view class="li-right">
        <view class="amount">{{ o.amountFinal != null ? '¥' + o.amountFinal : '待称重' }}</view>
        <view :class="['tag', o.status === 90 ? 'g' : 'o']">{{ o.status === 90 ? '已付' : '未付' }}</view>
      </view>
    </view>
    <view v-if="bill && !bill.orders.length" class="empty">该月暂无订单</view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { buyerApi } from '@/api/modules'

const period = ref(new Date().toISOString().slice(0, 7))
const bill = ref(null)

const periodLabel = computed(() => {
  const [y, m] = period.value.split('-')
  return `${y} 年 ${Number(m)} 月`
})

const goOrder = (orderId) => uni.navigateTo({ url: `/pages/buyer/order-detail?id=${orderId}` })

const load = async () => {
  try {
    bill.value = await buyerApi.getBill(period.value)
  } catch (e) {
    bill.value = null
  }
}

const onPeriodChange = (e) => {
  period.value = e.detail.value
  load()
}

onMounted(load)
</script>

<style lang="scss" scoped>
.period-picker { text-align: center; padding: 12px; font-size: 15px; font-weight: 600; color: $color-primary; }
.stat-row { display: flex; gap: 8px; margin: 0 12px 12px; }
.stat-chip { flex: 1; background: #fff; border-radius: 12px; padding: 14px 4px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.04); }
.num { font-size: 17px; font-weight: 800; }
.num.green { color: #00b96b; }
.num.red { color: #fa5151; }
.lbl { font-size: 11px; color: $text-second; margin-top: 3px; }
.li-right { text-align: right; }
.amount { font-size: 14px; font-weight: 700; color: $text-title; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }
</style>
