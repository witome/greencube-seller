<template>
  <view class="page">
    <!-- 状态筛选 -->
    <scroll-view scroll-x class="chips-row">
      <view v-for="t in tabs" :key="t.value" :class="['chip', { on: filter === t.value }]" @tap="filter = t.value">{{ t.label }}</view>
    </scroll-view>

    <!-- 售后工单 -->
    <view v-for="a in shown" :key="a.aftersaleId" class="as-card">
      <view class="as-head">
        <text class="as-no">售后单 #{{ a.aftersaleId }} · 订单 #{{ a.orderId }}</text>
        <text :class="['as-status', 'st-' + a.status]">{{ a.statusText }}</text>
      </view>

      <view class="as-line">
        <text class="as-item">{{ a.itemName || '—' }}</text>
        <text class="as-type">{{ typeText(a.type) }}</text>
      </view>
      <view class="as-reason">{{ a.reason || '—' }}</view>

      <!-- 现场照片（2026-09-19 卡I）：有照片才渲染，没有照片的行不出现空框；点开看大图 -->
      <view v-if="(a.attachments || []).length" class="photo-grid">
        <view v-for="(p, i) in a.attachments" :key="i" class="photo-item" @tap="viewPhotos(a.attachments, p)">
          <image :src="fullUrl(p)" mode="aspectFill" class="photo-img" />
        </view>
      </view>
      <view v-if="(a.attachments || []).length" class="photo-tip">已上传 {{ a.attachments.length }} 张，点图看大图</view>

      <view class="as-meta">
        <text v-if="a.qtyDiff" class="as-meta-i">数量差 {{ a.qtyDiff }}</text>
        <text v-if="a.amountDiff" class="as-meta-i">金额差 ¥{{ Number(a.amountDiff).toFixed(2) }}</text>
        <text class="as-meta-i">提交 {{ fmtTime(a.createdAt) }}</text>
      </view>

      <!-- 处理结果 -->
      <view v-if="a.status === 2" class="as-result">
        🛡 已解决<text v-if="a.compensateAmount !== null && a.compensateAmount !== undefined"> · 补偿 ¥{{ Number(a.compensateAmount).toFixed(2) }}</text><text v-if="a.compensateMethod">{{ ' · ' + methodText(a.compensateMethod) }}</text>
      </view>
      <view v-else-if="a.status === 3" class="as-result closed">已关闭</view>
      <view v-else class="as-pending">⏳ 运营将在 24 小时内响应</view>

      <view v-if="a.handleRemark" class="as-remark">处理说明：{{ a.handleRemark }}</view>
      <view v-if="a.handledAt" class="as-handled">处理时间 {{ fmtTime(a.handledAt) }}</view>
    </view>

    <view v-if="!shown.length && !loading" class="empty">{{ filter === 'ing' ? '暂无售后中的工单' : '暂无售后记录' }}</view>
    <view v-if="loading" class="empty">加载中…</view>

    <!-- 申请售后 -->
    <view class="apply-bar">
      <view class="pbtn primary" @tap="goApply">申请售后</view>
    </view>

    <CustomTabBar :tabs="buyerTabs" active="/pages/buyer/mine" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { previewPhotos } from '@/utils/photo-upload'
import CustomTabBar from '@/components/CustomTabBar.vue'

const buyerTabs = [
  { path: '/pages/buyer/home', icon: '🏠', label: '首页' },
  { path: '/pages/buyer/goods', icon: '🥬', label: '商品' },
  { path: '/pages/buyer/cart', icon: '🛒', label: '购物车' },
  { path: '/pages/buyer/order-list', icon: '📋', label: '订单' },
  { path: '/pages/buyer/mine', icon: '👤', label: '我的' },
]

// 状态：0 待处理 / 1 处理中 / 2 已解决 / 3 已关闭
// 「售后中」= 未完结（待处理 + 处理中）
const tabs = [
  { label: '全部', value: 'all' },
  { label: '售后中', value: 'ing' },
  { label: '已解决', value: 'done' },
  { label: '已关闭', value: 'closed' },
]

const TYPE_TEXT = { 1: '少货', 2: '品质问题', 3: '错货', 4: '其他' }
const METHOD_TEXT = { 1: '退款', 2: '补货', 3: '下次账单抵扣' }

const list = ref([])
const filter = ref('all')
const loading = ref(false)

const typeText = (t) => TYPE_TEXT[t] || '其他'
const methodText = (m) => METHOD_TEXT[m] || ''

// 点缩略图看大图：预览逻辑复用 utils/photo-upload 的 previewPhotos
// （与上传侧同一套相对路径→绝对地址口径，页面里不重复拼 host）
const viewPhotos = (list, current) => previewPhotos(list, current)

const shown = computed(() => {
  if (filter.value === 'ing') return list.value.filter((a) => a.status === 0 || a.status === 1)
  if (filter.value === 'done') return list.value.filter((a) => a.status === 2)
  if (filter.value === 'closed') return list.value.filter((a) => a.status === 3)
  return list.value
})

const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const load = async () => {
  loading.value = true
  try {
    list.value = (await buyerApi.getAftersaleList()) || []
  } catch (e) {
    list.value = []
  }
  loading.value = false
}

const goApply = () => uni.navigateTo({ url: '/pages/buyer/aftersale' })

onLoad((opts) => {
  if (opts && opts.filter) filter.value = opts.filter
})

onShow(() => {
  load()
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 130px; }
.chips-row { white-space: nowrap; padding: 10px 12px; }
.chip { display: inline-block; padding: 6px 14px; border-radius: 16px; background: #f0f1f3; font-size: 13px; color: $text-second; margin-right: 8px; }
.chip.on { background: $color-primary; color: #fff; }

.as-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.as-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: $text-second; }
.as-status { font-size: 12px; font-weight: 600; }
.st-0 { color: #ff8f1f; }
.st-1 { color: #1989fa; }
.st-2 { color: #00b96b; }
.st-3 { color: $text-placeholder; }
.as-line { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.as-item { font-size: 15px; font-weight: 600; color: $text-title; }
.as-type { font-size: 11px; color: $text-second; background: #f7f8fa; border-radius: 10px; padding: 2px 8px; }
.as-reason { font-size: 13px; color: $text-body; margin-top: 6px; }
/* 照片区样式与申请页 pages/buyer/aftersale.vue 保持同一套尺寸口径（72×72 圆角 8px） */
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.photo-item { width: 72px; height: 72px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; background: $bg-soft; }
.photo-tip { margin-top: 6px; font-size: 11px; color: $text-second; }
.as-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.as-meta-i { font-size: 11px; color: $text-second; }
.as-result { margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: #eafaf1; color: #00b96b; font-size: 12px; }
.as-result.closed { background: #f7f8fa; color: $text-second; }
.as-pending { margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: #fff8ec; color: #ff8f1f; font-size: 12px; }
.as-remark { font-size: 12px; color: $text-second; margin-top: 6px; }
.as-handled { font-size: 11px; color: $text-placeholder; margin-top: 4px; }

.empty { text-align: center; color: $text-placeholder; padding: 40px 0; font-size: 13px; }
.apply-bar { position: fixed; left: 0; right: 0; bottom: 56px; padding: 8px 12px; background: #fff; border-top: 1px solid $bg-soft; }
.pbtn { border-radius: 22px; padding: 11px 0; text-align: center; font-size: 14px; font-weight: 600; }
.pbtn.primary { background: $color-primary; color: #fff; }
</style>
