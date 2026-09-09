<template>
  <div>
    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="supplierId" label="ID" width="70" />
        <el-table-column prop="stallName" label="档口名称" min-width="150" />
        <el-table-column prop="address" label="档口地址" min-width="200">
          <template #default="{ row }">{{ row.address || '—' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" width="140">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="view(row)">详情</el-button>
            <el-button link type="success" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" @click="openAuth(row)">分类授权</el-button>
            <template v-if="row.status === 0">
              <el-button link type="success" @click="setStatus(row, 1)">通过</el-button>
              <el-button link type="danger" @click="setStatus(row, 2)">驳回</el-button>
            </template>
            <el-button v-else-if="row.status === 1" link type="danger" @click="setStatus(row, 2)">停合作</el-button>
            <el-button v-else-if="row.status === 2" link type="success" @click="setStatus(row, 1)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无供应商" />
    </el-card>

    <!-- 编辑供应商弹窗 -->
    <el-dialog v-model="editDialog" title="编辑供应商信息" width="560px">
      <el-form label-width="100px">
        <el-form-item label="档口名称">
          <el-input v-model="editForm.stallName" />
        </el-form-item>
        <el-form-item label="档口地址">
          <el-input v-model="editForm.address" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="editForm.contact" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="editForm.phone" maxlength="11" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分类授权弹窗 -->
    <el-dialog v-model="authDialog" :title="`分类授权 · ${currentSupplier?.stallName || ''}`" width="480px">
      <p class="auth-tip">勾选该供应商可发布的商品分类（未勾选的分类将无法发布商品）</p>
      <el-checkbox-group v-model="authForm.categoryIds">
        <el-checkbox v-for="c in categories" :key="c.id" :value="c.id" class="auth-checkbox">
          {{ c.name }}
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="authDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="saveAuth">保存授权</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { userAdminApi, categoryAdminApi } from '../../api/modules'

const list = ref([])
const categories = ref([])
const loading = ref(false)
const submitting = ref(false)

const authDialog = ref(false)
const currentSupplier = ref(null)
const authForm = reactive({ categoryIds: [] })

// ── 编辑供应商 ──
const editDialog = ref(false)
const editSaving = ref(false)
const editForm = reactive({ supplierId: null, stallName: '', address: '', contact: '', phone: '' })

const statusText = (s) => ({ 0: '待审核', 1: '合作中', 2: '停合作' }[s] || '未知')
const statusType = (s) => ({ 0: 'warning', 1: 'success', 2: 'info' }[s] || 'info')

function view(row) {
  ElMessage.info(`${row.stallName} · 状态：${statusText(row.status)}`)
}

async function setStatus(row, status) {
  try {
    await userAdminApi.updateSupplierStatus(row.supplierId, status)
    ElMessage.success(`已${status === 1 ? '通过' : status === 2 ? '驳回/停合作' : '恢复'}`)
    load()
  } catch (e) { /* 已提示 */ }
}

async function openAuth(row) {
  currentSupplier.value = row
  authForm.categoryIds = []
  try {
    const authorized = await categoryAdminApi.getSupplierCategories(row.supplierId)
    authForm.categoryIds = authorized.map((c) => c.categoryId)
  } catch (e) { /* 忽略 */ }
  authDialog.value = true
}

async function saveAuth() {
  submitting.value = true
  try {
    await categoryAdminApi.setSupplierCategories(currentSupplier.value.supplierId, authForm.categoryIds)
    ElMessage.success('分类授权已保存')
    authDialog.value = false
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

// ── 编辑供应商 ──
function openEdit(row) {
  editForm.supplierId = row.supplierId
  editForm.stallName = row.stallName || ''
  editForm.address = row.address || ''
  editForm.contact = row.contact || ''
  editForm.phone = row.phone || ''
  editDialog.value = true
}

async function submitEdit() {
  if (!editForm.stallName) {
    ElMessage.warning('档口名称不能为空')
    return
  }
  editSaving.value = true
  try {
    await userAdminApi.updateSupplier(editForm.supplierId, {
      stallName: editForm.stallName,
      address: editForm.address,
      contact: editForm.contact,
      phone: editForm.phone,
    })
    ElMessage.success('已保存')
    editDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    editSaving.value = false
  }
}

async function load() {
  loading.value = true
  try {
    list.value = await userAdminApi.getSuppliers()
    categories.value = await categoryAdminApi.getCategories()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.auth-tip { color: #909399; font-size: 13px; margin-bottom: 12px; }
.auth-checkbox { display: flex; margin-right: 16px; margin-bottom: 8px; }
</style>
