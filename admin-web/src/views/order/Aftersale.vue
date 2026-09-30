<template>
  <div class="admin-aftersale-page">
    <!-- 面包屑 -->
    <div class="admin-aftersale-crumb">订单履约 / 售后管理（拒收 · 少货 · 品质问题处理）</div>

    <!-- 筛选 -->
    <el-card shadow="never" class="admin-aftersale-filter-card">
      <div class="admin-aftersale-filter">
        <el-radio-group v-model="statusFilter" @change="onFilterChange">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="0">待处理</el-radio-button>
          <el-radio-button :value="2">已解决</el-radio-button>
          <el-radio-button :value="3">已关闭</el-radio-button>
        </el-radio-group>
        <!-- 卡AE 新增：供应商筛选（不选 = 全部供应商） -->
        <el-select
          v-model="supplierFilter"
          placeholder="全部供应商"
          clearable
          filterable
          style="width: 200px; margin-left: 16px"
          @change="onFilterChange"
        >
          <el-option v-for="s in suppliers" :key="s.supplierId" :label="s.stallName" :value="s.supplierId" />
        </el-select>
        <el-select v-model="typeFilter" placeholder="全部类型" clearable style="width: 140px; margin-left: 16px" @change="onFilterChange">
          <el-option label="少货" :value="1" />
          <el-option label="品质问题" :value="2" />
          <el-option label="错货" :value="3" />
          <el-option label="其他" :value="4" />
        </el-select>
        <el-button type="primary" @click="load">查询</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="admin-aftersale-table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="aftersaleId" label="工单号" width="90" />
        <el-table-column prop="orderId" label="订单号" width="90" />
        <el-table-column prop="shopName" label="餐馆" min-width="140" />
        <!-- 卡AE 新增：供应商列（归属不到 → 「待分派」） -->
        <el-table-column label="供应商" min-width="120">
          <template #default="{ row }">
            <span v-if="row.supplierAssigned">{{ row.supplierName }}</span>
            <el-tag v-else type="info" size="small">待分派</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="typeTagType(row.type)" size="small">{{ row.typeText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="售后原因" min-width="180" show-overflow-tooltip />
        <el-table-column label="差异数量" width="90">
          <template #default="{ row }">{{ row.qtyDiff }} 斤</template>
        </el-table-column>
        <el-table-column label="差异金额" width="100">
          <template #default="{ row }">¥{{ row.amountDiff.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="处理结果" min-width="160">
          <template #default="{ row }">
            <span v-if="row.compensateAmount != null">
              补偿 ¥{{ row.compensateAmount.toFixed(2) }}（{{ methodText(row.compensateMethod) }}）
            </span>
            <span v-else-if="row.handleRemark">{{ row.handleRemark }}</span>
            <span v-else-if="row.status === 2">仅致歉</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="凭证" width="90">
          <template #default="{ row }">
            <el-button v-if="row.attachments && row.attachments.length" link type="primary" @click="openPhotos(row)">
              {{ row.attachments.length }} 张
            </el-button>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">详情</el-button>
            <el-button
              v-if="row.status === 0"
              size="small"
              type="primary"
              @click="openHandle(row)"
            >处理</el-button>
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

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="售后工单详情" size="480px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="工单号">{{ detail.aftersaleId }}</el-descriptions-item>
          <el-descriptions-item label="订单号">{{ detail.orderId }}（{{ detail.deliveryDate }}）</el-descriptions-item>
          <el-descriptions-item label="餐馆">{{ detail.shopName }}</el-descriptions-item>
          <!-- 卡AE 新增：供应商（归属不到 → 待分派） -->
          <el-descriptions-item label="供应商">
            <span v-if="detail.supplierAssigned">{{ detail.supplierName }}</span>
            <el-tag v-else type="info" size="small">待分派</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="类型">{{ detail.typeText }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(detail.status)" size="small">{{ detail.statusText }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 客户提交的内容（卡AE：数量与原因单独成块） -->
        <div class="admin-aftersale-sub-title">客户提交的内容</div>
        <div class="admin-aftersale-block">
          原因：{{ detail.reason || '—' }}<br>
          涉及数量：{{ detail.qtyDiff }} 斤（差异金额 ¥{{ detail.amountDiff.toFixed(2) }}）
        </div>
        <div v-if="detail.attachments && detail.attachments.length" class="admin-aftersale-photos">
          <el-image
            v-for="(p, i) in detail.attachments"
            :key="i"
            :src="p"
            :preview-src-list="detail.attachments"
            :initial-index="i"
            fit="cover"
            class="admin-aftersale-thumb"
          />
        </div>
        <div v-if="detail.attachments && detail.attachments.length" class="admin-aftersale-muted">采购方提交售后时拍摄（点图预览大图）</div>

        <!-- 处理时间线（卡AE 新增：提交 → 处理完成） -->
        <div class="admin-aftersale-sub-title">处理时间线</div>
        <div class="admin-aftersale-timeline">
          <div class="admin-aftersale-tl-row">
            <span class="admin-aftersale-dot gray"></span>
            <span>
              客户提交售后申请<br>
              <em>{{ fmtTime(detail.createdAt) }} · {{ detail.qtyDiff }} 斤（{{ detail.typeText }}）</em>
            </span>
          </div>
          <div v-if="detail.handledAt" class="admin-aftersale-tl-row">
            <span class="admin-aftersale-dot green"></span>
            <span>
              运营处理完成{{ detail.handledBy ? `（运营 #${detail.handledBy}）` : '' }}<br>
              <em>{{ fmtTime(detail.handledAt) }} · 说明：{{ detail.handleRemark || '—' }}</em>
            </span>
          </div>
        </div>

        <!-- 处理结果 -->
        <div class="admin-aftersale-sub-title">处理结果</div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="处理说明">{{ detail.handleRemark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="补偿">
            <template v-if="detail.compensateAmount != null">¥{{ detail.compensateAmount.toFixed(2) }}（{{ methodText(detail.compensateMethod) }}）</template>
            <template v-else>{{ detail.status === 2 || detail.status === 3 ? methodText(null) : '—' }}</template>
          </el-descriptions-item>
          <el-descriptions-item label="处理时间">{{ detail.handledAt ? fmtTime(detail.handledAt) : '—' }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="detail.orderItems && detail.orderItems.length" style="margin-top: 16px">
          <div class="admin-aftersale-sub-title">订单明细</div>
          <el-table :data="detail.orderItems" size="small" border>
            <el-table-column prop="name" label="商品" min-width="120" />
            <el-table-column label="订购量" width="80">
              <template #default="{ row }">{{ row.qtyOrdered }}</template>
            </el-table-column>
            <el-table-column label="验收量" width="80">
              <template #default="{ row }">{{ row.qtyAccepted ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="收货量" width="80">
              <template #default="{ row }">{{ row.qtyReceived ?? '-' }}</template>
            </el-table-column>
            <el-table-column label="销售价" width="80">
              <template #default="{ row }">¥{{ row.salePrice.toFixed(2) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <el-alert
          type="error"
          :closable="false"
          show-icon
          style="margin-top: 12px"
          title="处理完成只写工单与审计日志：不改订单金额与状态、不扣供应商结算、不改客户账单。"
        />

        <el-button
          v-if="detail.status === 0"
          type="primary"
          style="margin-top: 16px"
          @click="openHandle(detail)"
        >处理该工单</el-button>
      </template>
    </el-drawer>

    <!-- 凭证照片弹窗（只读：采购方售后拍照，大图查看；照 OrderFulfill.vue 收款凭证同款写法） -->
    <el-dialog v-model="photosDialog" :title="`工单 #${photosRow?.aftersaleId} 售后凭证`" width="520px">
      <div v-if="photosRow?.attachments?.length" class="proof-grid">
        <el-image
          v-for="(p, i) in photosRow.attachments"
          :key="i"
          :src="p"
          :preview-src-list="photosRow.attachments"
          :initial-index="i"
          fit="cover"
          class="proof-img"
        />
      </div>
      <div v-else style="color:#909399;text-align:center;padding:16px 0;">—</div>
      <div style="margin-top:10px;font-size:12px;color:#909399;">采购方提交售后时拍摄</div>
    </el-dialog>

    <!-- 处理弹窗（卡AE：「处理完成」为核心动作；处理说明必填、金额/方式选填 + 二次确认） -->
    <el-dialog v-model="handleVisible" :title="`处理售后工单 #${handleForm.id ?? ''}`" width="560px">
      <el-form label-width="102px">
        <!-- 工单摘要（照原型 C2 的 sum 区） -->
        <div class="admin-aftersale-sum">
          <div><span>订单号：</span>{{ handleCtx.orderLabel }}</div>
          <div><span>餐馆：</span>{{ handleCtx.shopName || '—' }}</div>
          <div><span>供应商：</span>{{ handleCtx.supplierText }}</div>
          <div><span>商品：</span>{{ handleCtx.itemName || '—' }}</div>
          <div><span>客户填写数量：</span>{{ handleCtx.qtyDiff }} 斤</div>
          <div>
            <span>凭证：</span>
            <el-button v-if="handleCtx.photoCount" link type="primary" @click="openPhotos(handleRow)">
              {{ handleCtx.photoCount }} 张（点开看）
            </el-button>
            <span v-else>—</span>
          </div>
          <div style="grid-column: span 2"><span>客户原因：</span>{{ handleCtx.reason || '—' }}</div>
        </div>

        <el-form-item label="处理动作">
          <el-radio-group v-model="handleForm.action">
            <el-radio value="compensate">处理完成</el-radio>
            <el-radio value="reject">驳回</el-radio>
            <el-radio value="close">直接关闭</el-radio>
          </el-radio-group>
        </el-form-item>

        <template v-if="handleForm.action === 'compensate'">
          <el-form-item label="处理说明" required>
            <el-input
              v-model="handleForm.handleRemark"
              type="textarea"
              :rows="3"
              placeholder="写清线下怎么谈的：如「已微信退 12 元」「下次补 5 斤」"
              maxlength="255"
              show-word-limit
            />
            <div class="admin-aftersale-field-hint">
              这段话<b>客户和供应商都会看到</b>
            </div>
          </el-form-item>
          <el-form-item label="补偿金额">
            <el-input-number v-model="handleForm.compensateAmount" :min="0" :precision="2" :step="1" placeholder="选填" />
          </el-form-item>
          <el-form-item label="补偿方式">
            <el-select v-model="handleForm.compensateMethod" placeholder="选填（不选 = 仅致歉）" clearable style="width: 240px">
              <el-option label="退款" :value="1" />
              <el-option label="补货" :value="2" />
              <el-option label="下次账单抵扣" :value="3" />
            </el-select>
            <div class="admin-aftersale-field-hint">
              可选项：退款 / 补货 / 下次账单抵扣 / <b>仅致歉</b>（= 不选方式）。
              系统只记录，<b>不自动退钱、不动账单</b>
            </div>
          </el-form-item>

          <el-alert
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom: 12px"
            title="处理后客户与供应商都会看到这段说明，工单转「已解决」不可再改"
          />
          <el-checkbox v-model="handleForm.confirmed">我确认这段说明可以给客户和供应商看到</el-checkbox>
        </template>

        <template v-else>
          <el-form-item :label="handleForm.action === 'reject' ? '驳回原因' : '处理说明'" :required="handleForm.action === 'reject'">
            <el-input
              v-model="handleForm.handleRemark"
              type="textarea"
              :rows="3"
              :placeholder="handleForm.action === 'reject' ? '驳回必须填写原因（客户会看到）' : '选填'"
              maxlength="255"
              show-word-limit
            />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="handleVisible = false">取消</el-button>
        <el-button type="primary" :loading="handling" @click="submitHandle">
          {{ handleForm.action === 'compensate' ? '处理完成' : '提交处理' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { aftersaleAdminApi, userAdminApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const statusFilter = ref('')
const typeFilter = ref(null)
// 卡AE：供应商筛选（空 = 全部供应商）
const supplierFilter = ref(null)
const suppliers = ref([])

const detailVisible = ref(false)
const detail = ref(null)

const handleVisible = ref(false)
const handling = ref(false)
const handleRow = ref(null)
// 工单摘要（进弹窗时按行数据 + 详情接口补齐「商品名」）
const handleCtx = ref({})
// 卡AE：补偿金额/方式**选填**；confirmed = 二次确认勾选（处理完成必勾）
const handleForm = ref({ id: null, action: 'compensate', compensateAmount: null, compensateMethod: null, handleRemark: '', confirmed: false })

// ── 售后凭证照片（只读查看）──
const photosDialog = ref(false)
const photosRow = ref(null)
// 上传返回的是相对路径 /uploads/xxx：开发走 vite 代理、生产与 API 同源，直接用即可（同 OrderFulfill.vue 凭证写法）
function openPhotos(row) {
  photosRow.value = row
  photosDialog.value = true
}

// 补偿方式为空 = 仅致歉（卡AE 口径：不新增 compensate_method=4，空就是仅致歉）
function methodText(m) {
  return m === 1 ? '退款' : m === 2 ? '补货' : m === 3 ? '下次账单抵扣' : '仅致歉'
}

function onFilterChange() {
  page.value = 1
  load()
}

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (statusFilter.value !== '') params.status = statusFilter.value
    if (typeFilter.value) params.type = typeFilter.value
    if (supplierFilter.value) params.supplierId = supplierFilter.value
    // 注意：request 拦截器已解包 { code, msg, data }，这里直接取 list / total
    const data = await aftersaleAdminApi.list(params)
    list.value = data.list || []
    total.value = data.total || 0
  } finally {
    loading.value = false
  }
}

// 供应商下拉数据源（复用既有 /admin/suppliers，不新增接口）
async function loadSuppliers() {
  try {
    suppliers.value = (await userAdminApi.getSuppliers()) || []
  } catch (e) {
    suppliers.value = []
  }
}

async function openDetail(row) {
  // 同上：拦截器已解包，detail 接口直接返回 VO，取 res 而非 res.data
  detail.value = await aftersaleAdminApi.detail(row.aftersaleId)
  detailVisible.value = true
}

async function openHandle(row) {
  handleRow.value = row
  handleForm.value = {
    id: row.aftersaleId,
    action: 'compensate',
    // 金额/方式默认留空（口径：选填；不填即「仅致歉」）
    compensateAmount: null,
    compensateMethod: null,
    handleRemark: '',
    confirmed: false,
  }
  handleCtx.value = {
    orderLabel: `${row.orderId}（${row.deliveryDate || '—'}）`,
    shopName: row.shopName,
    supplierText: row.supplierAssigned ? row.supplierName : '待分派',
    itemName: '',
    qtyDiff: row.qtyDiff,
    photoCount: (row.attachments || []).length,
    reason: row.reason,
  }
  handleVisible.value = true
  // 详情接口补齐「商品名」（列表行不带商品名）
  try {
    const d = await aftersaleAdminApi.detail(row.aftersaleId)
    const it = (d.orderItems || []).find((x) => Number(x.orderItemId) === Number(row.orderItemId))
    handleCtx.value.itemName = it?.name || ''
    handleCtx.value.supplierText = d.supplierAssigned ? d.supplierName : '待分派'
  } catch (e) { /* 补齐失败不阻塞处理 */ }
}

async function submitHandle() {
  const f = handleForm.value
  const remark = (f.handleRemark || '').trim()
  // 卡AE 6f：处理完成**处理说明必填**；补偿金额/方式选填
  if (f.action === 'compensate') {
    if (!remark) { ElMessage.warning('请填写处理说明'); return }
    if (!f.confirmed) { ElMessage.warning('请先勾选确认：这段说明客户和供应商都会看到'); return }
  }
  if (f.action === 'reject' && !remark) {
    ElMessage.warning('驳回必须填写原因')
    return
  }
  handling.value = true
  try {
    await aftersaleAdminApi.handle(f.id, {
      action: f.action,
      // 空值一律不传 → 后端落 null（方式为空 = 仅致歉）
      compensateAmount: f.action === 'compensate' && f.compensateAmount != null ? f.compensateAmount : undefined,
      compensateMethod: f.action === 'compensate' && f.compensateMethod != null ? f.compensateMethod : undefined,
      handleRemark: remark || undefined,
    })
    ElMessage.success('处理完成，已留痕审计日志')
    handleVisible.value = false
    detailVisible.value = false
    load()
  } finally {
    handling.value = false
  }
}

function statusTagType(s) {
  if (s === 0) return 'warning'
  if (s === 2) return 'success'
  if (s === 3) return 'info'
  return 'primary'
}

function typeTagType(t) {
  return t === 1 ? 'warning' : t === 2 ? 'danger' : t === 3 ? 'danger' : 'info'
}

function fmtTime(s) {
  if (!s) return '-'
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}

onMounted(async () => {
  await Promise.all([load(), loadSuppliers()])
})
</script>

<style scoped>
.admin-aftersale-page { padding: 0; }
.admin-aftersale-crumb { font-size: 13px; color: #909399; margin-bottom: 16px; }
.admin-aftersale-filter-card { margin-bottom: 16px; }
.admin-aftersale-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.admin-aftersale-table-card { margin-bottom: 24px; }
.admin-aftersale-sub-title { font-size: 14px; font-weight: 600; margin: 14px 0 8px; color: #303133; }
.admin-aftersale-block { font-size: 13px; color: #303133; line-height: 1.8; }
.admin-aftersale-muted { font-size: 12px; color: #909399; margin-top: 6px; }
.admin-aftersale-photos { display: flex; gap: 8px; margin-top: 8px; }
.admin-aftersale-thumb { width: 56px; height: 56px; border-radius: 6px; cursor: zoom-in; }
/* 处理时间线（卡AE 新增） */
.admin-aftersale-timeline { padding: 2px 0 4px; }
.admin-aftersale-tl-row { display: flex; gap: 8px; padding: 4px 0; font-size: 13px; color: #303133; }
.admin-aftersale-tl-row em { font-style: normal; color: #909399; font-size: 12px; }
.admin-aftersale-dot { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex: 0 0 auto; }
.admin-aftersale-dot.gray { background: #d3d4d6; }
.admin-aftersale-dot.green { background: #67c23a; }
/* 处理弹窗摘要块 */
.admin-aftersale-sum { background: #f7f9fc; border: 1px solid #ebeef5; border-radius: 5px; padding: 10px 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; margin-bottom: 14px; }
.admin-aftersale-sum div { font-size: 12px; color: #303133; }
.admin-aftersale-sum div span { color: #909399; }
.admin-aftersale-field-hint { font-size: 11.5px; color: #909399; line-height: 1.6; margin-top: 4px; }
.admin-aftersale-field-hint b { color: #e6a23c; }
.proof-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.proof-img { width: 220px; height: 220px; border-radius: 8px; cursor: zoom-in; }
</style>
