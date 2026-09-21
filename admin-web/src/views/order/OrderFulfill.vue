<template>
  <div>
    <!-- 顶部分类统计（点击筛选） -->
    <div class="admin-fulfill-stats">
      <div class="admin-fulfill-stat" :class="{ on: activeFilter === 'all' }" @click="filterBy('all')">
        <div class="admin-fulfill-stat-num">{{ stats.total }}</div>
        <div class="admin-fulfill-stat-lbl">全部</div>
      </div>
      <div class="admin-fulfill-stat" :class="{ on: activeFilter === '10' }" @click="filterBy('10')">
        <div class="admin-fulfill-stat-num admin-fulfill-num-orange">{{ stats.pendingConfirm }}</div>
        <div class="admin-fulfill-stat-lbl">待核单</div>
      </div>
      <div class="admin-fulfill-stat" :class="{ on: activeFilter === '30' }" @click="filterBy('30')">
        <div class="admin-fulfill-stat-num admin-fulfill-num-blue">{{ stats.stocking }}</div>
        <div class="admin-fulfill-stat-lbl">备货中</div>
      </div>
      <div class="admin-fulfill-stat" :class="{ on: activeFilter === 'shortage' }" @click="filterBy('shortage')">
        <div class="admin-fulfill-stat-num admin-fulfill-num-red">{{ stats.shortage }}</div>
        <div class="admin-fulfill-stat-lbl">缺货异常</div>
      </div>
      <div class="admin-fulfill-stat" :class="{ on: activeFilter === 'delivered' }" @click="filterBy('delivered')">
        <div class="admin-fulfill-stat-num admin-fulfill-num-green">{{ deliveredList.length }}</div>
        <div class="admin-fulfill-stat-lbl">已送达</div>
      </div>
      <!-- 卡M（2026-09-19 拍板）：客户称已付 ≠ 已核销，仅代表采购方自称，颜色醒目但不复用「已收款」绿色 -->
      <div class="admin-fulfill-stat" :class="{ on: activeFilter === 'claimed' }" @click="filterBy('claimed')">
        <div class="admin-fulfill-stat-num admin-fulfill-num-orange">{{ claimedCount }}</div>
        <div class="admin-fulfill-stat-lbl">客户称已付</div>
      </div>
    </div>

    <!-- 已送达/客户称已付视图下的筛选：送达日 + 只看未核销（默认关闭=看全部，有凭证的也能看到） -->
    <div v-if="activeFilter === 'delivered' || activeFilter === 'claimed'" class="admin-fulfill-toolbar">
      <el-date-picker
        v-model="claimDate"
        type="date"
        value-format="YYYY-MM-DD"
        placeholder="按送达日筛"
        clearable
        style="width: 150px"
      />
      <el-checkbox v-model="onlyUncleared" style="margin-left: 16px">只看未核销（无配送员凭证）</el-checkbox>
      <!-- 卡T（2026-09-21）：带上当前送达日跳到每日对账，省得两边各选一次日期 -->
      <el-button type="primary" plain size="small" style="margin-left: 16px" @click="goReconcile">
        去对账（{{ claimDate || todayStr() }} 这一天）
      </el-button>
      <span class="admin-fulfill-toolbar-tip">「客户称已付」仅代表采购方自称已付款，核销以配送员收款凭证为准</span>
    </div>

    <el-card shadow="never">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>待处理订单</span>
        </div>
      </template>
      <el-table :data="filteredList" v-loading="loading" stripe>
        <el-table-column prop="orderId" label="订单号" width="90">
          <template #default="{ row }">#{{ row.orderId }}</template>
        </el-table-column>
        <el-table-column prop="shopName" label="餐馆" min-width="140" />
        <el-table-column prop="deliveryDate" label="送达日" width="110" />
        <el-table-column label="商品数" width="80">
          <template #default="{ row }">{{ row.items ? row.items.length + ' 项' : '—' }}</template>
        </el-table-column>
        <!-- 卡T（2026-09-21）：金额 = 含运费总金额。口径 receivableOf（amountFinal ?? amountOrdered + deliveryFee），
             与每日对账页「应收」同源（后端 common/utils/amount.util.ts: receivableAmount） -->
        <el-table-column label="金额" width="110">
          <template #default="{ row }">
            <el-tooltip placement="top" effect="dark">
              <template #content>
                商品金额 ¥{{ money(row.amountOrdered) }} ＋ 运费 ¥{{ money(row.deliveryFee) }}
                <span v-if="row.amountFinal != null">（已核单，含运费合计 ¥{{ money(row.amountFinal) }}）</span>
                <span v-else>（未核单，按商品金额＋运费计）</span>
              </template>
              <span class="amount-cell">¥{{ money(receivableOf(row)) }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="缺货" min-width="190">
          <template #default="{ row }">
            <div v-if="hasShortage(row)" class="shortage-list">
              <div v-for="it in shortageItems(row)" :key="it.orderItemId" class="shortage-line">
                {{ it.productName }}：缺 {{ (it.qtyOrdered - it.qtyDeclared) }}{{ it.unit }}
              </div>
            </div>
            <span v-else style="color:#c0c4cc;">-</span>
          </template>
        </el-table-column>
        <!-- 卡M：客户称已付标记（仅 COD 送达后采购方自称，≠已核销）+ 配送员 -->
        <el-table-column label="客户称已付" width="150">
          <template #default="{ row }">
            <template v-if="row.buyerPaidClaimAt">
              <el-tag type="warning" size="small">客户称已付</el-tag>
              <div class="claim-time">{{ fmtTime(row.buyerPaidClaimAt) }}</div>
            </template>
            <span v-else style="color:#c0c4cc;">-</span>
          </template>
        </el-table-column>
        <!-- 收款凭证（配送员 COD 收款拍照，只读查看；2026-09-19 拍板卡） -->
        <el-table-column label="收款凭证" width="110">
          <template #default="{ row }">
            <el-button v-if="row.payProof?.photos?.length" type="primary" link @click="openProof(row)">📷 凭证({{ row.payProof.photos.length }})</el-button>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="配送员" width="100">
          <template #default="{ row }">{{ row.courierName || '—' }}</template>
        </el-table-column>
        <el-table-column prop="statusText" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 10 ? 'warning' : 'primary'" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 10 || row.status === 30" type="success" link :loading="autoSplittingId === row.orderId" @click="doAutoSplit(row)">自动拆单</el-button>
            <el-button v-if="row.status === 10" type="primary" link @click="openSplit(row)">手动拆单</el-button>
            <el-button v-else-if="row.status === 30" type="warning" link @click="openSplit(row)">改拆单</el-button>
            <el-button v-if="row.status !== 10 && row.status !== 30" link @click="openDetail(row)">明细</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!list.length && !loading" description="暂无待处理订单" />
    </el-card>

    <!-- 拆单弹窗 -->
    <el-dialog v-model="splitDialog" :title="splitTitle" width="640px">
      <div v-loading="splitLoading">
        <el-alert type="info" :closable="false" :title="splitAlertText" style="margin-bottom:12px" />
        <div v-for="item in splitPreview" :key="item.productId" class="split-item">
          <div class="split-name">{{ item.productName }}（订购 {{ item.qtyOrdered }}）</div>
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

    <!-- 明细弹窗（只读，供应商申报即最终交付量）
         卡T（2026-09-21）：顶部补「商品金额 ＋ 运费 ＝ 应收」拆分，口径与「金额」列一致；
         已送达/已完成行的数据源不含 items，故按需拉 /admin/order/:id/detail -->
    <el-dialog v-model="detailDialog" title="订单明细" width="620px">
      <div v-loading="detailLoading">
        <div v-if="currentOrder" class="detail-amount">
          商品金额 ¥{{ money(currentOrder.amountOrdered) }}
          <span class="detail-amount-op">＋</span>
          运费 ¥{{ money(currentOrder.deliveryFee) }}
          <span class="detail-amount-op">＝</span>
          应收 <b>¥{{ money(receivableOf(currentOrder)) }}</b>
          <span class="detail-amount-note">
            {{ currentOrder.amountFinal != null ? '（已核单：取 amountFinal，已含运费）' : '（未核单：回退 商品金额＋运费）' }}
          </span>
        </div>
        <el-table :data="detailItems" size="small" empty-text="暂无明细">
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
      </div>
    </el-dialog>
    <!-- 收款凭证弹窗（只读：大图查看，支持多张；2026-09-19 拍板卡；卡T 抽为共享组件） -->
    <ProofDialog v-model="proofDialog" :order-id="proofOrder?.orderId" :pay-proof="proofOrder?.payProof" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { orderAdminApi } from '../../api/modules'
import { receivableOf, money } from '../../utils/order-amount'
// 收款凭证弹窗：从本页抽出为共享组件（卡T 2026-09-21），每日对账页复用同一实现
import ProofDialog from '../../components/ProofDialog.vue'

const route = useRoute()
const router = useRouter()

const list = ref([])
const deliveredList = ref([])
const loading = ref(false)
const submitting = ref(false)

// ── 收款凭证（只读查看，弹窗实现见 components/ProofDialog.vue）──
const proofDialog = ref(false)
const proofOrder = ref(null)
function openProof(row) {
  proofOrder.value = row
  proofDialog.value = true
}
function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 东八区「今天」，与每日对账页/后端同日口径
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

// 卡T：跳到每日对账并带上送达日（带动词意义：这一天该收的钱）
function goReconcile() {
  router.push({ path: '/daily-reconciliation', query: { date: claimDate.value || todayStr() } })
}

// 分类筛选：all | 10 | 30 | shortage
const activeFilter = ref('all')

const isShortage = (it) => it.qtyDeclared !== null && Number(it.qtyDeclared) < Number(it.qtyOrdered)
const hasShortage = (row) => row.items?.some(isShortage)
const shortageCount = (row) => row.items?.filter(isShortage).length || 0
const shortageItems = (row) => (row.items || []).filter(isShortage)

// 分类统计
const stats = computed(() => {
  const all = list.value
  return {
    total: all.length,
    pendingConfirm: all.filter((o) => o.status === 10).length,
    stocking: all.filter((o) => o.status === 30).length,
    shortage: all.filter((o) => hasShortage(o)).length,
  }
})

const filteredList = computed(() => {
  if (activeFilter.value === 'delivered') return deliveredFiltered.value
  if (activeFilter.value === 'claimed') return deliveredFiltered.value.filter((o) => o.buyerPaidClaimAt)
  if (activeFilter.value === 'all') return list.value
  if (activeFilter.value === 'shortage') return list.value.filter((o) => hasShortage(o))
  return list.value.filter((o) => o.status === Number(activeFilter.value))
})

// ── 卡M：客户称已付（已送达列表的送达日/未核销筛选，前端本地过滤——数据为全量 take 400）──
const claimDate = ref(null)
const onlyUncleared = ref(false)
const claimedCount = computed(() => deliveredList.value.filter((o) => o.buyerPaidClaimAt).length)
const deliveredFiltered = computed(() => {
  let rows = deliveredList.value
  if (claimDate.value) rows = rows.filter((o) => o.deliveryDate === claimDate.value)
  if (onlyUncleared.value) rows = rows.filter((o) => !(o.payProof?.photos?.length))
  return rows
})

function filterBy(f) {
  activeFilter.value = f
}

const splitDialog = ref(false)
const splitLoading = ref(false)
const splitPreview = ref([])
const currentOrder = ref(null)
const autoSplittingId = ref(null)

const detailDialog = ref(false)
// 卡T：明细弹窗的数据源。待处理行自带 items；已送达/已完成行不带，需按需拉明细
const detailItems = ref([])
const detailLoading = ref(false)

// 拆单 vs 改拆单：备货中(status=30)的订单重新拆单即「修改自动拆单结果」
const isReSplit = computed(() => currentOrder.value?.status === 30)
const splitTitle = computed(() => (isReSplit.value ? '修改拆单' : '核单拆单'))
const splitAlertText = computed(() =>
  isReSplit.value
    ? '该订单已自动拆单，此处可调整各商品的供应商分配，确认后重新生效'
    : '系统按供货优先级 + 当日可供量自动分配，可确认后执行',
)

async function load() {
  loading.value = true
  try {
    // 已送达列表（含收款凭证）与待处理列表并行拉取，互不影响
    const [pending, delivered] = await Promise.all([
      orderAdminApi.getPendingList(),
      orderAdminApi.getDeliveredList().catch(() => []),
    ])
    list.value = pending
    deliveredList.value = delivered
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
        productId: it.productId,
        allocations: it.allocations.map((a) => ({ supplierId: a.supplierId, qty: a.qty })),
      }))
    await orderAdminApi.split(currentOrder.value.orderId, { items })
    ElMessage.success(isReSplit.value ? '改拆单完成' : '拆单完成')
    splitDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function doAutoSplit(row) {
  try {
    await ElMessageBox.confirm(
      `确认对订单 #${row.orderId} 按「供应商优先级 + 当日可供量」重新自动拆单？该订单当前的供应商分配将被覆盖。`,
      '自动拆单',
      { type: 'warning', confirmButtonText: '确认拆单', cancelButtonText: '取消' },
    )
  } catch (e) {
    return
  }
  autoSplittingId.value = row.orderId
  try {
    await orderAdminApi.autoSplit(row.orderId)
    ElMessage.success('自动拆单完成')
    load()
  } catch (e) { /* 已提示 */ } finally {
    autoSplittingId.value = null
  }
}

