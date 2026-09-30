<template>
  <view class="page">
    <!-- ==================== 列表（原型 B2） ==================== -->
    <template v-if="view === 'list'">
      <view class="tip blue">
        🛠 仅显示归属「<text class="b">{{ stallName || '本档口' }}</text>」的售后 · 只读，如有异议请联系运营
      </view>

      <scroll-view scroll-x class="chips-row">
        <view v-for="t in tabs" :key="t.value" :class="['chip', { on: filter === t.value }]" @tap="filter = t.value">{{ t.label }}</view>
      </scroll-view>

      <view v-for="a in shown" :key="a.aftersaleId" class="as-card" @tap="openDetail(a)">
        <view class="as-head">
          <text class="as-no">售后单 #{{ a.aftersaleId }} · 订单 #{{ a.orderId }}</text>
          <text :class="['as-status', 'st-' + a.status]">{{ a.statusText }}</text>
        </view>
        <view class="as-line">
          <text class="as-item">{{ a.itemName || '—' }}</text>
          <text class="as-type">{{ a.typeText }}</text>
        </view>
        <view class="as-meta">
          <text v-if="a.orderDeliveryDate" class="as-meta-i">送达 {{ a.orderDeliveryDate }}</text>
          <text class="as-meta-i">差异 {{ a.qtyDiff }}{{ a.unit || '' }}</text>
          <text class="as-meta-i">提交 {{ fmtTime(a.createdAt) }}</text>
        </view>
        <view v-if="a.handleRemark" class="as-result">处理说明：{{ a.handleRemark }}</view>
      </view>

      <view v-if="!shown.length && !loading" class="empty">暂无售后工单</view>
      <view v-if="loading" class="empty">加载中…</view>

      <view class="tip">待处理的会等运营核实；处理完成后在这里看结果。本期<text class="b">没有</text>「申诉 / 驳回」入口。</view>
    </template>

    <!-- ==================== 详情（原型 B3） ==================== -->
    <template v-else>
      <view class="back-link" @tap="view = 'list'">‹ 返回售后列表</view>

      <template v-if="current">
        <view class="card">
          <view class="row-between">
            <text class="no">售后单 #{{ current.aftersaleId }}</text>
            <text :class="['as-status', 'st-' + current.status]">{{ current.statusText }}</text>
          </view>
          <view class="kv"><text class="k">订单号</text><text class="v">{{ current.orderId }}</text></view>
          <view class="kv"><text class="k">送达日期</text><text class="v">{{ current.orderDeliveryDate || '—' }}</text></view>
          <view class="kv"><text class="k">商品</text><text class="v">{{ current.itemName || '—' }}</text></view>
          <view class="kv"><text class="k">类型</text><text class="v">{{ current.typeText }}</text></view>
          <view class="kv">
            <text class="k">差异数量</text>
            <text class="v">{{ current.qtyDiff }}{{ current.unit || '' }}<text v-if="current.qtyReceived !== null && current.qtyReceived !== undefined" class="sub">（收货 {{ current.qtyReceived }}{{ current.unit || '' }}）</text></text>
          </view>
        </view>

        <view class="card">
          <view class="card-title">客户填写的内容</view>
          <view class="reason">{{ current.reason || '—' }}</view>
          <view v-if="(current.attachments || []).length" class="photo-grid">
            <image
              v-for="(p, i) in current.attachments"
              :key="i"
              :src="fullUrl(p)"
              mode="aspectFill"
              class="photo-img"
              @tap="viewPhotos(current.attachments, p)"
            />
          </view>
          <view v-if="(current.attachments || []).length" class="photo-tip">点图片可放大</view>
        </view>

        <view class="card">
          <view class="card-title">运营处理结果</view>
          <template v-if="current.status === 0 || current.status === 1">
            <view class="pending">⏳ 等运营核实处理，处理完成后这里会显示结果</view>
          </template>
          <template v-else>
            <view class="result" :class="{ closed: current.status === 3 }">
              <text v-if="current.handleRemark">处理说明：{{ current.handleRemark }}</text>
              <text v-else>运营已关闭该工单</text>
            </view>
            <view class="kv" style="margin-top:6px">
              <text class="k">补偿</text>
              <text class="v">
                <template v-if="current.compensateAmount !== null && current.compensateAmount !== undefined">¥{{ Number(current.compensateAmount).toFixed(2) }} · {{ methodText(current.compensateMethod) }}（线下给出）</template>
                <template v-else>{{ methodText(current.compensateMethod) }}</template>
              </text>
            </view>
            <view class="kv"><text class="k">处理时间</text><text class="v">{{ fmtTime(current.handledAt) || '—' }}</text></view>
          </template>
        </view>

        <view class="tip orange">
          🟠 对结果有异议请<text class="b">联系运营</text>处理
          <text class="sub-line">本期不提供在线申诉 / 驳回入口</text>
        </view>
        <view class="tip red">
          🔴 本页<text class="b">只读</text>：不影响你的结算单，也不会从你的应付里扣钱
        </view>
      </template>

      <view v-else class="empty">售后单不存在</view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { previewPhotos } from '@/utils/photo-upload'

