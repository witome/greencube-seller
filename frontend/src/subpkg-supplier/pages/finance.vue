<template>
  <view class="page">
    <!-- 期数选择 -->
    <picker mode="date" fields="month" :value="period" @change="onPeriodChange">
      <view class="period-picker">📅 {{ period }} ▾</view>
    </picker>

    <view v-if="settlement" class="card">
      <view class="card-title">结算单 · {{ settlement.period }}</view>
      <view class="settle-row"><text>供货金额</text><text>¥{{ settlement.grossAmount }}</text></view>
      <view class="settle-row"><text>平台服务费（{{ (settlement.serviceFeeRate * 100).toFixed(1) }}%）</text><text class="fee">-¥{{ settlement.serviceFee }}</text></view>
      <view class="settle-row total"><text>应付金额</text><text class="net">¥{{ settlement.netAmount }}</text></view>
      <view class="status">状态：{{ settlement.statusText }}</view>
    </view>

    <!-- 明细 -->
    <view class="card" v-if="settlement && settlement.items.length">
      <view class="card-title">供货明细</view>
      <view v-for="(it, idx) in settlement.items" :key="idx" class="si">
        <text>{{ it.productName }}</text>
        <text>{{ it.qtyAccepted }}{{ it.unit }} × ¥{{ it.supplyPrice }} = ¥{{ it.subtotal }}</text>
      </view>
    </view>

    <view v-if="!settlement" class="empty">该期暂无结算单（需运营在后台生成）</view>

    <CustomTabBar :tabs="supplierTabs" active="/subpkg-supplier/pages/finance" />
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
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

onShow(() => {
})

const period = ref(new Date().toISOString().slice(0, 7))
const settlement = ref(null)

const load = async () => {
  try {
    settlement.value = await supplierApi.getSettlement(period.value)
  } catch (e) {
    settlement.value = null
  }
}

const onPeriodChange = (e) => { period.value = e.detail.value; load() }

onMounted(load)
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; padding-bottom: calc(70px + env(safe-area-inset-bottom)); padding-bottom: calc(70px + var(--ctb-safe-final, env(safe-area-inset-bottom))); } /* 卡BF: 三重声明，env 失效时由 CustomTabBar 写入的 --ctb-safe-final 兜底 */
.period-picker { text-align: center; padding: 10px; font-size: 15px; font-weight: 600; color: $color-primary; }
.settle-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: $text-title; }
.settle-row .fee { color: #ff8f1f; }
.settle-row.total { border-top: 1px solid #f0f1f3; margin-top: 6px; padding-top: 12px; font-weight: 700; }
.settle-row .net { color: #00b96b; font-size: 18px; font-weight: 700; }
.status { font-size: 12px; color: $text-second; margin-top: 6px; }
.si { display: flex; justify-content: space-between; font-size: 12px; color: $text-second; padding: 4px 0; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }
</style>
