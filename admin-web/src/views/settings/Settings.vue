<template>
  <div class="admin-settings-page">
    <div class="admin-settings-crumb">系统设置 / 交易规则 · 服务费</div>

    <!-- 服务费设置（真实接口） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>💰 平台服务费设置</template>
      <div v-loading="loading">
        <div class="admin-settings-row">
          <span class="admin-settings-k">全局默认费率</span>
          <el-input-number v-model="globalRate" :min="0" :max="100" :step="0.5" :precision="1" size="small" />
          <span class="admin-settings-unit">%</span>
          <el-button type="primary" size="small" :loading="savingGlobal" @click="saveGlobal">保存</el-button>
        </div>

        <el-divider content-position="left">分类覆盖（不设置则按全局费率）</el-divider>

        <el-table :data="categoryRates" size="small">
          <el-table-column prop="categoryName" label="分类" />
          <el-table-column label="费率" width="180">
            <template #default="{ row }">
              <el-input-number v-model="row.rate" :min="0" :max="100" :step="0.5" :precision="1" size="small" />
              <span style="margin-left:4px;color:#8a9099;">%</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button type="primary" link :loading="row.saving" @click="saveCategory(row)">保存</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="admin-settings-add">
          <el-select v-model="newCategoryId" placeholder="选择分类" size="small" style="width:180px" filterable>
            <el-option v-for="c in availableCategories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-input-number v-model="newRate" :min="0" :max="100" :step="0.5" :precision="1" size="small" />
          <span style="color:#8a9099;">%</span>
          <el-button type="success" size="small" :loading="adding" @click="addCategory">添加覆盖</el-button>
        </div>
      </div>
    </el-card>

    <!-- 运费设置（真实接口） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>🚚 运费与免运费规则</template>
      <div v-loading="feeLoading">
        <div class="admin-settings-row">
          <span class="admin-settings-k">基础运费</span>
          <el-input-number v-model="feeForm.fee" :min="0" :step="1" :precision="1" size="small" />
          <span class="admin-settings-unit">元</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">满额免运费</span>
          <el-input-number v-model="feeForm.freeThreshold" :min="0" :step="10" size="small" />
          <span class="admin-settings-unit">元起免运费（0 = 不启用）</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">次日达免运费</span>
          <el-switch v-model="feeForm.freeNextDay" />
          <span class="admin-settings-unit">选择次日送达的订单免运费</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">加急运费</span>
          <el-input-number v-model="feeForm.urgentFee" :min="0" :step="1" :precision="1" size="small" />
          <span class="admin-settings-unit">元（采购方加急时额外收取）</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">加急满额免运费</span>
          <el-input-number v-model="feeForm.urgentFreeThreshold" :min="0" :step="10" size="small" />
          <span class="admin-settings-unit">元起免加急费（0 = 不启用）</span>
        </div>
        <div style="margin-top:16px;">
          <el-button type="primary" size="small" :loading="savingFee" @click="saveFee">保存运费规则</el-button>
        </div>
      </div>
    </el-card>

    <!-- 其他配置（暂未接入） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>⚙️ 其他配置</template>
      <div class="admin-settings-empty">
        交易规则（起送金额、申报截止时间）、支付通道、通知开关等暂未接入，待后续提供配置接口后在此维护。
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { financeAdminApi, categoryAdminApi } from '../../api/modules'

const loading = ref(false)
const globalRate = ref(5)
const categoryRates = ref([])
const allCategories = ref([])

const savingGlobal = ref(false)
const adding = ref(false)
const newCategoryId = ref(null)
const newRate = ref(5)

// 运费规则
const feeForm = reactive({ fee: 5, freeThreshold: 100, freeNextDay: true, urgentFee: 0, urgentFreeThreshold: 0 })
const feeLoading = ref(false)
const savingFee = ref(false)

// 可选分类 = 一级分类里排除已配置覆盖的
const availableCategories = computed(() => {
  const covered = new Set(categoryRates.value.map((c) => c.categoryId))
  return allCategories.value.filter((c) => !covered.has(c.id))
})

async function load() {
  loading.value = true
  try {
    const cfg = await financeAdminApi.getServiceFeeConfigs()
    globalRate.value = Math.round(cfg.globalRate * 1000) / 10
    categoryRates.value = (cfg.categories || []).map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      rate: Math.round(c.rate * 1000) / 10,
    }))
    allCategories.value = await categoryAdminApi.getCategories()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

async function saveGlobal() {
  savingGlobal.value = true
  try {
    await financeAdminApi.updateServiceFee({ rate: globalRate.value / 100 })
    ElMessage.success('全局费率已保存')
  } catch (e) { /* 已提示 */ } finally {
    savingGlobal.value = false
  }
}

async function saveCategory(row) {
  row.saving = true
  try {
    await financeAdminApi.updateServiceFee({ categoryId: row.categoryId, rate: row.rate / 100 })
    ElMessage.success('分类费率已保存')
  } catch (e) { /* 已提示 */ } finally {
    row.saving = false
  }
}

async function addCategory() {
  if (!newCategoryId.value) {
    ElMessage.warning('请选择分类')
    return
  }
  adding.value = true
  try {
    await financeAdminApi.updateServiceFee({ categoryId: newCategoryId.value, rate: newRate.value / 100 })
    ElMessage.success('已添加分类覆盖')
    newCategoryId.value = null
    load()
  } catch (e) { /* 已提示 */ } finally {
    adding.value = false
  }
}

async function loadFee() {
  feeLoading.value = true
  try {
    const fee = await financeAdminApi.getDeliveryFee()
    feeForm.fee = fee.fee
    feeForm.freeThreshold = fee.freeThreshold
    feeForm.freeNextDay = fee.freeNextDay
    feeForm.urgentFee = fee.urgentFee ?? 0
    feeForm.urgentFreeThreshold = fee.urgentFreeThreshold ?? 0
  } catch (e) { /* 已提示 */ } finally {
    feeLoading.value = false
  }
}

async function saveFee() {
  savingFee.value = true
  try {
    await financeAdminApi.updateDeliveryFee({
      fee: feeForm.fee,
      freeThreshold: feeForm.freeThreshold,
      freeNextDay: feeForm.freeNextDay,
      urgentFee: feeForm.urgentFee,
      urgentFreeThreshold: feeForm.urgentFreeThreshold,
    })
    ElMessage.success('运费规则已保存')
  } catch (e) { /* 已提示 */ } finally {
    savingFee.value = false
  }
}

onMounted(() => {
  load()
  loadFee()
})
</script>

<style scoped>
.admin-settings-page {
  max-width: 900px;
  margin: 0 auto;
}
.admin-settings-crumb {
  font-size: 13px;
  color: #8a9099;
  margin-bottom: 14px;
}
.admin-settings-card {
  margin-bottom: 16px;
}
.admin-settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.admin-settings-k {
  width: 120px;
  color: #606266;
}
.admin-settings-unit {
  color: #8a9099;
}
.admin-settings-add {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.admin-settings-empty {
  text-align: center;
  color: #b8bec6;
  font-size: 13px;
  line-height: 1.8;
  padding: 32px 16px;
}
</style>
