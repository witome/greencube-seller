<template>
  <div>
    <el-tabs v-model="activeTab">
      <!-- 待审核新品 -->
      <el-tab-pane label="待审核新品" name="apply">
        <el-card shadow="never">
          <el-table :data="pendingList" v-loading="loading" stripe>
            <el-table-column prop="name" label="商品名称" min-width="140" />
            <el-table-column prop="supplierName" label="供应商" width="120" />
            <el-table-column label="供货价" width="100">
              <template #default="{ row }">¥{{ row.supplyPrice }}</template>
            </el-table-column>
            <el-table-column label="日可供量" width="90">
              <template #default="{ row }">{{ row.dailySupply }}</template>
            </el-table-column>
            <el-table-column label="计量" width="90">
              <template #default="{ row }">{{ row.weighType === 1 ? '称重' : '固定规格' }}</template>
            </el-table-column>
            <!-- 卡BP（2026-10-02）：商品备注随新品申请一起审核 -->
            <el-table-column label="商品备注" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '—' }}</template>
            </el-table-column>
            <el-table-column label="提交时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.submittedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button type="success" link @click="openApprove(row)">通过</el-button>
                <el-button type="danger" link @click="openReject(row)">驳回</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!pendingList.length && !loading" description="暂无待审核新品" />
        </el-card>
      </el-tab-pane>

      <!-- 待审核变更 -->
      <el-tab-pane label="待审核变更" name="change">
        <el-card shadow="never">
          <el-table :data="changeList" v-loading="loading" stripe>
            <el-table-column prop="productName" label="商品" width="120" />
            <el-table-column prop="supplierName" label="供应商" width="120" />
            <el-table-column label="变更内容（原值 → 新值）" min-width="220">
              <template #default="{ row }">
                <div v-for="(d, i) in row.diffs" :key="i" class="diff-row">
                  <span class="diff-field">{{ d.fieldText }}：</span>
                  <span class="diff-old">{{ d.oldValue }}</span>
                  <span class="diff-arrow">→</span>
                  <span class="diff-new">{{ d.newValue }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.submittedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button type="success" link @click="approveChange(row)">通过</el-button>
                <el-button type="danger" link @click="openRejectChange(row)">驳回</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!changeList.length && !loading" description="暂无待审核变更" />
        </el-card>
      </el-tab-pane>

      <!-- 供货优先级（在售商品多供应商排序） -->
      <el-tab-pane label="供货优先级" name="priority">
        <el-card shadow="never">
          <el-table :data="priorityProducts" v-loading="priorityLoading" stripe>
            <el-table-column prop="name" label="商品名称" min-width="160" />
            <el-table-column label="销售价" width="100">
              <template #default="{ row }">¥{{ row.salePrice }}</template>
            </el-table-column>
            <el-table-column label="供货供应商数" width="120">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.supplierCount }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link @click="openPriority(row)">设置优先级</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!priorityProducts.length && !priorityLoading" description="暂无可设置优先级的商品" />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新品通过弹窗 -->
    <el-dialog v-model="approveDialog" title="审核通过 · 上架商品" width="480px">
      <p style="color:#606266; margin-bottom:12px">
        「{{ currentApply?.name }}」供货价 ¥{{ currentApply?.supplyPrice }}，请设定加价比例生成销售价。
      </p>
      <el-form label-width="110px">
        <el-form-item label="加价比例">
          <el-input-number v-model="markupRate" :min="0" :max="2" :step="0.05" />
          <span class="tip">（如 0.3 = 加价 30%）</span>
        </el-form-item>
        <el-form-item label="销售价预览">
          <span class="preview">¥{{ previewSalePrice }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveDialog = false">取消</el-button>
        <el-button type="success" :loading="submitting" @click="submitApprove">确认通过并上架</el-button>
      </template>
    </el-dialog>

    <!-- 新品驳回弹窗 -->
    <el-dialog v-model="rejectDialog" title="驳回新品申请" width="480px">
      <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="驳回原因（必填，将通知供应商）" />
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 变更驳回弹窗 -->
    <el-dialog v-model="rejectChangeDialog" title="驳回变更申请" width="480px">
      <el-input v-model="rejectChangeComment" type="textarea" :rows="3" placeholder="驳回原因（选填）" />
      <template #footer>
        <el-button @click="rejectChangeDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="submitRejectChange">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 供货优先级设置弹窗 -->
    <el-dialog v-model="priorityDialog" :title="`供货优先级 · ${currentPriority?.productName || ''}`" width="560px">
      <el-alert type="info" :closable="false" title="优先级数字越小越优先（自动拆单时优先分配），按供应商调整后保存" style="margin-bottom:12px" />
      <el-table :data="priorityList" v-loading="priorityDetailLoading" stripe>
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column label="供货价" width="100">
          <template #default="{ row }">¥{{ row.supplyPrice }}</template>
        </el-table-column>
        <el-table-column label="日可供量" width="100">
          <template #default="{ row }">{{ row.dailySupply }}</template>
        </el-table-column>
        <el-table-column label="优先级" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.priority" :min="1" :max="99" size="small" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="priorityDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="savePriority">保存优先级</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { goodsAdminApi, pricingAdminApi } from '../../api/modules'

const activeTab = ref('apply')
const loading = ref(false)
const submitting = ref(false)

const pendingList = ref([])
const changeList = ref([])

// 供货优先级
const priorityProducts = ref([])
const priorityLoading = ref(false)
const priorityDialog = ref(false)
const priorityDetailLoading = ref(false)
const currentPriority = ref(null)
const priorityList = ref([])

const approveDialog = ref(false)
const rejectDialog = ref(false)
const rejectChangeDialog = ref(false)
const currentApply = ref(null)
const currentChange = ref(null)
const markupRate = ref(0.3)
const rejectReason = ref('')
const rejectChangeComment = ref('')

const previewSalePrice = computed(() => {
  if (!currentApply.value) return '0.00'
  return ((currentApply.value.supplyPrice || 0) * (1 + markupRate.value)).toFixed(2)
})

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    pendingList.value = await goodsAdminApi.getGoodsPending()
    changeList.value = await goodsAdminApi.getGoodsChangePending()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function openApprove(row) {
  currentApply.value = row
  markupRate.value = 0.3
  approveDialog.value = true
}

function openReject(row) {
  currentApply.value = row
  rejectReason.value = ''
  rejectDialog.value = true
}

async function submitApprove() {
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsApply(currentApply.value.applyId, { approved: true, markupRate: markupRate.value })
    ElMessage.success('已通过并上架')
    approveDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function submitReject() {
  if (!rejectReason.value.trim()) { ElMessage.warning('请填写驳回原因'); return }
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsApply(currentApply.value.applyId, { approved: false, rejectReason: rejectReason.value.trim() })
    ElMessage.success('已驳回')
    rejectDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function approveChange(row) {
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsChange(row.changeId, { approved: true })
    ElMessage.success('变更已生效')
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

function openRejectChange(row) {
  currentChange.value = row
  rejectChangeComment.value = ''
  rejectChangeDialog.value = true
}

async function submitRejectChange() {
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsChange(currentChange.value.changeId, { approved: false, comment: rejectChangeComment.value })
    ElMessage.success('已驳回')
    rejectChangeDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

// ── 供货优先级 ──
async function loadPriorityProducts() {
  priorityLoading.value = true
  try {
    priorityProducts.value = await pricingAdminApi.getList()
  } catch (e) { /* 已提示 */ } finally {
    priorityLoading.value = false
  }
}

async function openPriority(row) {
  currentPriority.value = row
  priorityDetailLoading.value = true
  priorityDialog.value = true
  try {
    const detail = await goodsAdminApi.getPriority(row.productId)
    priorityList.value = detail.suppliers || []
  } catch (e) {
    priorityList.value = []
  } finally {
    priorityDetailLoading.value = false
  }
}

async function savePriority() {
  submitting.value = true
  try {
    const items = priorityList.value.map((s) => ({ supplierId: s.supplierId, priority: s.priority }))
    await goodsAdminApi.setPriority(currentPriority.value.productId, items)
    ElMessage.success('优先级已保存')
    priorityDialog.value = false
    loadPriorityProducts()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

onMounted(() => {
  load()
  loadPriorityProducts()
})
</script>

<style scoped>
.diff-row {
  padding: 2px 0;
  font-size: 13px;
}
.diff-field { color: #606266; }
.diff-old { color: #909399; text-decoration: line-through; margin-right: 6px; }
.diff-arrow { color: #c0c4cc; margin: 0 6px; }
.diff-new { color: #f56c6c; font-weight: 600; }
.tip { color: #909399; font-size: 12px; margin-left: 8px; }
.preview { color: #00b96b; font-size: 18px; font-weight: 700; }
</style>
