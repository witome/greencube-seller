<template>
  <div class="admin-appeals-page">
    <!-- 面包屑 -->
    <div class="admin-appeals-crumb">采购方管理 / 申诉处理（被驳回采购方的申诉查看与复核）</div>

    <!-- 筛选 -->
    <el-card shadow="never" class="admin-appeals-filter-card">
      <div class="admin-appeals-filter">
        <el-radio-group v-model="statusFilter" @change="onStatusChange">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="0">待处理</el-radio-button>
          <el-radio-button :value="1">已处理</el-radio-button>
        </el-radio-group>
        <!-- 日期筛选：2026-09-21 大辉改口径 → 改为**服务端**筛（后端新增可选 startDate/endDate，
             按 created_at 过滤）。原来的「当前页客户端过滤」只能筛到本页数据，跨页会漏。 -->
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="提交开始日期"
          end-placeholder="提交结束日期"
          value-format="YYYY-MM-DD"
          style="width: 260px; margin-left: 16px"
          @change="onQuery"
        />
        <el-button type="primary" @click="onQuery">查询</el-button>
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="admin-appeals-table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="appealId" label="申诉号" width="80" />
        <el-table-column prop="shopName" label="店铺名" min-width="150" show-overflow-tooltip />
        <el-table-column prop="contact" label="联系人" width="100" />
        <el-table-column prop="phone" label="电话" width="130" />
        <el-table-column label="驳回原因（提交时刻快照）" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag v-if="row.reasonCode != null" size="small" type="info" style="margin-right: 6px">{{ reasonText(row.reasonCode) }}</el-tag>
            <span>{{ row.rejectReason || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="附件" width="70">
          <template #default="{ row }">
            <span v-if="row.attachments && row.attachments.length">{{ row.attachments.length }} 张</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'warning' : 'info'" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status === 0" size="small" type="primary" @click="openHandle(row)">处理</el-button>
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
    <el-drawer v-model="detailVisible" :title="'申诉详情 · ' + (detail?.shopName || '')" size="520px">
      <template v-if="detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="申诉号">{{ detail.appealId }}</el-descriptions-item>
          <el-descriptions-item label="店铺名">{{ detail.shopName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="联系人 / 电话">{{ detail.contact || '-' }} / {{ detail.phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="账号当前状态">
            <el-tag :type="accountStatusType(detail.accountStatus)" size="small">{{ accountStatusText(detail.accountStatus) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="驳回原因（提交时刻快照）">
            <el-tag v-if="detail.reasonCode != null" size="small" type="info" style="margin-right: 6px">{{ reasonText(detail.reasonCode) }}</el-tag>{{ detail.rejectReason || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmtTime(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="处理时间">{{ detail.handledAt ? fmtTime(detail.handledAt) : '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="admin-appeals-sub-title">申诉正文</div>
        <div class="admin-appeals-text">{{ detail.text || '-' }}</div>

        <div class="admin-appeals-sub-title">附件（{{ detail.attachments.length }} 张，点击看大图）</div>
        <div v-if="detail.attachments.length" class="admin-appeals-img-grid">
          <!-- 附件路径处理照 OrderFulfill.vue 凭证图片同款：上传返回相对路径 /uploads/xxx，
               开发走 vite 代理（/uploads → 3001）、生产与 API 同源，src 直接用即可；
               兼容历史数据里的绝对 URL（http 开头原样展示） -->
          <el-image
            v-for="(p, i) in detail.attachments"
            :key="i"
            :src="p"
            :preview-src-list="detail.attachments"
            :initial-index="i"
            :preview-teleported="true"
            fit="cover"
            class="admin-appeals-img"
          >
            <template #error>
              <div class="admin-appeals-img-err">加载失败</div>
            </template>
          </el-image>
        </div>
        <div v-else style="color: #909399; font-size: 13px">无附件</div>

        <el-button
          v-if="detail.status === 0"
          type="primary"
          style="margin-top: 16px"
          @click="openHandle(detail)"
        >处理该申诉</el-button>
      </template>
    </el-drawer>

    <!-- 处理弹窗（调既有 appeal-review；提交前二次确认） -->
    <el-dialog v-model="handleVisible" title="处理申诉" width="480px">
      <el-form label-width="90px">
        <el-form-item label="复核结论">
          <el-radio-group v-model="handleForm.approved">
            <el-radio :value="true">通过申诉（激活账号）</el-radio>
            <el-radio :value="false">驳回申诉（冻结 60 天）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="复核意见">
          <el-input v-model="handleForm.comment" type="textarea" :rows="3" placeholder="选填，最长 500 字" maxlength="500" />
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
import { ElMessage, ElMessageBox } from 'element-plus'
import { buyerAdminApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const statusFilter = ref('')
// 日期筛选：2026-09-21 起由后端筛（params.startDate / endDate，按 created_at），
// 前端不再本地过滤 —— 本地过滤只能筛到当前页数据，翻页就会漏
const dateRange = ref(null)

const detailVisible = ref(false)
const detail = ref(null)

const handleVisible = ref(false)
const handling = ref(false)
const handleForm = ref({ purchaserId: null, approved: true, comment: '' })

// reasonCode 码表与采购方端/运营审核 DTO 口径一致
const REASON_TYPES = { 1: '执照不符', 2: '电话无人接', 3: '地址不实', 4: '非餐饮', 5: '重复申请', 6: '资料不全', 9: '其他' }
const reasonText = (c) => REASON_TYPES[c] || '其他'

const ACCOUNT_STATUS = { 1: '待审核', 2: '已激活', 3: '未通过', 4: '终态冻结', 5: '已停用' }
const accountStatusText = (s) => ACCOUNT_STATUS[s] ?? '未知'
const accountStatusType = (s) => (s === 2 ? 'success' : s === 1 ? 'warning' : 'danger')

async function load() {
  loading.value = true
  try {
    const params = { page: page.value, pageSize }
    if (statusFilter.value !== '') params.status = statusFilter.value
    // 日期区间改由服务端筛（2026-09-21）；未选日期时不带这两个参数 → 与改动前的查询条件一致
    if (Array.isArray(dateRange.value) && dateRange.value.length === 2) {
      params.startDate = dateRange.value[0]
      params.endDate = dateRange.value[1]
    }
    // request 拦截器已解包 { code, msg, data }，直接取 list / total
    const data = await buyerAdminApi.getAppeals(params)
    list.value = data.list || []
    total.value = data.total || 0
  } finally {
    loading.value = false
  }
}

function onStatusChange() {
  page.value = 1
  load()
}

// 查询/改日期：回到第 1 页再查（服务端筛后总页数会变，停在第 3 页容易查到空页）
function onQuery() {
  page.value = 1
  load()
}

// ⚠️ 原「日期客户端过滤（当前页）」的 displayList 已删除（2026-09-21）：
// 服务端筛后表格直接绑定 list，避免两处过滤口径并存。

function openDetail(row) {
  detail.value = row
  detailVisible.value = true
}

function openHandle(row) {
  handleForm.value = { purchaserId: row.purchaserId, approved: true, comment: '' }
  handleVisible.value = true
}

async function submitHandle() {
  const f = handleForm.value
  const conclusion = f.approved ? '通过申诉并激活该账号' : '驳回申诉（账号将冻结 60 天）'
  // 二次确认：复核直接改采购方账号状态，不可手滑
  try {
    await ElMessageBox.confirm(`确认${conclusion}？提交后立即生效并留痕审计日志。`, '二次确认', {
      confirmButtonText: '确认提交',
      cancelButtonText: '再想想',
      type: 'warning',
    })
  } catch {
    return // 用户取消
  }
  handling.value = true
  try {
    await buyerAdminApi.reviewAppeal(f.purchaserId, { approved: f.approved, comment: f.comment || undefined })
    ElMessage.success(f.approved ? '申诉通过，账号已激活' : '申诉驳回，账号已冻结')
    handleVisible.value = false
    detailVisible.value = false
    load()
  } catch (e) {
    /* 错误已由拦截器统一提示 */
  } finally {
    handling.value = false
  }
}

function fmtTime(s) {
  if (!s) return '-'
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<style scoped>
.admin-appeals-page { padding: 0; }
.admin-appeals-crumb { font-size: 13px; color: #909399; margin-bottom: 16px; }
.admin-appeals-filter-card { margin-bottom: 16px; }
.admin-appeals-filter { display: flex; align-items: center; }
.admin-appeals-table-card { margin-bottom: 24px; }
.admin-appeals-sub-title { font-size: 14px; font-weight: 600; margin: 16px 0 8px; color: #303133; }
.admin-appeals-text {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px;
  font-size: 13px;
  color: #303133;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}
.admin-appeals-img-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.admin-appeals-img { width: 140px; height: 140px; border-radius: 8px; cursor: zoom-in; }
.admin-appeals-img-err {
  width: 140px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  color: #909399;
  font-size: 12px;
}
</style>
