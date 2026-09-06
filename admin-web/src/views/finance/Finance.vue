<template>
  <div>
    <!-- 服务费设置 -->
    <el-card shadow="never" class="section">
      <template #header>⚙️ 服务费设置（对供应商应付抽成）</template>
      <div class="fee-row">
        <span class="fee-label">全局费率：</span>
        <el-input-number v-model="feeRate" :min="0" :max="0.5" :step="0.01" :precision="2" />
        <span class="fee-pct">= {{ (feeRate * 100).toFixed(0) }}%</span>
        <el-button type="primary" @click="saveFee">保存费率</el-button>
        <el-button @click="previewFee">试算本月</el-button>
      </div>
      <el-alert v-if="preview" type="info" :closable="false" class="preview-alert" show-icon>
        <template #title>试算结果（{{ preview.affectedSuppliers }} 家供应商受影响）</template>
        本月供货额 ¥{{ preview.sampleGross }} → 服务费 ¥{{ preview.sampleFee }}（{{ (preview.rate * 100).toFixed(0) }}%）→ 应付 ¥{{ preview.sampleNet }}。{{ preview.note }}
      </el-alert>
    </el-card>

    <!-- 生成结算单 -->
    <el-card shadow="never" class="section">
      <template #header>生成结算单</template>
      <div class="gen-row">
        <el-date-picker v-model="genPeriod" type="month" value-format="YYYY-MM" placeholder="选择月份" />
        <el-button type="primary" :loading="submitting" @click="generate">生成该月结算单</el-button>
      </div>
    </el-card>

    <!-- 结算单列表 -->
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>结算单</span>
          <el-date-picker v-model="filterPeriod" type="month" value-format="YYYY-MM" placeholder="按月份筛选" clearable @change="load" style="width: 160px" />
        </div>
      </template>
      <el-table :data="settlements" v-loading="loading" stripe>
        <el-table-column prop="period" label="期数" width="100" />
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column label="供货金额" width="120">
          <template #default="{ row }">¥{{ row.grossAmount }}</template>
        </el-table-column>
        <el-table-column label="服务费" width="130">
          <template #default="{ row }">-¥{{ row.serviceFee }}（{{ (row.serviceFeeRate * 100).toFixed(1) }}%）</template>
        </el-table-column>
        <el-table-column label="应付" width="120">
          <template #default="{ row }"><span class="net">¥{{ row.netAmount }}</span></template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!settlements.length && !loading" description="暂无结算单" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { financeAdminApi } from '../../api/modules'

const feeRate = ref(0.05)
const preview = ref(null)
const settlements = ref([])
const loading = ref(false)
const submitting = ref(false)
const genPeriod = ref('')
const filterPeriod = ref('')

async function saveFee() {
  await financeAdminApi.updateServiceFee({ rate: feeRate.value })
  ElMessage.success('服务费费率已保存')
}

async function previewFee() {
  preview.value = await financeAdminApi.previewServiceFee({ rate: feeRate.value })
}

async function generate() {
  if (!genPeriod.value) { ElMessage.warning('请选择月份'); return }
  submitting.value = true
  try {
    const r = await financeAdminApi.generateSettlement({ period: genPeriod.value })
    ElMessage.success(`已生成 ${r.period} 结算单，费率 ${(r.rate * 100).toFixed(0)}%`)
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const params = {}
    if (filterPeriod.value) params.period = filterPeriod.value
    settlements.value = await financeAdminApi.getSettlements(params)
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.section { margin-bottom: 16px; }
.fee-row { display: flex; align-items: center; gap: 10px; }
.fee-label { color: #606266; }
.fee-pct { color: #00b96b; font-weight: 700; }
.preview-alert { margin-top: 14px; }
.gen-row { display: flex; align-items: center; gap: 10px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }
.net { color: #00b96b; font-weight: 700; }
</style>
