<template>
  <div class="admin-pricing-page">
    <div class="admin-pricing-crumb">基础资料 / 价格与加价</div>

    <el-card shadow="never">
      <template #header>
        <div class="admin-pricing-head">
          <span>🏷️ 在售商品定价</span>
          <div class="admin-pricing-head-right">
            <span class="admin-pricing-tip">销售价 = 供货价 × (1 + 加价比例)</span>
            <el-button type="warning" size="small" @click="openBatch">批量加价</el-button>
          </div>
        </div>
      </template>

      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="商品" min-width="160">
          <template #default="{ row }">
            <div>{{ row.name }}</div>
            <div class="admin-pricing-sub">{{ row.categoryName }} · 按{{ row.unit }}</div>
          </template>
        </el-table-column>
        <el-table-column label="主供供货价" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.supplyPrice !== null">¥{{ row.supplyPrice }}</span>
            <span v-else style="color:#c0c4cc;">无供应商</span>
          </template>
        </el-table-column>
        <el-table-column label="加价比例" width="120" align="right">
          <template #default="{ row }">
            <span class="admin-pricing-rate">{{ (row.markupRate * 100).toFixed(0) }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="销售价" width="110" align="right">
          <template #default="{ row }">
            <span class="admin-pricing-price">¥{{ row.salePrice }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">改价</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无在售商品" />
    </el-card>

    <!-- 改价弹窗 -->
    <el-dialog v-model="editDialog" title="修改定价" width="440px">
      <div v-if="current" class="admin-pricing-edit">
        <div class="admin-pricing-edit-row">
          <span class="admin-pricing-edit-k">商品</span>
          <span>{{ current.name }}</span>
        </div>
        <div class="admin-pricing-edit-row">
          <span class="admin-pricing-edit-k">主供供货价</span>
          <span v-if="current.supplyPrice !== null">¥{{ current.supplyPrice }}</span>
          <span v-else style="color:#c0c4cc;">无供应商</span>
        </div>
        <div class="admin-pricing-edit-row">
          <span class="admin-pricing-edit-k">加价比例</span>
          <el-input-number v-model="editRate" :min="0" :max="999" :step="1" size="small" />
          <span style="color:#8a9099;font-size:12px;">%（改比例会联动销售价）</span>
        </div>
        <div class="admin-pricing-edit-row" v-if="current.supplyPrice !== null">
          <span class="admin-pricing-edit-k">建议销售价</span>
          <span class="admin-pricing-suggest">¥{{ suggestPrice }}</span>
        </div>
        <div class="admin-pricing-edit-row">
          <span class="admin-pricing-edit-k">销售价</span>
          <el-input-number v-model="editPrice" :min="0.01" :precision="2" :step="0.1" size="small" />
          <span style="color:#8a9099;font-size:12px;">（可手动微调覆盖）</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="savePricing">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量加价弹窗 -->
    <el-dialog v-model="batchDialog" title="批量加价" width="440px">
      <div class="admin-pricing-edit-row">
        <span class="admin-pricing-edit-k">适用范围</span>
        <el-select v-model="batchCategoryId" placeholder="全部在售商品" clearable size="small" style="width:220px">
          <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
      </div>
      <div class="admin-pricing-edit-row">
        <span class="admin-pricing-edit-k">加价比例</span>
        <el-input-number v-model="batchRate" :min="0" :max="999" :step="1" size="small" />
        <span style="color:#8a9099;font-size:12px;">%（销售价自动联动）</span>
      </div>
      <el-alert type="warning" :closable="false" title="将批量更新所选范围内所有在售商品的加价比例，并自动重算销售价" style="margin-top:4px" />
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="warning" :loading="batching" @click="doBatchMarkup">一键应用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { pricingAdminApi, categoryAdminApi } from '../../api/modules'

const list = ref([])
const loading = ref(false)

const editDialog = ref(false)
const saving = ref(false)
const current = ref(null)
const editRate = ref(30)
const editPrice = ref(0)
const origRate = ref(30)
const origPrice = ref(0)

const suggestPrice = computed(() => {
  if (!current.value || current.value.supplyPrice === null) return '-'
  const p = current.value.supplyPrice * (1 + editRate.value / 100)
  return Math.round(p * 100) / 100
})

async function load() {
  loading.value = true
  try {
    list.value = await pricingAdminApi.getList()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function openEdit(row) {
  current.value = row
  editRate.value = Math.round(row.markupRate * 100)
  editPrice.value = row.salePrice
  origRate.value = editRate.value
  origPrice.value = editPrice.value
  editDialog.value = true
}

async function savePricing() {
  const payload = {}
  if (editRate.value !== origRate.value) {
    payload.markupRate = editRate.value / 100
  } else if (editPrice.value !== origPrice.value) {
    payload.salePrice = editPrice.value
  }
  if (Object.keys(payload).length === 0) {
    ElMessage.info('没有修改')
    return
  }
  saving.value = true
  try {
    await pricingAdminApi.update(current.value.productId, payload)
    ElMessage.success('已保存')
    editDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    saving.value = false
  }
}

// ── 批量加价 ──
const batchDialog = ref(false)
const batching = ref(false)
const batchCategoryId = ref(null)
const batchRate = ref(30)
const categories = ref([])

async function openBatch() {
  batchDialog.value = true
  if (!categories.value.length) {
    try {
      categories.value = await categoryAdminApi.getCategories()
    } catch (e) { /* 已提示 */ }
  }
}

async function doBatchMarkup() {
  batching.value = true
  try {
    const payload = { markupRate: batchRate.value / 100 }
    if (batchCategoryId.value) payload.categoryId = batchCategoryId.value
    const res = await pricingAdminApi.batchMarkup(payload)
    ElMessage.success(`已批量更新 ${res.updated} 件商品`)
    batchDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    batching.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.admin-pricing-page {
  max-width: 1280px;
  margin: 0 auto;
}
.admin-pricing-crumb {
  font-size: 13px;
  color: #8a9099;
  margin-bottom: 14px;
}
.admin-pricing-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.admin-pricing-head-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.admin-pricing-tip {
  font-size: 12px;
  color: #8a9099;
}
.admin-pricing-sub {
  font-size: 11px;
  color: #909399;
}
.admin-pricing-rate {
  color: #e6a23c;
  font-weight: 600;
}
.admin-pricing-price {
  color: #00b96b;
  font-weight: 700;
}
.admin-pricing-edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  font-size: 13px;
}
.admin-pricing-edit-k {
  width: 90px;
  color: #606266;
  flex-shrink: 0;
}
.admin-pricing-suggest {
  color: #00b96b;
  font-weight: 600;
}
</style>
