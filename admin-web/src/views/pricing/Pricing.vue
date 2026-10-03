<template>
  <div class="admin-pricing-page">
    <div class="admin-pricing-crumb">基础资料 / 价格与加价</div>

    <!-- 加价设置（卡BI 2026-10-02：全局默认 / 按分类 / 按供应商；单品改价在下方表格） -->
    <el-card shadow="never" class="admin-pricing-config-card">
      <template #header>
        <div class="admin-pricing-head">
          <span>⚙️ 加价设置</span>
          <span class="admin-pricing-tip">生效优先级：单品 &gt; 供应商 &gt; 分类 &gt; 全局默认；新建商品按此取默认比例</span>
        </div>
      </template>

      <div class="admin-pricing-edit-row">
        <span class="admin-pricing-edit-k">全局默认比例</span>
        <el-input-number v-model="cfgGlobalPct" :min="0" :max="999" :step="1" size="small" />
        <span class="admin-pricing-unit">%</span>
        <el-button type="primary" size="small" @click="askScope(1, null, '全局默认比例', cfgGlobalPct)">保存</el-button>
      </div>

      <div class="admin-pricing-config-grid">
        <div class="admin-pricing-config-block">
          <div class="admin-pricing-config-title">按分类</div>
          <div v-for="c in cfgCategories" :key="c.categoryId" class="admin-pricing-config-row">
            <span class="admin-pricing-config-name" :title="c.name">{{ c.name }}</span>
            <el-input-number v-model="c.ratePct" :min="0" :max="999" :step="1" size="small" placeholder="未设" />
            <span class="admin-pricing-unit">%</span>
            <el-button link type="primary" size="small" @click="saveCategoryRow(c)">保存</el-button>
          </div>
          <el-empty v-if="!cfgCategories.length" description="暂无分类" :image-size="48" />
        </div>
        <div class="admin-pricing-config-block">
          <div class="admin-pricing-config-title">按供应商</div>
          <div v-for="s in cfgSuppliers" :key="s.supplierId" class="admin-pricing-config-row">
            <span class="admin-pricing-config-name" :title="s.stallName">{{ s.stallName }}</span>
            <el-input-number v-model="s.ratePct" :min="0" :max="999" :step="1" size="small" placeholder="未设" />
            <span class="admin-pricing-unit">%</span>
            <el-button link type="primary" size="small" @click="saveSupplierRow(s)">保存</el-button>
          </div>
          <el-empty v-if="!cfgSuppliers.length" description="暂无供应商" :image-size="48" />
        </div>
      </div>
    </el-card>

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
        <!-- 卡BQ：列序照原型屏1 —— 比例来源在加价比例之前 -->
        <el-table-column label="比例来源" width="100">
          <template #default="{ row }">
            <el-tag :type="sourceTagType(row.markupSource)" size="small" effect="plain">{{ row.markupSource }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="加价比例" width="100" align="right">
          <template #default="{ row }">
            <span class="admin-pricing-rate">{{ (row.markupRate * 100).toFixed(0) }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="销售价" width="110" align="right">
          <template #default="{ row }">
            <span class="admin-pricing-price">¥{{ row.salePrice }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">改价</el-button>
            <!-- 卡BQ：仅「来源=单品」的行给恢复继承入口 -->
            <el-button v-if="row.markupSource === '单品'" type="warning" link @click="askResetOverride(row)">恢复继承</el-button>
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
          <span style="color:#8a9099;font-size:12px;">%（改比例会联动销售价，且此商品将固定为「单品」比例）</span>
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

    <!-- 批量加价弹窗（卡BI：范围扩为 全部/分类/供应商 + 影响范围） -->
    <el-dialog v-model="batchDialog" title="批量加价" width="460px">
      <div class="admin-pricing-edit-row">
        <span class="admin-pricing-edit-k">适用范围</span>
        <el-select v-model="batchScope" size="small" style="width:220px" @change="onBatchScopeChange">
          <el-option label="全部在售商品" :value="1" />
          <el-option label="按分类" :value="2" />
          <el-option label="按供应商" :value="3" />
        </el-select>
      </div>
      <div class="admin-pricing-edit-row" v-if="batchScope === 2">
        <span class="admin-pricing-edit-k">选择分类</span>
        <el-select v-model="batchRefId" placeholder="请选择分类" size="small" style="width:220px">
          <el-option v-for="c in cfgCategories" :key="c.categoryId" :label="c.name" :value="c.categoryId" />
        </el-select>
      </div>
      <div class="admin-pricing-edit-row" v-if="batchScope === 3">
        <span class="admin-pricing-edit-k">选择供应商</span>
        <el-select v-model="batchRefId" placeholder="请选择供应商" size="small" style="width:220px">
          <el-option v-for="s in cfgSuppliers" :key="s.supplierId" :label="s.stallName" :value="s.supplierId" />
        </el-select>
      </div>
      <div class="admin-pricing-edit-row">
        <span class="admin-pricing-edit-k">加价比例</span>
        <el-input-number v-model="batchRate" :min="0" :max="999" :step="1" size="small" />
        <span style="color:#8a9099;font-size:12px;">%（写入加价设置）</span>
      </div>
      <div class="admin-pricing-edit-row">
        <span class="admin-pricing-edit-k">影响范围</span>
        <el-radio-group v-model="batchApplyNow">
          <el-radio :value="false">只影响以后新增</el-radio>
          <el-radio :value="true">同时重算在售商品</el-radio>
        </el-radio-group>
      </div>
      <el-alert
        :type="batchApplyNow ? 'warning' : 'info'"
        :closable="false"
        :title="batchApplyNow
          ? '将重算所选范围内在售商品的加价比例并联动销售价（单品单独设过的跳过）'
          : '只写入加价设置，在售商品的价格一律不动；之后可在「加价设置」里手动重算'"
        style="margin-top:4px"
      />
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="warning" :loading="batching" @click="doBatchMarkup">一键应用</el-button>
      </template>
    </el-dialog>

    <!-- 影响范围确认弹窗（卡BQ 照原型屏1-3：「应用到现有商品」复选框**默认勾选**，这是"改了没反应"的根因之一） -->
    <el-dialog v-model="scopeDialog" title="保存比例 · 影响范围" width="460px">
      <div class="admin-pricing-scope-tip">正在保存：{{ scopePending.label }}</div>
      <el-checkbox v-model="scopeApplyNow">应用到现有商品</el-checkbox>
      <div class="admin-pricing-scope-hint">勾上会按新比例重算在售商品销售价（单品单独设过的会跳过）</div>
      <template #footer>
        <el-button @click="scopeDialog = false">取消</el-button>
        <el-button type="primary" :loading="scopeSaving" @click="doSaveConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { pricingAdminApi } from '../../api/modules'
import request from '../../api/request'

const list = ref([])
const loading = ref(false)

// ── 加价设置（卡BI） ──
const cfgGlobalPct = ref(30)
const cfgCategories = ref([]) // [{ categoryId, name, ratePct }]
const cfgSuppliers = ref([])  // [{ supplierId, stallName, ratePct }]

function applyConfig(cfg) {
  cfgGlobalPct.value = cfg.global != null ? Math.round(cfg.global * 100) : 30
  cfgCategories.value = (cfg.categories || []).map((c) => ({
    categoryId: c.categoryId,
    name: c.name,
    ratePct: c.rate != null ? Math.round(c.rate * 100) : null,
  }))
  cfgSuppliers.value = (cfg.suppliers || []).map((s) => ({
    supplierId: s.supplierId,
    stallName: s.stallName,
    ratePct: s.rate != null ? Math.round(s.rate * 100) : null,
  }))
}

async function loadConfig() {
  try {
    applyConfig(await pricingAdminApi.getMarkupConfig())
  } catch (e) { /* 已提示 */ }
}

// 影响范围弹窗：卡BQ 照原型屏1-3，「应用到现有商品」**默认勾选**（原默认不勾导致"改了没反应"）
const scopeDialog = ref(false)
const scopeApplyNow = ref(true)
const scopeSaving = ref(false)
const scopePending = reactive({ scope: 1, refId: null, rate: null, label: '' })

function askScope(scope, refId, label, ratePct) {
  if (ratePct == null || isNaN(ratePct)) {
    ElMessage.info('请先填写比例（留空表示未设置）')
    return
  }
  scopePending.scope = scope
  scopePending.refId = refId
  scopePending.rate = ratePct / 100
  scopePending.label = label
  scopeApplyNow.value = true // 卡BQ：每次打开默认勾选「应用到现有商品」
  scopeDialog.value = true
}

function saveCategoryRow(c) { askScope(2, c.categoryId, `分类「${c.name}」`, c.ratePct) }
function saveSupplierRow(s) { askScope(3, s.supplierId, `供应商「${s.stallName}」`, s.ratePct) }

async function doSaveConfig() {
  scopeSaving.value = true
  try {
    await pricingAdminApi.putMarkupConfig({ scope: scopePending.scope, refId: scopePending.refId ?? undefined, rate: scopePending.rate })
    if (scopeApplyNow.value) {
      const res = await pricingAdminApi.applyMarkupConfig({ scope: scopePending.scope, refId: scopePending.refId ?? undefined })
      ElMessage.success(`已保存配置；重算在售商品 ${res.updated} 件，跳过单品 ${res.skipped} 件`)
    } else {
      ElMessage.success('已保存，只对以后新增的商品生效')
    }
    scopeDialog.value = false
    loadConfig()
    load()
  } catch (e) { /* 已提示 */ } finally {
    scopeSaving.value = false
  }
}

// ── 恢复继承（卡BQ 2026-10-03）：仅「来源=单品」行可点，二次确认文案照原型屏1-2 ──
async function askResetOverride(row) {
  try {
    await ElMessageBox.confirm(
      '恢复后这个商品不再固定「单品」比例，改按 供应商 > 分类 > 全局 生效；销售价会随下次重算联动。',
      `把「${row.name}」恢复为继承档位比例？`,
      { confirmButtonText: '确认恢复', cancelButtonText: '再想想', type: 'info' },
    )
  } catch (e) {
    return // 用户取消
  }
  try {
    // 新接口走 request 直调（modules.js 不在本卡白名单内，同卡AA toggleSuspend 先例）；拦截器已解包信封
    await request.post(`/admin/pricing/${row.productId}/reset-override`)
    ElMessage.success(`已恢复为继承档位比例（按${row.name}当前档位重算）`)
    load()
  } catch (e) {
    /* 失败已由 request 拦截器提示 */
  }
}

// ── 商品定价列表 ──
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

function sourceTagType(source) {
  // 卡BQ：标签色照原型屏1 —— 单品=橙 / 供应商=蓝 / 全局默认=灰；分类原型未给出，用绿色保持可区分
  if (source === '单品') return 'warning'
  if (source === '供应商') return 'primary'
  if (source === '分类') return 'success'
  return 'info'
}

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

// ── 批量加价（范围：全部 / 分类 / 供应商；影响范围默认只影响以后新增） ──
const batchDialog = ref(false)
const batching = ref(false)
const batchScope = ref(1)
const batchRefId = ref(null)
const batchRate = ref(30)
const batchApplyNow = ref(false)

function onBatchScopeChange() {
  batchRefId.value = null
}

async function openBatch() {
  batchDialog.value = true
  if (!cfgCategories.value.length) loadConfig()
}

async function doBatchMarkup() {
  if (batchScope.value !== 1 && !batchRefId.value) {
    ElMessage.info(batchScope.value === 2 ? '请选择分类' : '请选择供应商')
    return
  }
  batching.value = true
  try {
    const payload = { markupRate: batchRate.value / 100, applyNow: batchApplyNow.value }
    if (batchScope.value === 2) payload.categoryId = batchRefId.value
    if (batchScope.value === 3) payload.supplierId = batchRefId.value
    const res = await pricingAdminApi.batchMarkup(payload)
    if (batchApplyNow.value) {
      ElMessage.success(`已保存配置；重算在售商品 ${res.updated} 件，跳过单品 ${res.skipped} 件`)
    } else {
      ElMessage.success('已保存，只对以后新增的商品生效')
    }
    batchDialog.value = false
    loadConfig()
    load()
  } catch (e) { /* 已提示 */ } finally {
    batching.value = false
  }
}

onMounted(() => {
  load()
  loadConfig()
})
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
.admin-pricing-config-card {
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
.admin-pricing-unit {
  color: #8a9099;
  font-size: 12px;
}
.admin-pricing-config-grid {
  display: flex;
  gap: 32px;
}
.admin-pricing-config-block {
  flex: 1;
  min-width: 0;
  max-height: 260px;
  overflow-y: auto;
}
.admin-pricing-config-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.admin-pricing-config-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.admin-pricing-config-name {
  width: 110px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.admin-pricing-scope-tip {
  font-size: 13px;
  color: #303133;
  margin-bottom: 12px;
}
/* 卡BQ：影响范围弹窗的勾选说明小字（照原型屏1-3） */
.admin-pricing-scope-hint {
  font-size: 12px;
  color: #8a9099;
  line-height: 1.7;
  margin-top: 4px;
}
</style>
