<template>
  <div class="admin-dailyrec-page">
    <!-- 面包屑 -->
    <div class="admin-dailyrec-crumb">资金结算 / 每日对账</div>

    <!-- 日期选择 -->
    <el-card shadow="never" class="admin-dailyrec-filter-card">
      <div class="admin-dailyrec-filter">
        <span class="admin-dailyrec-filter-lbl">对账日期（按送达日）</span>
        <el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          style="width: 160px"
          @change="load"
        />
        <el-button type="primary" style="margin-left: 12px" :loading="loading" @click="load">查询</el-button>
        <el-button @click="shiftDay(-1)">前一天</el-button>
        <el-button @click="shiftDay(1)">后一天</el-button>
        <span class="admin-dailyrec-filter-tip">口径：今天送的货，今天该收的钱（只统计已送达/已完成的订单）</span>
      </div>
    </el-card>

    <!-- 五张汇总卡 -->
    <div class="admin-dailyrec-cards">
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">应收</div>
        <div class="admin-dailyrec-card-num">¥{{ fmt(data?.summary?.receivable) }}</div>
        <div class="admin-dailyrec-card-sub">{{ data?.summary?.orderCount ?? 0 }} 单（已送达/已完成）</div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">实收</div>
        <div class="admin-dailyrec-card-num admin-dailyrec-num-green">¥{{ fmt(data?.summary?.received) }}</div>
        <div class="admin-dailyrec-card-sub">微信已付 {{ data?.summary?.wechatPaidCount ?? 0 }} 单 · COD 已收 {{ data?.summary?.codPaidCount ?? 0 }} 单</div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">未收</div>
        <div class="admin-dailyrec-card-num admin-dailyrec-num-red">¥{{ fmt(data?.summary?.unpaid) }}</div>
        <div class="admin-dailyrec-card-sub">COD 未收 {{ data?.summary?.codUnpaidCount ?? 0 }} 单</div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">应付供应商（参考值）</div>
        <div class="admin-dailyrec-card-num">¥{{ fmt(data?.summary?.supplierPayable) }}</div>
        <div class="admin-dailyrec-card-sub">Σ 验收数量 × 供货价 · 正式结算仍按月</div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">毛利粗算</div>
        <div class="admin-dailyrec-card-num" :class="(data?.summary?.grossProfit ?? 0) >= 0 ? 'admin-dailyrec-num-green' : 'admin-dailyrec-num-red'">
          ¥{{ fmt(data?.summary?.grossProfit) }}
        </div>
        <div class="admin-dailyrec-card-sub">实收 − 应付供应商参考值</div>
      </div>
    </div>

    <!-- 口径说明 -->
    <el-alert type="info" :closable="false" show-icon class="admin-dailyrec-notice"
      title="口径说明：应收 = amountFinal（未核单时回退 amountOrdered + 运费）；实收 = 微信已支付流水 + 货到付款有收款凭证的订单；应付供应商与毛利为参考值，正式结算以按月结算单为准。"
    />

    <!-- 未收款清单（最重要） -->
    <el-card shadow="never" class="admin-dailyrec-table-card">
      <template #header>
        <div class="admin-dailyrec-cardhead">
          <span>⚠️ 未收款清单（已送达 + 货到付款 + 无收款凭证）</span>
          <div>
            <el-button size="small" @click="copyUnpaid">复制清单</el-button>
            <el-button size="small" type="primary" @click="exportCsv">导出 CSV</el-button>
          </div>
        </div>
      </template>
      <el-table :data="data?.unpaidList ?? []" v-loading="loading" stripe empty-text="这一天没有未收款订单 🎉">
        <el-table-column prop="orderId" label="订单号" width="90">
          <template #default="{ row }">#{{ row.orderId }}</template>
        </el-table-column>
        <el-table-column prop="shopName" label="餐馆" min-width="150" show-overflow-tooltip />
        <el-table-column prop="courierName" label="配送员" width="130" />
        <el-table-column label="金额" width="110">
          <template #default="{ row }">¥{{ fmt(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="送达" width="110">
          <template #default="{ row }">{{ row.deliveryDate }}（{{ row.timeWindow }}）</template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 按配送员汇总 -->
    <el-card shadow="never" class="admin-dailyrec-table-card">
      <template #header><span>按配送员汇总</span></template>
      <el-table :data="data?.byCourier ?? []" v-loading="loading" stripe>
        <el-table-column prop="courierName" label="配送员" min-width="130" />
        <el-table-column prop="orderCount" label="送了几天单" width="110">
          <template #default="{ row }">{{ row.orderCount }} 单</template>
        </el-table-column>
        <el-table-column label="应收" width="120">
          <template #default="{ row }">¥{{ fmt(row.receivable) }}</template>
        </el-table-column>
        <el-table-column label="已收" width="120">
          <template #default="{ row }">¥{{ fmt(row.received) }}</template>
        </el-table-column>
        <el-table-column label="未收" width="120">
          <template #default="{ row }">
            <span :class="row.unpaid > 0 ? 'admin-dailyrec-num-red' : 'admin-dailyrec-num-green'">¥{{ fmt(row.unpaid) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 按餐馆汇总 -->
    <el-card shadow="never" class="admin-dailyrec-table-card">
      <template #header><span>按餐馆汇总</span></template>
      <el-table :data="data?.byShop ?? []" v-loading="loading" stripe>
        <el-table-column prop="shopName" label="餐馆" min-width="160" show-overflow-tooltip />
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column label="应收" width="120">
          <template #default="{ row }">¥{{ fmt(row.receivable) }}</template>
        </el-table-column>
        <el-table-column label="已收" width="120">
          <template #default="{ row }">¥{{ fmt(row.received) }}</template>
        </el-table-column>
        <el-table-column label="未收" width="120">
          <template #default="{ row }">
            <span :class="row.unpaid > 0 ? 'admin-dailyrec-num-red' : 'admin-dailyrec-num-green'">¥{{ fmt(row.unpaid) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { financeAdminApi } from '../../api/modules'

const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const date = ref(today())
const data = ref(null)
const loading = ref(false)

const fmt = (n) => (n == null ? '0.00' : Number(n).toFixed(2))

function shiftDay(d) {
  const dt = new Date(`${date.value}T00:00:00.000Z`)
  dt.setUTCDate(dt.getUTCDate() + d)
  date.value = dt.toISOString().slice(0, 10)
  load()
}

async function load() {
  loading.value = true
  try {
    data.value = await financeAdminApi.getDailyReconciliation({ date: date.value })
  } catch (e) {
    /* 请求封装已统一提示 */
  } finally {
    loading.value = false
  }
}

const unpaidRows = () => data.value?.unpaidList ?? []

async function copyUnpaid() {
  const rows = unpaidRows()
  if (!rows.length) return ElMessage.info('没有未收款订单')
  const tsv = ['订单号\t餐馆\t配送员\t金额\t送达', ...rows.map((r) => `#${r.orderId}\t${r.shopName}\t${r.courierName}\t¥${r.amount}\t${r.deliveryDate}（${r.timeWindow}）`)].join('\n')
  try {
    await navigator.clipboard.writeText(tsv)
    ElMessage.success('清单已复制，可直接粘贴到微信/Excel')
  } catch {
    ElMessage.error('复制失败，请用导出 CSV')
  }
}

function exportCsv() {
  const rows = unpaidRows()
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [['订单号', '餐馆', '配送员', '金额', '送达日', '时段'].join(',')]
  for (const r of rows) lines.push([r.orderId, esc(r.shopName), esc(r.courierName), r.amount, r.deliveryDate, r.timeWindow].join(','))
  // 无未收款时也导出汇总，方便留档
  lines.push('')
  lines.push(['汇总'].join(','))
  lines.push(['应收', data.value?.summary?.receivable].join(','))
  lines.push(['实收', data.value?.summary?.received].join(','))
  lines.push(['未收', data.value?.summary?.unpaid].join(','))
  lines.push(['应付供应商(参考值)', data.value?.summary?.supplierPayable].join(','))
  lines.push(['毛利粗算', data.value?.summary?.grossProfit].join(','))
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `每日对账_${date.value}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(load)
</script>

<style scoped>
.admin-dailyrec-page { padding: 0; }
.admin-dailyrec-crumb { color: #909399; font-size: 13px; margin-bottom: 14px; }
.admin-dailyrec-filter-card { margin-bottom: 14px; }
.admin-dailyrec-filter { display: flex; align-items: center; }
.admin-dailyrec-filter-lbl { font-size: 14px; color: #606266; margin-right: 10px; }
.admin-dailyrec-filter-tip { margin-left: auto; color: #c0c4cc; font-size: 12px; }
.admin-dailyrec-cards { display: flex; gap: 12px; margin-bottom: 14px; }
.admin-dailyrec-card { flex: 1; background: #fff; border: 1px solid #ebeef5; border-radius: 8px; padding: 14px 16px; }
.admin-dailyrec-card-lbl { color: #909399; font-size: 13px; margin-bottom: 6px; }
.admin-dailyrec-card-num { font-size: 22px; font-weight: 600; color: #303133; }
.admin-dailyrec-card-sub { color: #c0c4cc; font-size: 12px; margin-top: 6px; }
.admin-dailyrec-num-green { color: #07c160; }
.admin-dailyrec-num-red { color: #fa5151; }
.admin-dailyrec-notice { margin-bottom: 14px; }
.admin-dailyrec-table-card { margin-bottom: 14px; }
.admin-dailyrec-cardhead { display: flex; justify-content: space-between; align-items: center; }
</style>
