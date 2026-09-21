<template>
  <div class="admin-buyers-page">
    <!-- 面包屑 -->
    <div class="admin-buyers-crumb">基础资料 / 采购方管理（注册须经线下核实激活）</div>

    <!-- 顶部统计（真实接口；点击跳对应筛选） -->
    <div class="admin-buyers-stats">
      <div class="admin-buyers-stat" @click="filterBy(1)">
        <div class="admin-buyers-stat-num admin-buyers-num-orange">{{ fmtNum(stats.pending) }}</div>
        <div class="admin-buyers-stat-lbl">待审核</div>
      </div>
      <div class="admin-buyers-stat" @click="filterBy(1)">
        <div class="admin-buyers-stat-num admin-buyers-num-red">{{ fmtNum(stats.overdue) }}</div>
        <div class="admin-buyers-stat-lbl">超时（待审超24h）</div>
      </div>
      <div class="admin-buyers-stat" @click="filterBy(3)">
        <div class="admin-buyers-stat-num admin-buyers-num-blue">{{ fmtNum(stats.appeal) }}</div>
        <div class="admin-buyers-stat-lbl">待申诉复核</div>
      </div>
    </div>

    <!-- 状态筛选 -->
    <el-card shadow="never" class="admin-buyers-filter-card">
      <div class="admin-buyers-filter">
        <el-radio-group v-model="statusFilter" @change="load">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="1">待审核</el-radio-button>
          <el-radio-button :value="3">已驳回</el-radio-button>
          <el-radio-button :value="2">已开通</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="keyword"
          placeholder="搜索餐馆名 / 联系人 / 手机号"
          clearable
          style="width: 260px; margin-left: 16px"
          @keyup.enter="load"
          @clear="load"
        />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="admin-buyers-table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="餐馆" min-width="160">
          <template #default="{ row }">
            <div class="admin-buyers-shop">{{ row.shopName }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="contact" label="联系人" width="90" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column prop="address" label="收货地址" min-width="180">
          <template #default="{ row }">{{ row.address || '-' }}</template>
        </el-table-column>
        <el-table-column label="注册时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.registeredAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ row.statusText }}
              <span v-if="row.overdue" style="margin-left: 4px">⏰超时</span>
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 1" type="primary" link @click="openVerifyDrawer(row)">核实</el-button>
            <el-button v-else-if="row.status === 3" type="warning" link @click="openVerifyDrawer(row)">复核申诉</el-button>
            <el-button v-else type="primary" link @click="openVerifyDrawer(row)">详情</el-button>
            <el-button type="success" link @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="admin-buyers-pager"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="onPage"
      />
    </el-card>

    <!-- 核实详情抽屉（单页内打开，不跳转） -->
    <el-drawer v-model="verifyDrawer" :title="'核实详情 · ' + (detail.shopName || '…')" size="640px">
      <div v-loading="detailLoading">
        <!-- 风险预检 -->
        <el-alert
          v-if="detail.riskHints && detail.riskHints.length"
          type="error"
          :closable="false"
          class="admin-buyers-risk"
          title="系统风险预检"
          :description="detail.riskHints.join('；')"
          show-icon
        />

        <!-- 基本信息 -->
        <el-card shadow="never" class="admin-buyers-section">
          <template #header>
            <div class="admin-buyers-card-head">
              <span>餐馆资料</span>
              <el-tag :type="statusType(detail.accountStatus)" size="small">{{ statusText(detail.accountStatus) }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="餐馆名称">{{ detail.shopName }}</el-descriptions-item>
            <el-descriptions-item label="联系人">{{ detail.contact }}</el-descriptions-item>
            <el-descriptions-item label="手机号">{{ detail.phone }}</el-descriptions-item>
            <el-descriptions-item label="注册时间">{{ fmtTime(detail.registeredAt) }}</el-descriptions-item>
            <el-descriptions-item label="收货地址" :span="2">{{ detail.address || '-' }}</el-descriptions-item>
            <el-descriptions-item label="营业执照号">{{ detail.businessLicenseNo || '-' }}</el-descriptions-item>
            <el-descriptions-item label="常用收货时段">{{ fmtWindows(detail.deliveryWindows) }}</el-descriptions-item>
          </el-descriptions>
          <div class="admin-buyers-imgs" v-if="detail.licenseImg || detail.permitImg">
            <div class="admin-buyers-img-box" v-if="detail.licenseImg">
              <div class="admin-buyers-img-label">营业执照</div>
              <el-image :src="detail.licenseImg" fit="cover" class="admin-buyers-img" />
            </div>
            <div class="admin-buyers-img-box" v-if="detail.permitImg">
              <div class="admin-buyers-img-label">食品经营许可证</div>
              <el-image :src="detail.permitImg" fit="cover" class="admin-buyers-img" />
            </div>
          </div>
        </el-card>

        <!-- 核实历史 -->
        <el-card shadow="never" class="admin-buyers-section" v-if="detail.history && detail.history.length">
          <template #header>核实记录</template>
          <el-timeline>
            <el-timeline-item
              v-for="h in detail.history"
              :key="h.id"
              :type="h.result === 1 ? 'success' : 'danger'"
              :timestamp="fmtTime(h.createdAt)"
            >
              {{ methodText(h.methods) }} · {{ h.result === 1 ? '通过' : '驳回' }}
              <span v-if="h.reasonText" style="color:#909399">（{{ h.reasonText }}）</span>
            </el-timeline-item>
          </el-timeline>
        </el-card>

        <!-- 操作区 -->
        <el-card shadow="never" class="admin-buyers-section">
          <template #header>核实操作</template>
          <div v-if="detail.accountStatus === 1">
            <el-button type="success" @click="openVerify(1)">✓ 核实通过</el-button>
            <el-button type="danger" @click="openVerify(2)">✕ 驳回</el-button>
          </div>
          <div v-else-if="detail.accountStatus === 3">
            <el-alert type="info" :closable="false" title="该餐馆已发起申诉，请复核" class="admin-buyers-mb" />
            <el-button type="success" @click="openAppeal(true)">通过申诉（激活）</el-button>
            <el-button type="danger" @click="openAppeal(false)">驳回申诉（冻结 60 天）</el-button>
          </div>
          <el-empty v-else description="该账号已激活，无需核实" />
        </el-card>
      </div>
    </el-drawer>

    <!-- 核实/驳回 弹窗 -->
    <el-dialog v-model="verifyDialog" :title="verifyForm.result === 1 ? '核实通过' : '驳回'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="核实方式" required>
          <el-checkbox-group v-model="verifyForm.methods">
            <el-checkbox :value="1">电话</el-checkbox>
            <el-checkbox :value="2">上门</el-checkbox>
            <el-checkbox :value="3">视频</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item v-if="verifyForm.result === 2" label="驳回原因" required>
          <el-select v-model="verifyForm.reasonCode" placeholder="选择原因">
            <el-option v-for="(t, c) in reasonMap" :key="c" :label="t" :value="Number(c)" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="verifyForm.remark" type="textarea" :rows="3" placeholder="核实情况备注（驳回时必填说明）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="verifyDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitVerify">提交</el-button>
      </template>
    </el-dialog>

    <!-- 申诉复核弹窗 -->
    <el-dialog v-model="appealDialog" :title="appealApproved ? '通过申诉' : '驳回申诉'" width="480px">
      <p style="color:#606266; margin-bottom: 12px">
        {{ appealApproved ? '确认通过申诉并激活该账号？' : '确认驳回申诉？该账号将被冻结 60 天。' }}
      </p>
      <el-input v-model="appealComment" type="textarea" :rows="3" placeholder="复核意见" />
      <template #footer>
        <el-button @click="appealDialog = false">取消</el-button>
        <el-button :type="appealApproved ? 'success' : 'danger'" :loading="submitting" @click="submitAppeal">
          确认
        </el-button>
      </template>
    </el-dialog>

    <!-- 编辑采购方弹窗 -->
    <el-dialog v-model="editDialog" title="编辑采购方信息" width="560px">
      <el-form label-width="100px">
        <el-form-item label="餐馆名称">
          <el-input v-model="editForm.shopName" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="editForm.contact" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="editForm.phone" maxlength="11" />
        </el-form-item>
        <el-form-item label="收货地址">
          <el-input v-model="editForm.address" />
        </el-form-item>
        <el-form-item label="营业执照号">
          <el-input v-model="editForm.businessLicenseNo" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { buyerAdminApi } from '../../api/modules'

// ── 列表 ──
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const statusFilter = ref('')
const keyword = ref('')
const stats = ref({ pending: null, appeal: null, overdue: null })

// ── 核实详情 ──
const verifyDrawer = ref(false)
const verifyId = ref('')
const detail = ref({})
const detailLoading = ref(false)
const submitting = ref(false)
const verifyDialog = ref(false)
const verifyForm = reactive({ result: 1, methods: [], reasonCode: null, remark: '' })
const appealDialog = ref(false)
const appealApproved = ref(true)
const appealComment = ref('')

// ── 编辑采购方 ──
const editDialog = ref(false)
const editSaving = ref(false)
const editForm = reactive({ purchaserId: null, shopName: '', contact: '', phone: '', address: '', businessLicenseNo: '' })

const reasonMap = {
  1: '执照不符',
  2: '电话无人接',
  3: '地址不实',
  4: '非餐饮',
  5: '重复申请',
  6: '资料不全',
  9: '其他',
}

function fmtNum(v) {
  if (v === null) return '…'
  if (v < 0) return '—'
  return v
}

function statusType(status) {
  if (status === 1) return 'warning'
  if (status === 2) return 'success'
  if (status === 3) return 'danger'
  return 'info'
}

function statusText(status) {
  if (status === 1) return '待审核'
  if (status === 2) return '已激活'
  if (status === 3) return '已驳回'
  return '未知'
}

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtWindows(w) {
  if (!w) return '-'
  if (Array.isArray(w)) return w.join('、') || '-'
  if (typeof w === 'object') return JSON.stringify(w)
  return String(w)
}

function methodText(methods) {
  if (!methods || !methods.length) return '未记录'
  const map = { 1: '电话', 2: '上门', 3: '视频' }
  return methods.map((m) => map[m] || m).join('+')
}

function filterBy(status) {
  statusFilter.value = status
  load()
}

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (statusFilter.value !== '') params.status = statusFilter.value
    const data = await buyerAdminApi.getPendingBuyers(params)
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    /* 已提示 */
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const p = await buyerAdminApi.getPendingBuyers({ status: 1, page: 1, pageSize: 1 })
    stats.value.pending = p?.total ?? 0
    // 超时口径由后端统一给出：待审核 且 注册超过 24 小时（与列表行级 overdue 判定同口径）
    stats.value.overdue = p?.stats?.overdueCount ?? 0
  } catch (e) {
    stats.value.pending = -1
    stats.value.overdue = -1
  }
  try {
    const a = await buyerAdminApi.getPendingBuyers({ status: 3, page: 1, pageSize: 1 })
    stats.value.appeal = a?.total ?? 0
  } catch (e) {
    stats.value.appeal = -1
  }
}

