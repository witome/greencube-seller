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
      <view :class="['upload-row', { disabled: uploading }]" @tap="takePhoto">
        {{ uploading ? '⏳ 上传中…' : '📷 拍照上传（验收单 / 实物照片）' }}
      </view>
      <view v-if="photos.length" class="photo-grid">
        <view v-for="(p, i) in photos" :key="i" class="photo-item">
          <image :src="fullUrl(p)" mode="aspectFill" class="photo-img" @tap="previewPhotos(photos, p)" />
          <view class="photo-del" @tap.stop="removePhoto(i)">✕</view>
        </view>
      </view>
      <view v-if="photos.length" class="photo-tip">已上传 {{ photos.length }}/{{ MAX_PHOTOS }} 张，点图片可放大，点 ✕ 删除</view>
    </view>

    <!-- 售后政策 -->
    <view class="notice">🛡 售后政策：签收后 24 小时内可申请；称重商品以验收数量为准，多退少补。</view>

    <view class="row-btns">
      <view class="pbtn primary" :class="{ disabled: uploading }" @tap="submit">提交申请</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { buyerApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { pickPhotos, uploadPhoto, previewPhotos, MAX_PHOTOS, remainCount } from '@/utils/photo-upload'

const orders = ref([])
const selectedIndex = ref(-1)
const form = ref({ type: 1, reason: '' })

// 已上传照片的可访问 URL（/uploads/xxx）；提交时随表单带上
const photos = ref([])
const uploading = ref(false)

const types = [
  { value: 1, label: '缺货少送' },
  { value: 2, label: '品质问题' },
  { value: 3, label: '送错商品' },
  { value: 4, label: '其他' },
]

const orderLabels = computed(() => orders.value.map((o) => `订单 #${o.orderId} · ${o.deliveryDate} · ${o.itemCount} 项`))
const selectedOrderLabel = computed(() => (selectedIndex.value >= 0 ? orderLabels.value[selectedIndex.value] : ''))

const selectedOrder = computed(() => (selectedIndex.value >= 0 ? orders.value[selectedIndex.value] : null))

const onOrderChange = (e) => {
  selectedIndex.value = Number(e.detail.value)
}

// 拍照上传（2026-09-19 决策⑦）：可多张、可删、有缩略图、上传中有提示、失败有明确提示。
// 压缩复用 utils/image-compress（经 utils/photo-upload 封装），此处不重复实现压缩。
const takePhoto = async () => {
  if (uploading.value) return
  const remain = remainCount(photos.value)
  if (remain <= 0) { uni.showToast({ title: `最多上传 ${MAX_PHOTOS} 张`, icon: 'none' }); return }

  let paths = []
  try {
    paths = await pickPhotos({ count: remain })
  } catch (e) {
    return // 用户取消，静默返回
  }
  if (!paths.length) return

  uploading.value = true
  let failed = 0
  uni.showLoading({ title: `上传中 1/${paths.length}`, mask: true })
  try {
    for (let i = 0; i < paths.length; i++) {
      uni.showLoading({ title: `上传中 ${i + 1}/${paths.length}`, mask: true })
      try {
        photos.value.push(await uploadPhoto(paths[i]))
      } catch (e) {
        // 业务错误（含「图片过大」）request 层已弹过同文案提示，这里只计数汇总
        failed++
      }
    }
  } finally {
    uni.hideLoading()
    uploading.value = false
  }
  if (failed) uni.showToast({ title: `${failed} 张上传失败，请重试`, icon: 'none' })
}

const removePhoto = (i) => photos.value.splice(i, 1)

const submit = async () => {
  if (uploading.value) { uni.showToast({ title: '照片上传中，请稍候', icon: 'none' }); return }
  const order = selectedOrder.value
  if (!order) { uni.showToast({ title: '请选择订单', icon: 'none' }); return }
  if (!form.value.reason.trim()) { uni.showToast({ title: '请填写问题描述', icon: 'none' }); return }

  await buyerApi.submitAftersale({
    orderId: order.orderId,
    type: form.value.type,
    reason: form.value.reason.trim(),
    // 照片 URL 数组（可选：不拍照则不传字段）
    ...(photos.value.length ? { attachments: photos.value } : {}),
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
.upload-row.disabled { opacity: 0.5; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.photo-item { position: relative; width: 72px; height: 72px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; background: $bg-soft; }
.photo-del { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #fa5151; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.photo-tip { margin-top: 6px; font-size: 11px; color: $text-second; }
.notice { background: #fff8ec; color: #ff8f1f; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 12px; }
.disabled { opacity: 0.5; }
</style>
