<template>
  <div class="admin-aftersale-page">
    <!-- 面包屑 -->
    <div class="admin-aftersale-crumb">订单履约 / 售后管理（拒收 · 少货 · 品质问题处理）</div>

    <!-- 筛选 -->
    <el-card shadow="never" class="admin-aftersale-filter-card">
      <div class="admin-aftersale-filter">
        <el-radio-group v-model="statusFilter" @change="load">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="0">待处理</el-radio-button>
          <el-radio-button :value="2">已解决</el-radio-button>
          <el-radio-button :value="3">已关闭</el-radio-button>
        </el-radio-group>
        <el-select v-model="typeFilter" placeholder="全部类型" clearable style="width: 140px; margin-left: 16px" @change="load">
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
              补偿 ¥{{ row.compensateAmount.toFixed(2) }}（{{ row.compensateMethodText }}）
            </span>
            <span v-else-if="row.handleRemark">{{ row.handleRemark }}</span>
            <span v-else>-</span>
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
          <el-descriptions-item label="类型">{{ detail.typeText }}</el-descriptions-item>
          <el-descriptions-item label="售后原因">{{ detail.reason || '-' }}</el-descriptions-item>
          <el-descriptions-item label="差异">{{ detail.qtyDiff }} 斤 / ¥{{ detail.amountDiff.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusTagType(detail.status)" size="small">{{ detail.statusText }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.compensateAmount != null" label="补偿">
            ¥{{ detail.compensateAmount.toFixed(2) }}（{{ detail.compensateMethodText }}）
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.handleRemark" label="处理备注">{{ detail.handleRemark }}</el-descriptions-item>
          <el-descriptions-item label="处理时间">{{ detail.handledAt ? fmtTime(detail.handledAt) : '-' }}</el-descriptions-item>
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
            <el-table-column label="销售价" width="80">
              <template #default="{ row }">¥{{ row.salePrice.toFixed(2) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <el-button
          v-if="detail.status === 0"
          type="primary"
          style="margin-top: 16px"
          @click="openHandle(detail)"
        >处理该工单</el-button>
      </template>
    </el-drawer>

    <!-- 处理弹窗 -->
    <el-dialog v-model="handleVisible" title="处理售后工单" width="480px">
      <el-form label-width="90px">
        <el-form-item label="处理动作">
          <el-radio-group v-model="handleForm.action">
            <el-radio value="compensate">同意补偿</el-radio>
            <el-radio value="reject">驳回</el-radio>
            <el-radio value="close">直接关闭</el-radio>
          </el-radio-group>
        </el-form-item>
        <template v-if="handleForm.action === 'compensate'">
          <el-form-item label="补偿金额">
            <el-input-number v-model="handleForm.compensateAmount" :min="0" :precision="2" :step="1" />
          </el-form-item>
          <el-form-item label="补偿方式">
            <el-select v-model="handleForm.compensateMethod" placeholder="选择补偿方式" style="width: 220px">
              <el-option label="退款" :value="1" />
              <el-option label="补货" :value="2" />
              <el-option label="下次账单抵扣" :value="3" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item :label="handleForm.action === 'reject' ? '驳回原因' : '处理备注'">
          <el-input
            v-model="handleForm.handleRemark"
            type="textarea"
            :rows="3"
            :placeholder="handleForm.action === 'reject' ? '驳回必须填写原因' : '选填'"
            maxlength="255"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handleVisible = false">取消</el-button>
        <el-button type="primary" :loading="handling" @click="submitHandle">提交处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { aftersaleAdminApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const statusFilter = ref('')
const typeFilter = ref(null)

const detailVisible = ref(false)
const detail = ref(null)

const handleVisible = ref(false)
const handling = ref(false)
const handleForm = ref({ id: null, action: 'compensate', compensateAmount: 0, compensateMethod: null, handleRemark: '' })

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (statusFilter.value !== '') params.status = statusFilter.value
    if (typeFilter.value) params.type = typeFilter.value
    const res = await aftersaleAdminApi.list(params)
    list.value = res.data.list
    total.value = res.data.total
  } finally {
    loading.value = false
  }
}

async function openDetail(row) {
  const res = await aftersaleAdminApi.detail(row.aftersaleId)
  detail.value = res.data
  detailVisible.value = true
}

function openHandle(row) {
  handleForm.value = { id: row.aftersaleId, action: 'compensate', compensateAmount: row.amountDiff, compensateMethod: null, handleRemark: '' }
  handleVisible.value = true
}

async function submitHandle() {
  const f = handleForm.value
  if (f.action === 'compensate' && (f.compensateAmount == null || f.compensateMethod == null)) {
    ElMessage.warning('同意补偿必须填写补偿金额与方式')
    return
  }
  if (f.action === 'reject' && !f.handleRemark) {
    ElMessage.warning('驳回必须填写原因')
    return
  }
  handling.value = true
  try {
    await aftersaleAdminApi.handle(f.id, {
      action: f.action,
      compensateAmount: f.action === 'compensate' ? f.compensateAmount : undefined,
      compensateMethod: f.action === 'compensate' ? f.compensateMethod : undefined,
      handleRemark: f.handleRemark || undefined,
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

onMounted(load)
</script>

<style scoped>
.admin-aftersale-page { padding: 0; }
.admin-aftersale-crumb { font-size: 13px; color: #909399; margin-bottom: 16px; }
.admin-aftersale-filter-card { margin-bottom: 16px; }
.admin-aftersale-filter { display: flex; align-items: center; }
.admin-aftersale-table-card { margin-bottom: 24px; }
.admin-aftersale-sub-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #303133; }
</style>
