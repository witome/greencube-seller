<template>
  <div>
    <!-- 待配送订单 -->
    <el-card shadow="never" style="margin-bottom:16px">
      <div class="toolbar">
        <div class="toolbar-left">
          已选 <b>{{ selectedOrders.length }}</b> 单
          <el-select v-model="courierId" placeholder="选择配送员" style="width: 180px; margin-left: 12px">
            <el-option v-for="c in couriers" :key="c.courierId" :label="`${c.phone}（在线${c.online === 1 ? '·可派' : '·离线'}）`" :value="c.courierId" :disabled="c.online !== 1 || c.onRoute === 1" />
          </el-select>
          <el-button type="primary" :disabled="!selectedOrders.length || !courierId" :loading="submitting" @click="assign">
            指派配送
          </el-button>
          <el-button type="success" :loading="autoAssigning" @click="autoAssign">
            ⚡ 自动派单
          </el-button>
        </div>
        <div class="toolbar-tip">以自动派单为主：订单备货完成会自动派单；也可点「自动派单」手动触发，按优先级派给「在线 + 空闲」配送员，不超过单量限制</div>
      </div>
      <el-table :data="list" v-loading="loading" stripe @selection-change="onSelect">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="orderId" label="订单号" width="90">
          <template #default="{ row }">#{{ row.orderId }}</template>
        </el-table-column>
        <el-table-column prop="shopName" label="餐馆" min-width="140" />
        <el-table-column prop="address" label="地址" min-width="180" show-overflow-tooltip />
        <el-table-column prop="deliveryDate" label="送达日" width="110" />
        <el-table-column prop="itemCount" label="商品数" width="80">
          <template #default="{ row }">{{ row.itemCount }} 项</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无待配送订单" />
    </el-card>

    <!-- 配送员列表 -->
    <el-card shadow="never">
      <template #header>配送员调度设置</template>
      <el-table :data="couriers" v-loading="loading" stripe>
        <el-table-column prop="courierId" label="ID" width="60" />
        <el-table-column prop="phone" label="配送员" min-width="130" />
        <el-table-column label="在线" width="80">
          <template #default="{ row }">
            <el-tag :type="row.online === 1 ? 'success' : 'info'" size="small">{{ row.online === 1 ? '上线' : '下线' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="接单模式" width="90">
          <template #default="{ row }">
            <el-tag :type="row.autoAccept === 1 ? 'primary' : 'info'" size="small">{{ row.autoAccept === 1 ? '自动' : '手动' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="配送中" width="80">
          <template #default="{ row }">
            <el-tag :type="row.onRoute === 1 ? 'warning' : 'info'" size="small">{{ row.onRoute === 1 ? '配送中' : '空闲' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="90" sortable>
          <template #default="{ row }">
            <span :style="{ color: row.priority < 100 ? '#e6a23c' : '' }">{{ row.priority }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="maxOrders" label="单量限制" width="90" />
        <el-table-column prop="activeTasks" label="当前任务" width="90" />
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openSetting(row)">设置</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 配送异常工单 -->
    <el-card shadow="never" style="margin-top:16px">
      <template #header>⚠️ 配送异常工单</template>
      <el-table :data="exceptions" v-loading="exLoading" stripe>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="配送员" width="90">
          <template #default="{ row }">#{{ row.courierId }}</template>
        </el-table-column>
        <el-table-column label="任务/订单" width="140">
          <template #default="{ row }">
            <div v-if="row.orders && row.orders.length">
              <el-button v-for="o in row.orders" :key="o.orderId" type="primary" link @click="openOrderDetail(o, row)">
                #{{ o.orderId }}
              </el-button>
            </div>
            <span v-else-if="row.routeNo">{{ row.routeNo }}</span>
            <span v-else style="color:#c0c4cc;">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="异常原因" min-width="200" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 0 ? 'danger' : 'info'" size="small">{{ row.status === 0 ? '待处理' : '已处理' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 0 && isShortage(row)" type="warning" link @click="reSplitShortage(row)">二次拆单</el-button>
            <el-button v-if="row.status === 0 && !isShortage(row)" type="primary" link @click="handle(row)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!exceptions.length && !exLoading" description="暂无配送异常" />
    </el-card>

    <!-- 订单详情弹窗 -->
    <el-dialog v-model="orderDialog" title="订单详情" width="460px">
      <div v-if="currentException" class="exc-reason">⚠️ 异常原因：{{ currentException.reason }}</div>
      <div v-if="currentOrder" class="exc-order">
        <div class="exc-row"><span class="exc-k">餐馆</span><span class="exc-v">{{ currentOrder.shopName }}</span></div>
        <div class="exc-row"><span class="exc-k">送达日</span><span class="exc-v">{{ currentOrder.deliveryDate }}</span></div>
        <div v-for="(it, idx) in currentOrder.items" :key="idx" class="exc-row">
          <span class="exc-k">{{ it.name }}</span><span class="exc-v">{{ it.qty }}{{ it.unit }}</span>
        </div>
      </div>
    </el-dialog>

    <!-- 配送员设置弹窗 -->
    <el-dialog v-model="settingDialog" title="配送员派单设置" width="420px">
      <el-form label-width="90px">
        <el-form-item label="配送员">
          <span>{{ currentCourier?.phone }}</span>
        </el-form-item>
        <el-form-item label="优先级">
          <el-input-number v-model="settingForm.priority" :min="0" :max="999" />
          <div class="form-tip">数字越小越优先派单</div>
        </el-form-item>
        <el-form-item label="单量限制">
          <el-input-number v-model="settingForm.maxOrders" :min="1" :max="100" />
          <div class="form-tip">同时最多承载的派单数量</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="settingDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="saveSetting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dispatchAdminApi, orderAdminApi } from '../../api/modules'

const list = ref([])
const couriers = ref([])
const selectedOrders = ref([])
const courierId = ref(null)
const loading = ref(false)
const submitting = ref(false)
const autoAssigning = ref(false)

// 配送异常
const exceptions = ref([])
const exLoading = ref(false)

// 订单详情弹窗
const orderDialog = ref(false)
const currentOrder = ref(null)
const currentException = ref(null)

function openOrderDetail(o, row) {
  currentOrder.value = o
  currentException.value = row
  orderDialog.value = true
}

const settingDialog = ref(false)
const currentCourier = ref(null)
const settingForm = reactive({ priority: 100, maxOrders: 10 })

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function loadExceptions() {
  exLoading.value = true
  try {
    exceptions.value = await dispatchAdminApi.getExceptions()
  } catch (e) { /* 已提示 */ } finally {
    exLoading.value = false
  }
}

// 缺货异常：原因含「缺货」的走二次拆单，其余走普通处理恢复
function isShortage(row) {
  return !!row.reason && row.reason.includes('缺货')
}

async function reSplitShortage(row) {
  // 二次拆单需要订单 id（异常单关联的订单）
  if (!row.orderId) {
    ElMessage.warning('该异常未关联订单，无法二次拆单')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认对订单 #${row.orderId} 重新按供应商优先级+可供量二次拆单，并恢复为正常配送？`,
      '缺货二次拆单',
      { type: 'warning', confirmButtonText: '确认拆单', cancelButtonText: '取消' },
    )
  } catch (e) {
    return
  }
  try {
    const res = await orderAdminApi.reSplitShortage(row.orderId)
    ElMessage.success(`二次拆单完成，已转备货（${res.supplierCount} 个供应商）`)
    // 同时把异常单标记已处理
    await dispatchAdminApi.handleException(row.exceptionId)
    loadExceptions()
  } catch (e) { /* 已提示 */ }
}

async function handle(row) {
  try {
    await dispatchAdminApi.handleException(row.exceptionId)
    ElMessage.success('已标记处理')
    loadExceptions()
  } catch (e) { /* 已提示 */ }
}

function onSelect(rows) {
  selectedOrders.value = rows
}

async function load() {
  loading.value = true
  try {
    list.value = await dispatchAdminApi.getDispatchList()
    couriers.value = await dispatchAdminApi.getCouriers()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

async function assign() {
  submitting.value = true
  try {
    await dispatchAdminApi.assign({
      courierId: courierId.value,
      orderIds: selectedOrders.value.map((o) => o.orderId),
    })
    ElMessage.success('已指派配送员')
    courierId.value = null
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function autoAssign() {
  autoAssigning.value = true
  try {
    const r = await dispatchAdminApi.autoAssign()
    if (r.assigned > 0) ElMessage.success(`自动派单完成：已派 ${r.assigned} 单`)
    else ElMessage.warning(r.note || '无订单被派发')
    load()
  } catch (e) { /* 已提示 */ } finally {
    autoAssigning.value = false
  }
}

function openSetting(row) {
  currentCourier.value = row
  settingForm.priority = row.priority
  settingForm.maxOrders = row.maxOrders
  settingDialog.value = true
}

async function saveSetting() {
  submitting.value = true
  try {
    await dispatchAdminApi.updateCourierSettings(currentCourier.value.courierId, {
      priority: settingForm.priority,
      maxOrders: settingForm.maxOrders,
    })
    ElMessage.success('已保存')
    settingDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

onMounted(() => {
  load()
  loadExceptions()
})
</script>

<style scoped>
.toolbar { margin-bottom: 12px; }
.toolbar-left { display: flex; align-items: center; }
.toolbar-tip { font-size: 12px; color: #909399; margin-top: 8px; }
.form-tip { font-size: 12px; color: #909399; margin-top: 4px; }
.exc-reason { padding: 10px; background: #fef0f0; border-radius: 6px; color: #f56c6c; font-size: 13px; margin-bottom: 12px; }
.exc-order { font-size: 13px; }
.exc-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #f0f0f0; }
.exc-k { color: #909399; }
.exc-v { color: #303133; }
</style>
