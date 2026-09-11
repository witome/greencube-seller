<template>
  <div class="admin-payments-page">
    <!-- 面包屑 -->
    <div class="admin-payments-crumb">资金结算 / 支付流水（仅线上支付）</div>

    <!-- 口径提示（必须保留：本表只记线上支付，COD 不在此表） -->
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="admin-payments-notice"
      title="本页仅统计「线上支付」流水；货到付款（COD）收款不在此表，请在「订单履约」页查看。"
    />

    <!-- 筛选 -->
    <el-card shadow="never" class="admin-payments-filter-card">
      <div class="admin-payments-filter">
        <el-radio-group v-model="statusFilter" @change="reload">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="0">待支付</el-radio-button>
          <el-radio-button :value="1">成功</el-radio-button>
          <el-radio-button :value="2">关闭</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          placeholder="搜索单号 / 订单号"
          clearable
          style="width: 220px; margin-left: 16px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-button type="primary" style="margin-left: 12px" @click="reload">查询</el-button>
      </div>
    </el-card>

    <!-- 列表（默认按创建时间倒序，后端已排序） -->
    <el-card shadow="never" class="admin-payments-table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="payNo" label="单号" min-width="220" show-overflow-tooltip />
        <el-table-column prop="orderId" label="订单号" width="90" />
        <el-table-column prop="shopName" label="餐馆" min-width="140" show-overflow-tooltip />
        <el-table-column label="渠道" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.channel === 'mock' ? 'info' : 'success'">
              {{ channelText(row.channel) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }">¥{{ row.amount }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="支付时间" width="170">
          <template #default="{ row }">{{ row.paidAt ? fmtTime(row.paidAt) : '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        style="margin-top: 16px; justify-content: flex-end"
        @current-change="load"
      />
    </el-card>

    <!-- 详情抽屉（只读） -->
    <el-drawer v-model="detailVisible" title="支付流水详情" size="480px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="单号">{{ detail.payNo }}</el-descriptions-item>
          <el-descriptions-item label="关联订单号">{{ detail.orderId }}</el-descriptions-item>
          <el-descriptions-item label="餐馆">{{ detail.shopName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="渠道">{{ channelText(detail.channel) }}</el-descriptions-item>
          <el-descriptions-item label="金额">¥{{ detail.amount }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(detail.status)" size="small">{{ detail.statusText }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ fmtTime(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="支付时间">{{ detail.paidAt ? fmtTime(detail.paidAt) : '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="admin-payments-sub-title">回调原文（留痕，只读）</div>
        <pre v-if="detail.callbackPayload" class="admin-payments-payload">{{ prettyPayload(detail.callbackPayload) }}</pre>
        <el-empty v-else description="暂无回调记录（待支付或尚未收到回调）" :image-size="60" />

        <div class="admin-payments-tip">
          本页为只读视图；本卡不含退款、关闭支付单等操作。
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { paymentAdminApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const statusFilter = ref('')
const keyword = ref('')

const detailVisible = ref(false)
const detail = ref(null)

function reload() {
  page.value = 1
  load()
}

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (statusFilter.value !== '') params.status = statusFilter.value
    if (keyword.value) params.keyword = keyword.value.trim()
    // 注意：request 拦截器已解包 { code, msg, data }，这里直接取 data.list / data.total
    const data = await paymentAdminApi.getList(params)
    list.value = data.list || []
    total.value = data.total || 0
  } finally {
    loading.value = false
  }
}

function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

function statusTagType(s) {
  if (s === 0) return 'warning'
  if (s === 1) return 'success'
  return 'info'
}

function channelText(channel) {
  if (channel === 'mock') return '模拟通道'
  if (channel === 'wechat') return '微信支付'
  return channel || '-'
}

function prettyPayload(payload) {
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function fmtTime(s) {
  if (!s) return '-'
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<style scoped>
.admin-payments-page { padding: 0; }
.admin-payments-crumb { font-size: 13px; color: #909399; margin-bottom: 16px; }
.admin-payments-notice { margin-bottom: 16px; }
.admin-payments-filter-card { margin-bottom: 16px; }
.admin-payments-filter { display: flex; align-items: center; }
.admin-payments-table-card { margin-bottom: 24px; }
.admin-payments-sub-title { font-size: 14px; font-weight: 600; margin: 16px 0 8px; color: #303133; }
.admin-payments-payload {
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: #303133;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.admin-payments-tip { margin-top: 16px; font-size: 12px; color: #909399; }
</style>
