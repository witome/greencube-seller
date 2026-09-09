<template>
  <div>
    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="courierId" label="ID" width="70" />
        <el-table-column label="联系方式" min-width="160">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column label="来源" width="110">
          <template #default="{ row }">
            <el-tag :type="row.source === 1 ? '' : 'success'" size="small" effect="plain">
              {{ row.source === 1 ? '平台自营' : '申请制' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="车辆类型" width="100">
          <template #default="{ row }">{{ vehicleText(row.vehicleType) }}</template>
        </el-table-column>
        <el-table-column label="自有车辆" width="100">
          <template #default="{ row }">{{ row.ownVehicle === 1 ? '有' : '无' }}</template>
        </el-table-column>
        <el-table-column label="驾驶证" width="130">
          <template #default="{ row }">
            <template v-if="row.hasDriverLicense === 1">{{ row.licenseType || '有' }}</template>
            <template v-else>无</template>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="view(row)">详情</el-button>
            <el-button link type="success" @click="openEdit(row)">编辑</el-button>
            <template v-if="row.status === 0">
              <el-button link type="success" @click="setStatus(row, 1)">通过</el-button>
              <el-button link type="danger" @click="setStatus(row, 9)">驳回</el-button>
            </template>
            <el-button v-else-if="row.status === 1" link type="danger" @click="setStatus(row, 2)">停用</el-button>
            <el-button v-else-if="row.status === 2" link type="success" @click="setStatus(row, 1)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无配送员" />
    </el-card>

    <!-- 编辑配送员弹窗 -->
    <el-dialog v-model="editDialog" title="编辑配送员信息" width="560px">
      <el-form label-width="100px">
        <el-form-item label="姓名">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="editForm.phone" maxlength="11" />
        </el-form-item>
        <el-form-item label="身份证号">
          <el-input v-model="editForm.idCardNo" />
        </el-form-item>
        <el-form-item label="自有车辆">
          <el-radio-group v-model="editForm.ownVehicle">
            <el-radio :value="1">有</el-radio>
            <el-radio :value="0">无</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editForm.ownVehicle === 1" label="车辆类型">
          <el-select v-model="editForm.vehicleType" style="width: 200px">
            <el-option label="电动自行车" :value="1" />
            <el-option label="三轮车" :value="2" />
            <el-option label="面包车" :value="3" />
            <el-option label="小货车" :value="4" />
            <el-option label="其他" :value="5" />
          </el-select>
        </el-form-item>
        <el-form-item label="驾驶证">
          <el-radio-group v-model="editForm.hasDriverLicense">
            <el-radio :value="1">有</el-radio>
            <el-radio :value="0">无</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editForm.hasDriverLicense === 1" label="驾驶证类型">
          <el-select v-model="editForm.licenseType" style="width: 200px">
            <el-option v-for="lt in ['C1', 'C2', 'B2', 'A1', 'A2', 'D']" :key="lt" :label="lt" :value="lt" />
          </el-select>
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
import { userAdminApi } from '../../api/modules'

const list = ref([])
const loading = ref(false)

// ── 编辑配送员 ──
const editDialog = ref(false)
const editSaving = ref(false)
const editForm = reactive({ courierId: null, name: '', phone: '', idCardNo: '', vehicleType: 1, ownVehicle: 1, hasDriverLicense: 1, licenseType: 'C1' })

const vehicleText = (v) => ({ 1: '电动自行车', 2: '三轮车', 3: '面包车', 4: '小货车', 5: '其他' }[v] || '—')
const statusText = (s) => ({ 0: '待审核', 1: '正常', 2: '停用', 9: '黑名单' }[s] || '未知')
const statusType = (s) => ({ 0: 'warning', 1: 'success', 2: 'info', 9: 'danger' }[s] || 'info')

function view(row) {
  ElMessage.info(`配送员 #${row.courierId} · ${row.source === 1 ? '平台自营' : '申请制'}`)
}

// ── 编辑配送员 ──
function openEdit(row) {
  editForm.courierId = row.courierId
  editForm.name = row.name || ''
  editForm.phone = row.phone || ''
  editForm.idCardNo = row.idCardNo || ''
  editForm.vehicleType = row.vehicleType || 1
  editForm.ownVehicle = row.ownVehicle === 1 ? 1 : 0
  editForm.hasDriverLicense = row.hasDriverLicense === 1 ? 1 : 0
  editForm.licenseType = row.licenseType || 'C1'
  editDialog.value = true
}

async function submitEdit() {
  if (!editForm.phone) {
    ElMessage.warning('手机号不能为空')
    return
  }
  editSaving.value = true
  try {
    await userAdminApi.updateCourier(editForm.courierId, {
      name: editForm.name,
      phone: editForm.phone,
      idCardNo: editForm.idCardNo,
      vehicleType: editForm.vehicleType,
      ownVehicle: editForm.ownVehicle,
      hasDriverLicense: editForm.hasDriverLicense,
      licenseType: editForm.hasDriverLicense === 1 ? editForm.licenseType : null,
    })
    ElMessage.success('已保存')
    editDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    editSaving.value = false
  }
}

async function setStatus(row, status) {
  try {
    await userAdminApi.updateCourierStatus(row.courierId, status)
    ElMessage.success(`已${status === 1 ? '通过' : status === 2 ? '停用' : status === 9 ? '驳回（拉黑）' : '恢复'}`)
    load()
  } catch (e) { /* 已提示 */ }
}

async function load() {
  loading.value = true
  try {
    list.value = await userAdminApi.getCouriers()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

onMounted(load)
</script>