function onPage(p) {
  page.value = p
  load()
}

// ── 核实详情（抽屉内） ──
function openVerifyDrawer(row) {
  verifyId.value = row.purchaserId
  verifyDrawer.value = true
  loadDetail()
}

async function loadDetail() {
  detailLoading.value = true
  detail.value = {}
  try {
    detail.value = await buyerAdminApi.getBuyerVerifyDetail(verifyId.value)
  } catch (e) {
    /* 已提示 */
  } finally {
    detailLoading.value = false
  }
}

function openVerify(result) {
  verifyForm.result = result
  verifyForm.methods = []
  verifyForm.reasonCode = null
  verifyForm.remark = ''
  verifyDialog.value = true
}

async function submitVerify() {
  if (!verifyForm.methods.length) {
    ElMessage.warning('请至少选择一种核实方式')
    return
  }
  if (verifyForm.result === 2 && !verifyForm.reasonCode) {
    ElMessage.warning('请选择驳回原因')
    return
  }
  if (verifyForm.result === 2 && !verifyForm.remark) {
    ElMessage.warning('请填写驳回说明')
    return
  }
  submitting.value = true
  try {
    const payload = {
      methods: verifyForm.methods,
      result: verifyForm.result,
      remark: verifyForm.remark,
    }
    if (verifyForm.result === 2) {
      payload.reasonCode = verifyForm.reasonCode
      payload.reasonText = reasonMap[verifyForm.reasonCode]
    }
    await buyerAdminApi.submitVerification(verifyId.value, payload)
    ElMessage.success(verifyForm.result === 1 ? '已通过并激活' : '已驳回')
    verifyDialog.value = false
    verifyDrawer.value = false
    load()
    loadStats()
  } catch (e) {
    /* 已提示 */
  } finally {
    submitting.value = false
  }
}

