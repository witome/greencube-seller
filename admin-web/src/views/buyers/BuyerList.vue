<template>
  <div>
    <!-- 状态筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="filter-bar">
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

    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="餐馆" min-width="160">
          <template #default="{ row }">
            <div class="shop">{{ row.shopName }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="contact" label="联系人" width="90" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column label="注册时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.registeredAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">
              {{ row.statusText }}
              <span v-if="row.overdue" style="margin-left:4px">⏰超时</span>
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 1" type="primary" link @click="goVerify(row)">核实</el-button>
            <el-button v-else-if="row.status === 3" type="warning" link @click="goVerify(row)">复核申诉</el-button>
            <el-button v-else type="primary" link @click="goVerify(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pager"
        layout="total, prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="onPage"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { buyerAdminApi } from '../../api/modules'

const router = useRouter()
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const loading = ref(false)
const statusFilter = ref('')
const keyword = ref('')

function statusType(status) {
  if (status === 1) return 'warning'
  if (status === 2) return 'success'
  if (status === 3) return 'danger'
  return 'info'
}

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function goVerify(row) {
  router.push(`/buyers/${row.purchaserId}/verify`)
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

function onPage(p) {
  page.value = p
  load()
}

onMounted(load)
</script>

<style scoped>
.filter-card {
  margin-bottom: 16px;
}
.filter-bar {
  display: flex;
  align-items: center;
}
.shop {
  font-weight: 600;
}
.pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