// 卡AE（2026-09-30）新增页 —— 对应原型 B2（列表）+ B3（详情），按卡要求放在**同一个文件**里：
// 列表 ⇄ 详情用页面内的 view 状态切换（售后是二级页，不带底部导航）。
//
// ⚠️ 页面硬约束（写进交付口径）：
//   · **只读**：本页没有任何写操作（本期不做供应商申诉 / 驳回）
//   · 只显示**归属本档口**的工单 —— 归属由后端经 order_item.supplier_id 反查，
//     未拆单的工单根本不会出现在接口返回里（见 backend supplier.service.myAftersales）
//   · 不影响结算单：本卡不动 Settlement、不新增扣款（页面文案也写死了这点）
const METHOD_TEXT = { 1: '退款', 2: '补货', 3: '下次账单抵扣' }
// 补偿方式为空 = 仅致歉（卡AE 口径：不新增 compensate_method=4）
const METHOD_EMPTY = '仅致歉'

const tabs = [
  { label: '全部', value: 'all' },
  { label: '待处理', value: 'pending' },
  { label: '已解决', value: 'done' },
]

const listData = ref([])
const stallName = ref('')
const pendingCount = ref(0)
const filter = ref('all')
const loading = ref(false)
const view = ref('list')
const current = ref(null)

const shown = computed(() => {
  if (filter.value === 'pending') return listData.value.filter((a) => a.status === 0 || a.status === 1)
  if (filter.value === 'done') return listData.value.filter((a) => a.status === 2)
  return listData.value
})

const methodText = (m) => (m ? METHOD_TEXT[m] || '' : METHOD_EMPTY)
const viewPhotos = (list, cur) => previewPhotos(list, cur)

const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const openDetail = (a) => {
  current.value = a
  view.value = 'detail'
}

const load = async () => {
  loading.value = true
  try {
    const data = await supplierApi.getAftersales()
    listData.value = data?.list || []
    stallName.value = data?.stallName || ''
    pendingCount.value = data?.pendingCount || 0
    // 详情页停留时刷新，保持与最新处理结果一致（找不到则退回列表）
    if (current.value) {
      current.value = listData.value.find((x) => x.aftersaleId === current.value.aftersaleId) || null
      if (!current.value) view.value = 'list'
    }
  } catch (e) {
    listData.value = []
  }
  loading.value = false
}

onShow(load)
</script>

<style lang="scss" scoped>
.page { padding-bottom: 24px; }

.tip { margin: 10px 12px; padding: 8px 10px; border-radius: 8px; background: #f7f8fa; font-size: 11.5px; color: $text-second; line-height: 1.6; }
.tip .b { font-weight: 700; color: $text-title; }
.tip.blue { background: #e8f1ff; color: #2a6bd8; }
.tip.blue .b { color: #1f2329; }
.tip.orange { background: #fff8ec; color: #c87000; }
.tip.red { background: #fdebec; color: #d64550; }
.tip .sub-line { display: block; font-size: 11px; opacity: 0.85; margin-top: 2px; }

.chips-row { white-space: nowrap; padding: 4px 12px 8px; }
.chip { display: inline-block; padding: 6px 14px; border-radius: 16px; background: #f0f1f3; font-size: 13px; color: $text-second; margin-right: 8px; }
.chip.on { background: $color-primary; color: #fff; }

.as-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.as-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: $text-second; }
.as-status { font-size: 12px; font-weight: 600; }
.st-0 { color: #ff8f1f; }
.st-1 { color: #3b7cff; }
.st-2 { color: #00b96b; }
.st-3 { color: $text-placeholder; }
.as-line { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.as-item { font-size: 15px; font-weight: 600; color: $text-title; }
.as-type { font-size: 11px; color: $text-second; background: #f7f8fa; border-radius: 10px; padding: 2px 8px; }
.as-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.as-meta-i { font-size: 11px; color: $text-second; }
.as-result { margin-top: 8px; padding: 8px 10px; border-radius: 6px; background: #eafaf1; color: #00995a; font-size: 12px; line-height: 1.6; }

.back-link { padding: 10px 12px 2px; font-size: 13px; color: $color-primary; }

.card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.card-title { font-size: 14px; font-weight: 700; color: $text-title; margin-bottom: 8px; }
.row-between { display: flex; justify-content: space-between; align-items: center; }
.no { font-size: 15px; font-weight: 800; color: $text-title; }
.kv { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
.k { color: $text-second; }
.v { color: $text-title; }
.v .sub { font-size: 11px; color: $text-second; }
.reason { font-size: 13px; color: $text-body; line-height: 1.6; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; background: $bg-soft; }
.photo-tip { margin-top: 6px; font-size: 11px; color: $text-second; }

.result { padding: 8px 10px; border-radius: 6px; background: #eafaf1; color: #00995a; font-size: 12px; line-height: 1.6; }
.result.closed { background: #f7f8fa; color: $text-second; }
.pending { padding: 8px 10px; border-radius: 6px; background: #fff8ec; color: #ff8f1f; font-size: 12px; }

.empty { text-align: center; color: $text-placeholder; padding: 50px 0; font-size: 13px; }
</style>
