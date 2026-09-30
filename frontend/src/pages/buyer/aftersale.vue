<template>
  <view class="page">
    <!-- ① 选择商品（卡AE 新增 · 必选） -->
    <view class="card">
      <view class="card-title">选择订单</view>
      <picker :range="orderLabels" @change="onOrderChange">
        <view class="order-picker">📦 {{ selectedOrderLabel || '请选择订单' }} ›</view>
      </picker>

      <view class="card-title" style="margin-top:10px">
        ① 选择商品 <text class="req">*必选</text>
      </view>
      <view v-if="loadingItems" class="hint">加载商品明细中…</view>
      <view v-else-if="!items.length" class="hint">该订单没有可申请售后的商品</view>
      <view v-else>
        <view
          v-for="it in items"
          :key="it.orderItemId"
          :class="['pick-row', { on: form.orderItemId === it.orderItemId }]"
          @tap="pickItem(it)"
        >
          <view class="rd"></view>
          <view class="pick-main">
            <text class="b">{{ it.name }}</text>
            <text class="e">订 {{ it.qtyOrdered }}{{ it.unit || '' }}<text v-if="it.qtyDeclared !== null"> · 交 {{ it.qtyDeclared }}</text><text v-if="it.qtyAccepted !== null"> · 验 {{ it.qtyAccepted }}</text><text v-if="it.qtyReceived !== null"> · 收 {{ it.qtyReceived }}</text></text>
          </view>
        </view>
      </view>
    </view>

    <!-- ② 涉及数量（卡AE 新增） -->
    <view class="card">
      <view class="card-title">② 涉及数量 <text class="req">*必填</text></view>
      <view class="stepper">
        <view class="st-btn" @tap="decQty">−</view>
        <text class="st-num">{{ form.qtyDiff }}</text>
        <view class="st-btn" @tap="incQty">＋</view>
        <text class="st-unit">{{ selectedItem ? selectedItem.unit : '' }}</text>
      </view>
      <view class="hint">不能超过本次收货数量（最多 {{ maxQty }} {{ selectedItem ? selectedItem.unit : '' }}）</view>
    </view>

    <!-- ③ 问题类型 -->
    <view class="card">
      <view class="card-title">③ 问题类型</view>
      <view class="chip-group">
        <view v-for="t in types" :key="t.value" :class="['chip', { on: form.type === t.value }]" @tap="form.type = t.value">{{ t.label }}</view>
      </view>
      <view class="hint" :class="{ red: form.type === 2 }">选「品质问题」时<text class="b">必须上传照片</text>，否则提交按钮不可点</view>
    </view>

    <!-- ④ 问题描述 + 照片 -->
    <view class="card">
      <view class="card-title">④ 问题描述 + 照片</view>
      <textarea v-model="form.reason" class="textarea" placeholder="请描述问题详情，如：大白菜少送 2 斤" />
      <view :class="['upload-row', { disabled: uploading }]" @tap="takePhoto">
        {{ uploading ? '⏳ 上传中…' : '📷 拍照上传（最多 6 张）' }}
      </view>
      <view v-if="photos.length" class="photo-grid">
        <view v-for="(p, i) in photos" :key="i" class="photo-item">
          <image :src="fullUrl(p)" mode="aspectFill" class="photo-img" @tap="previewPhotos(photos, p)" />
          <view class="photo-del" @tap.stop="removePhoto(i)">✕</view>
        </view>
      </view>
      <view v-if="photos.length" class="photo-tip">已上传 {{ photos.length }}/{{ MAX_PHOTOS }} 张，点图片可放大，点 ✕ 删除</view>
    </view>

    <!-- 售后政策（现有两句 24 小时文案保留不动，与新口径一致） -->
    <view class="notice red">
      🔴 提交后由运营<text class="b">线下</text>处理：<text class="b">不会自动退款</text>，也不影响订单金额与状态
      <text class="notice-sub">🛡 签收后 24 小时内可申请；数量以「交 / 收 数量」为准</text>
    </view>

    <view class="row-btns">
      <view class="pbtn primary" :class="{ disabled: !canSubmit }" @tap="submit">提交申请</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { pickPhotos, uploadPhoto, previewPhotos, MAX_PHOTOS, remainCount } from '@/utils/photo-upload'