function openAppeal(approved) {
  appealApproved.value = approved
  appealComment.value = ''
  appealDialog.value = true
}

async function submitAppeal() {
  submitting.value = true
  try {
    await buyerAdminApi.reviewAppeal(verifyId.value, { approved: appealApproved.value, comment: appealComment.value })
    ElMessage.success(appealApproved.value ? '申诉通过，已激活' : '申诉驳回，已冻结')
    appealDialog.value = false
    verifyDrawer.value = false
    load()
    loadStats()
  } catch (e) {
    /* 已提示 */
  } finally {
    submitting.value = false
  }
}

// ── 编辑采购方 ──
function openEdit(row) {
  editForm.purchaserId = row.purchaserId
  editForm.shopName = row.shopName || ''
  editForm.contact = row.contact || ''
  editForm.phone = row.phone || ''
  editForm.address = row.address || ''
  editForm.businessLicenseNo = ''
  editDialog.value = true
}

async function submitEdit() {
  if (!editForm.shopName || !editForm.contact || !editForm.phone) {
    ElMessage.warning('餐馆名称、联系人、手机号不能为空')
    return
  }
  editSaving.value = true
  try {
    await buyerAdminApi.updateBuyer(editForm.purchaserId, {
      shopName: editForm.shopName,
      contact: editForm.contact,
      phone: editForm.phone,
      address: editForm.address,
      businessLicenseNo: editForm.businessLicenseNo,
    })
    ElMessage.success('已保存')
    editDialog.value = false
    load()
  } catch (e) {
    /* 已提示 */
  } finally {
    editSaving.value = false
  }
}