// 明细弹窗：待处理行自带来 items 直接用；已送达/已完成行不含 items，按需拉 /admin/order/:id/detail
// （卡T 2026-09-21：顺带修掉「已送达行点明细是空表」的老问题）
async function openDetail(row) {
  currentOrder.value = row
  detailDialog.value = true
  detailItems.value = row.items || []
  if (detailItems.value.length) return
  detailLoading.value = true
  try {
    const d = await orderAdminApi.getOrderDetail(row.orderId)
    currentOrder.value = { ...row, ...d }
    detailItems.value = d.items || []
  } catch (e) {
    detailItems.value = []
  } finally {
    detailLoading.value = false
  }
}

// 卡T：支持从每日对账页带 ?filter=&date=&orderId= 跳进来，直接落到「已送达」视图并打开该单明细
async function applyRouteQuery() {
  const f = route.query.filter
  if (f === 'delivered' || f === 'claimed') activeFilter.value = f
  if (typeof route.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.date)) {
    claimDate.value = route.query.date
  }
  const oid = Number(route.query.orderId)
  if (oid) {
    const row = deliveredList.value.find((o) => o.orderId === oid)
    if (row) await openDetail(row)
  }
}

onMounted(async () => {
  await load()
  await applyRouteQuery()
})
</script>

