<template>
  <div>
    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="supplierId" label="ID" width="70" />
        <el-table-column prop="stallName" label="档口名称" min-width="160" />
        <el-table-column prop="phone" label="手机号" width="140">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="view(row)">详情</el-button>
            <el-button link type="warning" @click="openAuth(row)">分类授权</el-button>
            <el-button v-if="row.status === 1" link type="danger" @click="toggle(row)">停合作</el-button>
            <el-button v-else link type="success" @click="toggle(row)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无供应商" />
    </el-card>

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

const statusText = (s) => ({ 0: '待审核', 1: '合作中', 2: '停合作' }[s] || '未知')
const statusType = (s) => ({ 0: 'warning', 1: 'success', 2: 'info' }[s] || 'info')

function view(row) {
  ElMessage.info(`${row.stallName} · 状态：${statusText(row.status)}`)
}

function toggle(row) {
  ElMessage.info('状态变更接口待接（后端 supplier 状态更新接口待补）')
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
