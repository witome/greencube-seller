<template>
  <view class="page">
    <!-- 选择订单 -->
    <view class="card">
      <view class="card-title">选择订单</view>
      <picker :range="orderLabels" @change="onOrderChange">
        <view class="order-picker">📦 {{ selectedOrderLabel || '请选择订单' }} ›</view>
      </picker>
    </view>

    <!-- 问题类型 -->
    <view class="card">
      <view class="card-title">问题类型</view>
      <view class="chip-group">
        <view v-for="t in types" :key="t.value" :class="['chip', { on: form.type === t.value }]" @tap="form.type = t.value">{{ t.label }}</view>
      </view>
    </view>

    <!-- 问题描述 -->
    <view class="card">
      <view class="card-title">问题描述</view>
      <textarea v-model="form.reason" class="textarea" placeholder="请描述问题详情，如：大白菜少送 2 斤" />
      <view class="upload-row" @tap="t('拍照上传（真实场景接 uni.chooseImage）')">📷 拍照上传（验收单 / 实物照片）</view>
    </view>

    <!-- 售后政策 -->
    <view class="notice">🛡 售后政策：签收后 24 小时内可申请；称重商品以验收数量为准，多退少补。</view>

    <view class="row-btns">
      <view class="pbtn primary" @tap="submit">提交申请</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { buyerApi } from '@/api/modules'

const orders = ref([])
const selectedIndex = ref(-1)
const form = ref({ type: 1, reason: '' })

const types = [
  { value: 1, label: '缺货少送' },
  { value: 2, label: '品质问题' },
  { value: 3, label: '送错商品' },
  { value: 4, label: '其他' },
]

const t = (msg) => uni.showToast({ title: msg, icon: 'none' })

const orderLabels = computed(() => orders.value.map((o) => `订单 #${o.orderId} · ${o.deliveryDate} · ${o.itemCount} 项`))
const selectedOrderLabel = computed(() => (selectedIndex.value >= 0 ? orderLabels.value[selectedIndex.value] : ''))

const selectedOrder = computed(() => (selectedIndex.value >= 0 ? orders.value[selectedIndex.value] : null))

const onOrderChange = (e) => {
  selectedIndex.value = Number(e.detail.value)
}

const submit = async () => {
  const order = selectedOrder.value
  if (!order) { uni.showToast({ title: '请选择订单', icon: 'none' }); return }
  if (!form.value.reason.trim()) { uni.showToast({ title: '请填写问题描述', icon: 'none' }); return }

  await buyerApi.submitAftersale({
    orderId: order.orderId,
    type: form.value.type,
    reason: form.value.reason.trim(),
  })
  uni.showToast({ title: '售后申请已提交', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 600)
}

onMounted(async () => {
  try {
    const data = await buyerApi.getOrderList({ page: 1, pageSize: 20 })
    // 仅展示可售后的订单（已送达/已完成/已结算）
    orders.value = (data.list || []).filter((o) => [60, 70, 90].includes(o.status))
  } catch (e) { /* 忽略 */ }
})
</script>

<style lang="scss" scoped>
.order-picker { padding: 10px 0; font-size: 14px; color: $color-primary; }
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 7px 14px; border-radius: 16px; background: $bg-soft; font-size: 13px; color: $text-second; }
.chip.on { background: $brand-soft; color: $brand-deep; font-weight: 600; }
.textarea { width: 100%; min-height: 80px; background: $bg-soft; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-top: 8px; }
.upload-row { margin-top: 10px; font-size: 13px; color: $text-second; }
.notice { background: #fff8ec; color: #ff8f1f; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 12px; }
</style>
