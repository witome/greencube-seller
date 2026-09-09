<template>
  <div>
    <el-card shadow="never">
      <div class="filter-bar">
        <el-select v-model="entity" placeholder="全部对象类型" clearable style="width: 200px" @change="load">
          <el-option label="采购方" value="purchaser" />
          <el-option label="供应商" value="supplier" />
          <el-option label="商品" value="product" />
          <el-option label="订单" value="order" />
          <el-option label="结算" value="settlement" />
          <el-option label="配送任务(含配送员异常)" value="delivery_task" />
        </el-select>
        <el-button type="primary" @click="load">查询</el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130">
          <template #default="{ row }">{{ actionText(row.action) }}</template>
        </el-table-column>
        <el-table-column prop="entity" label="对象类型" width="110" />
        <el-table-column prop="entityId" label="对象ID" width="90" />
        <el-table-column prop="operatorId" label="操作者ID" width="100" />
        <el-table-column label="变更内容" min-width="260">
          <template #default="{ row }">
            <div class="diff" v-if="row.before || row.after">
              <span v-if="row.before" class="old">{{ jsonBrief(row.before) }}</span>
              <span v-if="row.before && row.after" class="arrow">→</span>
              <span v-if="row.after" class="new">{{ jsonBrief(row.after) }}</span>
            </div>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pager"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="onPage"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { auditApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const entity = ref('')
const loading = ref(false)

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function jsonBrief(v) {
  if (v == null) return ''
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > 40 ? s.slice(0, 40) + '…' : s
  } catch (e) {
    return String(v)
  }
}

// 操作名中文映射
function actionText(action) {
  const map = {
    courier_report: '配送异常上报',
    UPDATE_PRICING: '改价',
    UPDATE_SERVICE_FEE: '改服务费',
    BATCH_MARKUP: '批量加价',
    SPLIT: '拆单',
    RE_SPLIT: '改拆单',
    GENERATE_SETTLEMENT: '生成结算',
    UPDATE_DELIVERY_FEE: '改运费规则',
  }
  return map[action] || action
}

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (entity.value) params.entity = entity.value
    const data = await auditApi.getLogs(params)
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function onPage(p) {
  page.value = p
  load()
}

onMounted(load)
</script>

<style scoped>
.filter-bar { display: flex; gap: 10px; }
.diff { font-size: 12px; }
.old { color: #909399; text-decoration: line-through; }
.new { color: #f56c6c; }
.arrow { color: #c0c4cc; margin: 0 6px; }
.muted { color: #c0c4cc; }
.pager { margin-top: 16px; justify-content: flex-end; }
</style>