const orders = ref([])
const selectedIndex = ref(-1)
const prefetchedOrderId = ref('')
const items = ref([])
const loadingItems = ref(false)
// 卡AE：涉及数量 = 客户填报的「涉及数量」，与 form.orderItemId 一起构成售后工单的落库口径
const form = ref({ orderItemId: null, type: 1, reason: '', qtyDiff: 1 })

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
const selectedItem = computed(() => items.value.find((it) => it.orderItemId === form.value.orderItemId) || null)

// 涉及数量上限 = 该明细的「收货数量」（为空时退回验收数量，再为空退回订购数量）
// ⚠️ 与后端 buyer.service.submitAftersale 的上限口径一致：qtyReceived → qtyAccepted
//   （后端的 qtyOrdered 兜底只是前端可用性考虑，真正的门槛在后端）
const maxQty = computed(() => {
  const it = selectedItem.value
  if (!it) return 0
  const cap = it.qtyReceived !== null && it.qtyReceived !== undefined
    ? Number(it.qtyReceived)
    : it.qtyAccepted !== null && it.qtyAccepted !== undefined
      ? Number(it.qtyAccepted)
      : Number(it.qtyOrdered || 0)
  return cap > 0 ? cap : 0
})

// 品质问题（type=2）必须至少有 1 张照片（口径 6c/6e；后端也会真校验）
const needPhoto = computed(() => form.value.type === 2)
const canSubmit = computed(() => !!selectedItem.value && !uploading.value && form.value.qtyDiff > 0 && (!needPhoto.value || photos.value.length > 0))

/** 载入某订单的商品明细；单选订单只有一个商品时自动选中（少一步点击） */
const loadItems = async (orderId) => {
  loadingItems.value = true
  try {
    const detail = await buyerApi.getOrderDetail(orderId)
    items.value = detail?.items || []
    if (items.value.length === 1) pickItem(items.value[0])
    else resetItem()
  } catch (e) {
    items.value = []
  }
  loadingItems.value = false
}

const resetItem = () => {
  form.value.orderItemId = null
  form.value.qtyDiff = 1
}

const pickItem = (it) => {
  if (form.value.orderItemId === it.orderItemId) return
  form.value.orderItemId = it.orderItemId
  // 切换商品后数量回到 1，避免把上一个商品的数量带过去（可能超上限）
  form.value.qtyDiff = 1
}

const onOrderChange = (e) => {
  selectedIndex.value = Number(e.detail.value)
  resetItem()
  const order = selectedOrder.value
  if (order) loadItems(order.orderId)
}

const incQty = () => {
  if (form.value.qtyDiff >= maxQty.value) {
    uni.showToast({ title: `不能超过收货数量（${maxQty.value}）`, icon: 'none' })
    return
  }
  form.value.qtyDiff += 1
}
const decQty = () => { if (form.value.qtyDiff > 1) form.value.qtyDiff -= 1 }

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
  if (!selectedItem.value) { uni.showToast({ title: '请选择要申请售后的商品', icon: 'none' }); return }
  if (!form.value.qtyDiff || form.value.qtyDiff <= 0) { uni.showToast({ title: '请填写涉及数量', icon: 'none' }); return }
  if (form.value.qtyDiff > maxQty.value) { uni.showToast({ title: `涉及数量不能超过 ${maxQty.value}`, icon: 'none' }); return }
  if (!form.value.reason.trim()) { uni.showToast({ title: '请填写问题描述', icon: 'none' }); return }
  // 品质问题必须传照片（前端拦一道，后端也会真校验）
  if (needPhoto.value && !photos.value.length) { uni.showToast({ title: '品质问题必须上传照片', icon: 'none' }); return }

  await buyerApi.submitAftersale({
    orderId: order.orderId,
    // 卡AE：必须选到具体商品；订单号由后端按该明细反查，前端传的 orderId 只作兼容
    orderItemId: form.value.orderItemId,
    type: form.value.type,
    reason: form.value.reason.trim(),
    // 卡AE：客户填报的「涉及数量」（不再让前端传差异金额，后端按 qtyDiff × 成交价算）
    qtyDiff: form.value.qtyDiff,
    // 照片 URL 数组（可选：不拍照则不传字段；品质问题必传）
    ...(photos.value.length ? { attachments: photos.value } : {}),
  })
  uni.showToast({ title: '售后申请已提交', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 600)
}