<style scoped>
.admin-fulfill-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}
.admin-fulfill-stat {
  flex: 1;
  max-width: 200px;
  background: #fff;
  border-radius: 12px;
  padding: 14px 8px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.admin-fulfill-stat:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.admin-fulfill-stat.on {
  border-color: #00b96b;
}
.admin-fulfill-stat-num {
  font-size: 24px;
  font-weight: 800;
  color: #1a1a1a;
}
.admin-fulfill-num-orange {
  color: #ff8f1f;
}
.admin-fulfill-num-blue {
  color: #3b7cff;
}
.admin-fulfill-num-red {
  color: #fa5151;
}
.admin-fulfill-num-green {
  color: #00b96b;
}
/* 卡T：金额列（含运费总金额）与明细弹窗的金额拆分 */
.amount-cell {
  cursor: help;
  border-bottom: 1px dashed #c0c4cc;
}
.detail-amount {
  font-size: 13px;
  color: #606266;
  background: #f7f8fa;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
}
.detail-amount-op {
  color: #909399;
  margin: 0 4px;
}
.detail-amount-note {
  color: #c0c4cc;
  font-size: 12px;
  margin-left: 6px;
}
.admin-fulfill-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}
.admin-fulfill-toolbar-tip {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
}
.claim-time {
  font-size: 11px;
  color: #ff8f1f;
  margin-top: 2px;
}
.admin-fulfill-stat-lbl {
  font-size: 12px;
  color: #8a9099;
  margin-top: 4px;
}
.split-item { padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
.split-name { font-weight: 600; margin-bottom: 4px; }
.alloc { display: flex; justify-content: space-between; padding: 2px 0; font-size: 13px; color: #606266; }
.qty { color: #00b96b; }
.shortage { color: #f56c6c; font-size: 12px; margin-top: 2px; }
.shortage-list { display: flex; flex-direction: column; gap: 2px; }
.shortage-line { color: #f56c6c; font-size: 12px; line-height: 1.5; }
</style>
