<template>
  <div>
    <el-card shadow="never">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="orderId" label="订单号" width="90">
          <template #default="{ row }">#{{ row.orderId }}</template>
        </el-table-column>
        <el-table-column prop="shopName" label="餐馆" min-width="140" />
        <el-table-column prop="deliveryDate" label="送达日" width="110" />
        <el-table-column label="商品数" width="80">
          <template #default="{ row }">{{ row.items.length }} 项</template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">¥{{ row.amountOrdered }}</template>
        </el-table-column>
        <el-table-column label="缺货" width="100">
          <template #default="{ row }">
            <el-tag v-if="hasShortage(row)" type="danger" size="small">⚠ {{ shortageCount(row) }} 项缺货</el-tag>
            <span v-else style="color:#c0c4cc;">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="statusText" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 10 ? 'warning' : 'primary'" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 10" type="primary" link @click="openSplit(row)">拆单</el-button>
            <el-button v-else link @click="openDetail(row)">明细</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无待处理订单" />
    </el-card>

    <!-- 拆单弹窗 -->
    <el-dialog v-model="splitDialog" title="核单拆单" width="640px">
      <div v-loading="splitLoading">
        <el-alert type="info" :closable="false" title="系统按供货优先级 + 当日可供量自动分配，可确认后执行" style="margin-bottom:12px" />
        <div v-for="item in splitPreview" :key="item.orderItemId" class="split-item">
          <div class="split-name">商品 #{{ item.orderItemId }}（订购 {{ item.qtyOrdered }}）</div>
          <div v-for="a in item.allocations" :key="a.supplierId" class="alloc">
            <span>🥕 {{ a.supplierName }}</span>
            <span class="qty">{{ a.qty }} × ¥{{ a.supplyPrice }}</span>
          </div>
          <div v-if="item.shortage > 0" class="shortage">⚠️ 可供量不足，短缺 {{ item.shortage }}</div>
          <div v-if="item.noSupplier" class="shortage">⚠️ 无供应商供货</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="splitDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="confirmSplit">确认拆单</el-button>
      </template>
    </el-dialog>

    <!-- 明细弹窗（只读，供应商申报即最终交付量） -->
    <el-dialog v-model="detailDialog" title="订单明细" width="560px">
      <el-table :data="currentOrder?.items || []" size="small">
        <el-table-column prop="productName" label="商品" min-width="110">
          <template #default="{ row }">
            {{ row.productName }}
            <div v-if="row.supplierName" style="font-size:11px;color:#909399;">{{ row.supplierName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订购" width="70">
          <template #default="{ row }">{{ row.qtyOrdered }}</template>
        </el-table-column>
        <el-table-column label="实交(申报)" width="150">
          <template #default="{ row }">
            <span :style="{ color: isShortage(row) ? '#f56c6c' : '' }">
              {{ row.qtyDeclared ?? row.qtyOrdered }}
              <span v-if="isShortage(row)" style="display:block;font-size:11px;color:#f56c6c;">{{ row.shortageReason }}</span>
            </span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { orderAdminApi } from '../../api/modules'

const list = ref([])
const loading = ref(false)
const submitting = ref(false)

const splitDialog = ref(false)
const splitLoading = ref(false)
const splitPreview = ref([])
const currentOrder = ref(null)

const detailDialog = ref(false)

const isShortage = (it) => it.qtyDeclared !== null && Number(it.qtyDeclared) < Number(it.qtyOrdered)
const hasShortage = (row) => row.items?.some(isShortage)
const shortageCount = (row) => row.items?.filter(isShortage).length || 0

async function load() {
  loading.value = true
  try {
    list.value = await orderAdminApi.getPendingList()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

async function openSplit(row) {
  currentOrder.value = row
  splitDialog.value = true
  splitLoading.value = true
  try {
    splitPreview.value = await orderAdminApi.getSplitPreview(row.orderId)
  } catch (e) {
    splitPreview.value = []
  } finally {
    splitLoading.value = false
  }
}

async function confirmSplit() {
  submitting.value = true
  try {
    const items = splitPreview.value
      .filter((it) => it.allocations?.length)
      .map((it) => ({
        orderItemId: it.orderItemId,
        allocations: it.allocations.map((a) => ({ supplierId: a.supplierId, qty: a.qty })),
      }))
    await orderAdminApi.split(currentOrder.value.orderId, { items })
    ElMessage.success('拆单完成')
    splitDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

function openDetail(row) {
  currentOrder.value = row
  detailDialog.value = true
}

onMounted(load)
</script>

<style scoped>
.split-item { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
.split-name { font-weight: 600; margin-bottom: 4px; }
.alloc { display: flex; justify-content: space-between; padding: 2px 0; font-size: 13px; color: #606266; }
.qty { color: #00b96b; }
.shortage { color: #f56c6c; font-size: 12px; margin-top: 2px; }
</style>
