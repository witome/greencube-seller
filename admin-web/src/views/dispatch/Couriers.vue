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
        <el-table-column label="车辆类型" width="110">
          <template #default="{ row }">{{ vehicleText(row.vehicleType) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '正常' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="view(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无配送员" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { userAdminApi } from '../../api/modules'

const list = ref([])
const loading = ref(false)

const vehicleText = (v) => ({ 1: '电动车', 2: '面包车', 3: '货车' }[v] || '—')

function view(row) {
  ElMessage.info(`配送员 #${row.courierId} · ${row.source === 1 ? '平台自营' : '申请制'}`)
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
