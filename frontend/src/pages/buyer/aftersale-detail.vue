<template>
  <view class="page">
    <template v-if="a">
      <!-- 基本信息 -->
      <view class="card">
        <view class="row-between">
          <text class="no">售后单 #{{ a.aftersaleId }}</text>
          <text :class="['tag', 'st-' + tierOf(a.status)]">{{ tierText(a.status) }}</text>
        </view>
        <view class="kv"><text class="k">关联订单</text><text class="v">{{ a.orderId }}</text></view>
        <view class="kv"><text class="k">商品</text><text class="v">{{ a.itemName || '—' }}</text></view>
        <view class="kv"><text class="k">供应商</text><text class="v sup">{{ supplierText(a) }}</text></view>
        <view class="kv"><text class="k">问题类型</text><text class="v">{{ typeText(a.type) }}</text></view>
        <view class="kv"><text class="k">涉及数量</text><text class="v">{{ a.qtyDiff }}</text></view>
      </view>

      <!-- 我提交的内容 -->
      <view class="card">
        <view class="card-title">我提交的内容</view>
        <view class="reason">{{ a.reason || '—' }}</view>
        <view v-if="(a.attachments || []).length" class="photo-grid">
          <image
            v-for="(p, i) in a.attachments"
            :key="i"
            :src="fullUrl(p)"
            mode="aspectFill"
            class="photo-img"
            @tap="viewPhotos(a.attachments, p)"
          />
        </view>
      </view>

      <!-- 处理时间线：提交 → 处理完成（handledAt 还没落时只画第一个节点） -->
      <view class="card">
        <view class="card-title">处理时间线</view>
        <view class="tl-row">
          <view class="dot gray"></view>
          <view class="c">
            <text class="b">你提交售后申请</text>
            <text class="e">{{ fmtTime(a.createdAt) }} · 涉及 {{ a.itemName || '商品' }} {{ a.qtyDiff }}（{{ typeText(a.type) }}）</text>
          </view>
        </view>
        <view v-if="a.handledAt" class="tl-row">
          <view class="dot"></view>
          <view class="c">
            <text class="b">运营处理完成</text>
            <text class="e">{{ fmtTime(a.handledAt) }}</text>
          </view>
        </view>
      </view>

      <!-- 处理结果 -->
      <view class="card">
        <view class="card-title">处理结果</view>
        <template v-if="tierOf(a.status) === 0">
          <view class="pending">⏳ 已提交，运营会联系你</view>
        </template>
        <template v-else>
          <view class="result" :class="{ closed: tierOf(a.status) === 3 }">
            <text v-if="a.handleRemark">处理说明：{{ a.handleRemark }}</text>
            <text v-else>运营已关闭该工单，有疑问请联系运营</text>
          </view>
          <view class="kv" style="margin-top:6px">
            <text class="k">补偿</text>
            <text class="v">
              <template v-if="a.compensateAmount !== null && a.compensateAmount !== undefined">¥{{ Number(a.compensateAmount).toFixed(2) }} · {{ methodText(a.compensateMethod) }}（线下给出）</template>
              <template v-else>{{ methodText(a.compensateMethod) }}</template>
            </text>
          </view>
        </template>
      </view>

      <view class="notice">🔴 补偿为<text class="b">线下</text>给出，系统仅记录：<text class="b">不会自动退款</text>，订单金额与状态不变</view>
    </template>

    <view v-else-if="loaded" class="empty">售后单不存在或已不可查看</view>
    <view v-else class="empty">加载中…</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { previewPhotos } from '@/utils/photo-upload'

// 卡AE（2026-09-30）新增页 —— 对应原型 A3-b「我的售后（详情）」。
// ⚠️ 复用 GET /buyer/aftersale（不新增后端接口）：进页时按 id 从列表里取这一条。
const TYPE_TEXT = { 1: '少货', 2: '品质问题', 3: '错货', 4: '其他' }
const METHOD_TEXT = { 1: '退款', 2: '补货', 3: '下次账单抵扣' }
// 补偿方式为空 = 仅致歉（卡AE 口径：不新增 compensate_method=4）
const METHOD_EMPTY = '仅致歉'

// 卡AE 口径 6i：客户侧只显示三档（待处理 / 已解决 / 已关闭），status=1 归入待处理
const tierOf = (s) => (s === 2 ? 2 : s === 3 ? 3 : 0)
const tierText = (s) => ({ 0: '待处理', 2: '已解决', 3: '已关闭' }[tierOf(s)])

const a = ref(null)
const loaded = ref(false)

const typeText = (t) => TYPE_TEXT[t] || '其他'
const methodText = (m) => (m ? METHOD_TEXT[m] || '' : METHOD_EMPTY)
const supplierText = (x) => x.supplierText || x.supplierName || '待分派'

const viewPhotos = (list, current) => previewPhotos(list, current)

const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

onLoad(async (opts) => {
  const id = Number(opts && opts.id)
  try {
    const list = (await buyerApi.getAftersaleList()) || []
    a.value = list.find((x) => Number(x.aftersaleId) === id) || null
  } catch (e) {
    a.value = null
  }
  loaded.value = true
})
</script>

<style lang="scss" scoped>
.page { padding: 12px 0 30px; }
.card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.card-title { font-size: 14px; font-weight: 700; color: $text-title; margin-bottom: 8px; }
.row-between { display: flex; justify-content: space-between; align-items: center; }
.no { font-size: 15px; font-weight: 800; color: $text-title; }
.tag { font-size: 12px; font-weight: 600; }
.st-0 { color: #ff8f1f; }
.st-2 { color: #00b96b; }
.st-3 { color: $text-placeholder; }
.kv { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
.k { color: $text-second; }
.v { color: $text-title; }
.v.sup { color: #2a6bd8; font-weight: 600; }
.reason { font-size: 13px; color: $text-body; line-height: 1.6; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; background: $bg-soft; }

.tl-row { display: flex; gap: 10px; padding: 5px 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: $color-primary; margin-top: 5px; flex: 0 0 auto; }
.dot.gray { background: #d5dae0; }
.c .b { display: block; font-size: 13px; color: $text-title; font-weight: 600; }
.c .e { font-size: 11px; color: $text-second; }

.result { padding: 8px 10px; border-radius: 6px; background: #eafaf1; color: #00995a; font-size: 12px; line-height: 1.6; }
.result.closed { background: #f7f8fa; color: $text-second; }
.pending { padding: 8px 10px; border-radius: 6px; background: #fff8ec; color: #ff8f1f; font-size: 12px; }

.notice { background: #fdebec; color: #d64550; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 12px; line-height: 1.6; }
.notice .b { font-weight: 700; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }
</style>