onMounted(() => {
  load()
  loadStats()
})
</script>

<style scoped>
.admin-buyers-page {
  max-width: 1280px;
  margin: 0 auto;
}
.admin-buyers-crumb {
  font-size: 13px;
  color: #8a9099;
  margin-bottom: 14px;
}
.admin-buyers-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}
.admin-buyers-stat {
  flex: 1;
  max-width: 200px;
  background: #fff;
  border-radius: 12px;
  padding: 14px 8px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.admin-buyers-stat:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.admin-buyers-stat-num {
  font-size: 24px;
  font-weight: 800;
}
.admin-buyers-num-orange {
  color: #ff8f1f;
}
.admin-buyers-num-blue {
  color: #3b7cff;
}
.admin-buyers-num-red {
  color: #f56c6c;
}
.admin-buyers-stat-lbl {
  font-size: 12px;
  color: #8a9099;
  margin-top: 4px;
}
.admin-buyers-filter-card {
  margin-bottom: 16px;
}
.admin-buyers-filter {
  display: flex;
  align-items: center;
}
.admin-buyers-table-card {
  overflow: hidden;
}
.admin-buyers-shop {
  font-weight: 600;
}
.admin-buyers-pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.admin-buyers-risk {
  margin-bottom: 16px;
}
.admin-buyers-section {
  margin-bottom: 16px;
}
.admin-buyers-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.admin-buyers-imgs {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}
.admin-buyers-img-box {
  width: 180px;
}
.admin-buyers-img-label {
  color: #909399;
  font-size: 12px;
  margin-bottom: 6px;
}
.admin-buyers-img {
  width: 180px;
  height: 120px;
  border-radius: 6px;
}
.admin-buyers-mb {
  margin-bottom: 16px;
}
</style>
