<template>
  <div class="admin-reports-page">
    <div class="admin-reports-crumb">数据中心 / 经营报表</div>

    <!-- 概览统计卡 -->
    <div class="admin-reports-cards" v-loading="loading">
      <div class="admin-reports-card">
        <div class="admin-reports-card-num">{{ overview.todayOrders }}</div>
        <div class="admin-reports-card-lbl">今日订单</div>
      </div>
      <div class="admin-reports-card">
        <div class="admin-reports-card-num green">¥{{ overview.todayGmv }}</div>
        <div class="admin-reports-card-lbl">今日 GMV</div>
      </div>
      <div class="admin-reports-card">
        <div class="admin-reports-card-num">{{ overview.monthOrders }}</div>
        <div class="admin-reports-card-lbl">本月订单</div>
      </div>
      <div class="admin-reports-card">
        <div class="admin-reports-card-num green">¥{{ overview.monthGmv }}</div>
        <div class="admin-reports-card-lbl">本月 GMV</div>
      </div>
      <div class="admin-reports-card">
        <div class="admin-reports-card-num orange">{{ overview.pendingCount }}</div>
        <div class="admin-reports-card-lbl">待处理订单</div>
      </div>
      <div class="admin-reports-card">
        <div class="admin-reports-card-num red">{{ overview.aftersalePending }}</div>
        <div class="admin-reports-card-lbl">售后待处理</div>
      </div>
    </div>

    <div class="admin-reports-grid">
      <!-- 状态分布 -->
      <el-card shadow="never">
        <template #header>订单状态分布</template>
        <el-table :data="overview.statusDist || []" size="small">
          <el-table-column prop="statusText" label="状态" />
          <el-table-column prop="count" label="数量" width="90" align="right" />
        </el-table>
        <el-empty v-if="!overview.statusDist?.length" description="暂无订单" :image-size="60" />
      </el-card>

      <!-- 分类销售 -->
      <el-card shadow="never">
        <template #header>
          <div class="admin-reports-head">
            <span>分类销售</span>
            <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" size="small" @change="loadCategorySales" />
          </div>
        </template>
        <el-table :data="categorySales.list || []" v-loading="salesLoading" size="small">
          <el-table-column prop="categoryName" label="分类" />
          <el-table-column prop="qty" label="销量" width="90" align="right" />
          <el-table-column label="销售额" width="110" align="right">
            <template #default="{ row }">¥{{ row.sales }}</template>
          </el-table-column>
        </el-table>
        <div v-if="categorySales.totalSales != null" class="admin-reports-total">
          合计销售额 <span class="green">¥{{ categorySales.totalSales }}</span>
        </div>
        <el-empty v-if="!categorySales.list?.length && !salesLoading" description="该月暂无销售" :image-size="60" />
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { reportsAdminApi } from '../../api/modules'

const loading = ref(false)
const salesLoading = ref(false)
const overview = ref({})
const categorySales = ref({})

const month = ref(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)

async function loadOverview() {
  loading.value = true
  try {
    overview.value = await reportsAdminApi.getOverview()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

async function loadCategorySales() {
  salesLoading.value = true
  try {
    categorySales.value = await reportsAdminApi.getCategorySales({ period: month.value })
  } catch (e) {
    categorySales.value = {}
  } finally {
    salesLoading.value = false
  }
}

onMounted(() => {
  loadOverview()
  loadCategorySales()
})
</script>

<style scoped>
.admin-reports-page {
  max-width: 1280px;
  margin: 0 auto;
}
.admin-reports-crumb {
  font-size: 13px;
  color: #8a9099;
  margin-bottom: 14px;
}
.admin-reports-cards {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.admin-reports-card {
  background: #fff;
  border-radius: 12px;
  padding: 16px 12px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.admin-reports-card-num {
  font-size: 24px;
  font-weight: 800;
  color: #1a1a1a;
}
.admin-reports-card-num.green { color: #00b96b; }
.admin-reports-card-num.orange { color: #ff8f1f; }
.admin-reports-card-num.red { color: #fa5151; }
.admin-reports-card-lbl {
  font-size: 12px;
  color: #8a9099;
  margin-top: 6px;
}
.admin-reports-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.admin-reports-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.admin-reports-total {
  margin-top: 12px;
  text-align: right;
  font-size: 13px;
  color: #606266;
}
.green { color: #00b96b; font-weight: 700; }
</style>