// 仅展示可售后的订单（已送达 / 已完成 / 已结算）—— 后端另有三道门槛真校验
const ALLOWED = [60, 70, 90]

const initOrderFrom = async (orderId) => {
  const idx = orders.value.findIndex((o) => Number(o.orderId) === Number(orderId))
  if (idx < 0) return
  selectedIndex.value = idx
  await loadItems(orders.value[idx].orderId)
}

onLoad((opts) => {
  // 从订单详情商品行的「申请售后」进来会带 orderId → 自动选中该订单并载入商品
  prefetchedOrderId.value = opts && opts.orderId ? String(opts.orderId) : ''
})

onMounted(async () => {
  try {
    const data = await buyerApi.getOrderList({ page: 1, pageSize: 20 })
    orders.value = (data.list || []).filter((o) => ALLOWED.includes(o.status))
  } catch (e) { /* 忽略 */ }
  if (prefetchedOrderId.value) await initOrderFrom(prefetchedOrderId.value)
})
</script>

<style lang="scss" scoped>
.order-picker { padding: 10px 0; font-size: 14px; color: $color-primary; }
.req { font-size: 11px; color: #fa5151; font-weight: 600; }
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 7px 14px; border-radius: 16px; background: $bg-soft; font-size: 13px; color: $text-second; }
.chip.on { background: $brand-soft; color: $brand-deep; font-weight: 600; }

/* 商品单选行（照原型 A2 的 pick-row：圆圈 + 商品名 + 订/交/收 数量） */
.pick-row { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 8px; border: 1px solid #edeef0; margin-bottom: 6px; }
.pick-row.on { border-color: $color-primary; background: #f4fff8; }
.pick-row .rd { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid #c9d2da; flex: 0 0 auto; }
.pick-row.on .rd { border: 4px solid $color-primary; }
.pick-main { flex: 1; }
.pick-main .b { font-size: 13px; font-weight: 700; color: $text-title; display: block; }
.pick-main .e { font-size: 11px; color: $text-second; display: block; margin-top: 2px; }

.stepper { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.st-btn { width: 26px; height: 26px; border-radius: 6px; background: $bg-soft; text-align: center; line-height: 26px; font-size: 15px; color: $text-body; }
.st-num { font-size: 15px; font-weight: 700; min-width: 34px; text-align: center; }
.st-unit { font-size: 12px; color: $text-second; }

.textarea { width: 100%; min-height: 80px; background: $bg-soft; border-radius: 8px; padding: 10px 12px; font-size: 13px; margin-top: 8px; }
.upload-row { margin-top: 10px; font-size: 13px; color: $text-second; }
.upload-row.disabled { opacity: 0.5; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.photo-item { position: relative; width: 72px; height: 72px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; background: $bg-soft; }
.photo-del { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #fa5151; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.photo-tip { margin-top: 6px; font-size: 11px; color: $text-second; }

.hint { margin-top: 6px; font-size: 11px; color: $text-second; line-height: 1.5; }
.hint.red { color: #fa5151; font-weight: 600; }
.hint .b { font-weight: 700; }

.notice { background: #fff8ec; color: #ff8f1f; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 12px; line-height: 1.6; }
.notice.red { background: #fdebec; color: #d64550; }
.notice .b { font-weight: 700; }
.notice-sub { display: block; margin-top: 4px; font-size: 11px; opacity: 0.85; }
.disabled { opacity: 0.5; }
</style>
