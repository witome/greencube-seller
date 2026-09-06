<template>
  <div v-loading="loading">
    <!-- 风险预检 -->
    <el-alert
      v-if="detail.riskHints && detail.riskHints.length"
      type="error"
      :closable="false"
      class="risk-alert"
      title="系统风险预检"
      :description="detail.riskHints.join('；')"
      show-icon
    />

    <!-- 基本信息 -->
    <el-card shadow="never" class="section">
      <template #header>
        <div class="card-head">
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
      <div class="imgs" v-if="detail.licenseImg || detail.permitImg">
        <div class="img-box" v-if="detail.licenseImg">
          <div class="img-label">营业执照</div>
          <el-image :src="detail.licenseImg" fit="cover" class="img" />
        </div>
        <div class="img-box" v-if="detail.permitImg">
          <div class="img-label">食品经营许可证</div>
          <el-image :src="detail.permitImg" fit="cover" class="img" />
        </div>
      </div>
    </el-card>

    <!-- 核实历史 -->
    <el-card shadow="never" class="section" v-if="detail.history && detail.history.length">
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
    <el-card shadow="never" class="section">
      <template #header>核实操作</template>

      <!-- 待审核：通过/驳回 -->
      <div v-if="detail.accountStatus === 1">
        <el-button type="success" @click="openVerify(1)">✓ 核实通过</el-button>
        <el-button type="danger" @click="openVerify(2)">✕ 驳回</el-button>
      </div>

      <!-- 已驳回：申诉复核 -->
      <div v-else-if="detail.accountStatus === 3">
        <el-alert type="info" :closable="false" title="该餐馆已发起申诉，请复核" class="mb" />
        <el-button type="success" @click="openAppeal(true)">通过申诉（激活）</el-button>
        <el-button type="danger" @click="openAppeal(false)">驳回申诉（冻结 60 天）</el-button>
      </div>

      <el-empty v-else description="该账号已激活，无需核实" />
    </el-card>

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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { buyerAdminApi } from '../../api/modules'

const route = useRoute()
const router = useRouter()
const id = route.params.id

const detail = ref({})
const loading = ref(false)
const submitting = ref(false)

const verifyDialog = ref(false)
const verifyForm = reactive({ result: 1, methods: [], reasonCode: null, remark: '' })

const appealDialog = ref(false)
const appealApproved = ref(true)
const appealComment = ref('')

const reasonMap = {
  1: '执照不符',
  2: '电话无人接',
  3: '地址不实',
  4: '非餐饮',
  5: '重复申请',
  6: '资料不全',
  9: '其他',
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

async function load() {
  loading.value = true
  try {
    detail.value = await buyerAdminApi.getBuyerVerifyDetail(id)
  } catch (e) {
    /* 已提示 */
  } finally {
    loading.value = false
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
    await buyerAdminApi.submitVerification(id, payload)
    ElMessage.success(verifyForm.result === 1 ? '已通过并激活' : '已驳回')
    verifyDialog.value = false
    setTimeout(() => router.push('/buyers'), 400)
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
    await buyerAdminApi.reviewAppeal(id, { approved: appealApproved.value, comment: appealComment.value })
    ElMessage.success(appealApproved.value ? '申诉通过，已激活' : '申诉驳回，已冻结')
    appealDialog.value = false
    setTimeout(() => router.push('/buyers'), 400)
  } catch (e) {
    /* 已提示 */
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.risk-alert {
  margin-bottom: 16px;
}
.section {
  margin-bottom: 16px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.imgs {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}
.img-box {
  width: 180px;
}
.img-label {
  color: #909399;
  font-size: 12px;
  margin-bottom: 6px;
}
.img {
  width: 180px;
  height: 120px;
  border-radius: 6px;
}
.mb {
  margin-bottom: 16px;
}
</style>
