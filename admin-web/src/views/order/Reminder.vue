<template>
  <div>
    <!-- ── 卡BN-2（2026-10-02）：催单台（原型 S2）── -->
    <!-- 顶部统计（5 个）：待备货/超时/需人工 由 list.rows 派生；拨打/接通用 config.todayStats -->
    <div class="rm-stats">
      <div class="rm-stat">
        <div class="rm-stat-k">当前待备货</div>
        <div class="rm-stat-v">{{ stats.pending }}<em>单</em></div>
      </div>
      <div class="rm-stat rm-stat-warn">
        <div class="rm-stat-k">超时未接单</div>
        <div class="rm-stat-v">{{ stats.timeout }}<em>单</em></div>
      </div>
      <div class="rm-stat">
        <div class="rm-stat-k">今日自动拨打</div>
        <div class="rm-stat-v">{{ todayStats.calls }}<em>通</em></div>
      </div>
      <div class="rm-stat">
        <div class="rm-stat-k">接通</div>
        <div class="rm-stat-v">{{ todayStats.connected }}<em>通</em> <em>{{ todayStats.calls ? Math.round((todayStats.connected / todayStats.calls) * 100) : 0 }}%</em></div>
      </div>
      <div class="rm-stat">
        <div class="rm-stat-k">需人工跟进</div>
        <div class="rm-stat-v">{{ stats.manual }}<em>单</em></div>
      </div>
    </div>

    <!-- 设置摘要条（list.settings + config.callerNumber） -->
    <div v-if="settings" class="rm-setbar">
      <span class="rm-setbar-em">⚙️</span>
      <div class="rm-setbar-tx">
        <b>当前生效设置</b>
        未接单 <b>{{ settings.thresholdMinutes }}</b> 分钟自动拨打 · 间隔 <b>{{ settings.secondGapMinutes }}</b> 分钟 · 最多 <b>{{ settings.maxCalls }}</b> 次 ·
        <template v-if="settings.quietEnabled">静默时段 <b>{{ settings.quietStart }}–{{ settings.quietEnd }}</b> 不拨打</template>
        <template v-else>免打扰已关闭（24 小时可拨打）</template>
        · 显示号码 <b>{{ config?.callerNumber || '未配置' }}</b>
      </div>
      <el-button type="primary" size="small" @click="goSettings">去设置</el-button>
    </div>

    <!-- ⚠️ 未配置语音通道提示条（vmsConfigured=false 时显示） -->
    <el-alert
      v-if="config && !config.vmsConfigured"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
      title="语音服务未配置，当前为演练模式（不会真拨）"
    />

    <el-card shadow="never">
      <template #header>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>未接单催办列表（备货中订单 × 供应商）</span>
          <span style="font-size:12px;color:#909399;">数据每分钟自动刷新</span>
        </div>
      </template>
      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column label="供应商 / 档口" min-width="150">
          <template #default="{ row }">
            <b>{{ row.supplierName || '—' }}</b>
            <div v-if="row.phoneMasked" class="rm-sub">{{ row.phoneMasked }}</div>
          </template>
        </el-table-column>
        <el-table-column label="订单号" width="90">
          <template #default="{ row }">#{{ row.orderId }}</template>
        </el-table-column>
        <el-table-column prop="shopName" label="餐馆" min-width="130">
          <template #default="{ row }">{{ row.shopName || '—' }}</template>
        </el-table-column>
        <el-table-column label="下单时间" width="90">
          <template #default="{ row }">{{ fmtHM(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="已超时" width="110">
          <template #default="{ row }">
            <span v-if="isTimeout(row)" class="rm-timeout">{{ row.minutesUnacked }} 分钟</span>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="已拨打" width="90">
          <template #default="{ row }">{{ row.remindCount }} / {{ settings?.maxCalls ?? 0 }} 次</template>
        </el-table-column>
        <el-table-column label="最近拨打" width="90">
          <template #default="{ row }">
            <span v-if="row.lastRemindAt">{{ fmtHM(row.lastRemindAt) }}</span>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" min-width="150">
          <template #default="{ row }">
            <el-tag v-if="row.ackAt" type="success" size="small">已接单 {{ fmtHM(row.ackAt) }}</el-tag>
            <el-tag v-else :type="resultTagType(row.lastResult)" size="small">{{ resultLabel(row.lastResult) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="下一步" min-width="140">
          <template #default="{ row }">
            <el-tag v-if="row.nextAction === 'auto'" type="primary" size="small">自动</el-tag>
            <span v-else-if="row.nextAction === 'manual'" class="rm-manual">已达上限 · 需人工</span>
            <el-tag v-else type="info" size="small">已处理 · 停止</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <template v-if="!row.ackAt && !row.remindStopped">
              <el-button type="success" size="small" :loading="callingKey === rowKey(row)" @click="doCall(row)">拨打</el-button>
              <el-button size="small" @click="doMarkHandled(row)">已处理</el-button>
            </template>
            <el-button link type="primary" @click="openRecords(row)">记录</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!rows.length && !loading" description="暂无备货中订单" />
    </el-card>

    <!-- 拨打记录抽屉（原型 S2b）：每一通的台账（时间 / 自动还是人工 / 结果 / callId） -->
    <el-drawer v-model="drawerVisible" :title="drawerTitle" size="420px">
      <div v-loading="recordsLoading">
        <div class="rm-rec-sub">共 {{ records.length }} 通 · 数据来源拨打台账</div>
        <div v-for="(r, i) in records" :key="r.id" class="rm-rec-row">
          <span class="rm-rec-ic">📞</span>
          <div class="rm-rec-main">
            <b>第 {{ records.length - i }} 通 · {{ r.mode === 'manual' ? '人工' : '自动' }}</b>
            <small>{{ fmtFull(r.at) }}</small>
            <small v-if="r.note">{{ r.note }}</small>
            <small v-if="r.callId" class="rm-rec-callid">callId: {{ r.callId }}</small>
          </div>
          <div class="rm-rec-result" :style="{ color: resultColor(r.result) }">{{ resultLabel(r.result) }}</div>
        </div>
        <el-empty v-if="!records.length && !recordsLoading" description="暂无拨打记录" />
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '../../api/request'

// ── 卡BN-2：接口按卡BN-1 第四节冻结契约对接（字段名照契约写死） ──
const api = {
  getConfig: () => request.get('/admin/supplier-notify/config'),
  getList: () => request.get('/admin/supplier-notify/list'),
  getRecords: (params) => request.get('/admin/supplier-notify/records', { params }),
  call: (data) => request.post('/admin/supplier-notify/call', data),
  markHandled: (data) => request.post('/admin/supplier-notify/mark-handled', data),
}

const router = useRouter()

const loading = ref(false)
const rows = ref([])
const settings = ref(null)
const config = ref(null)
const todayStats = computed(() => config.value?.todayStats || { calls: 0, connected: 0, needManual: 0 })

// 「结果」列中文映射（照原型/任务书冻结口径）
const RESULT_MAP = {
  dry_run: '演练模式未真拨',
  initiated: '已发起（等回执）',
  connected: '已接通',
  no_answer: '未接通',
  failed: '拨打失败',
  skipped_no_phone: '手机号为空',
  skipped_ack_call_off: '供应商已关闭电话提醒',
  skipped_quiet: '免打扰时段内',
}
const resultLabel = (r) => (r == null ? '未拨打' : RESULT_MAP[r] || r)
const resultTagType = (r) => {
  if (r === 'connected') return 'success'
  if (r === 'no_answer' || r === 'failed') return 'danger'
  if (r === 'initiated' || r === 'dry_run') return 'warning'
  return 'info'
}
const resultColor = (r) => {
  if (r === 'connected') return '#00a05c'
  if (r === 'no_answer' || r === 'failed') return '#fa5151'
  return '#909399'
}

// 统计：待备货=全部行；超时=分钟数≥阈值且未接单未停止；需人工=nextAction==='manual'
const stats = computed(() => {
  const threshold = settings.value?.thresholdMinutes
  const list = rows.value
  return {
    pending: list.length,
    timeout: threshold
      ? list.filter((r) => !r.ackAt && !r.remindStopped && r.minutesUnacked >= threshold).length
      : 0,
    manual: list.filter((r) => r.nextAction === 'manual').length,
  }
})

const isTimeout = (row) =>
  !row.ackAt && !row.remindStopped && settings.value && row.minutesUnacked >= settings.value.thresholdMinutes

const fmtHM = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
const fmtFull = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const rowKey = (row) => `${row.orderId}-${row.supplierId}`

async function fetchAll() {
  loading.value = true
  try {
    const [listRes, cfg] = await Promise.all([
      api.getList(),
      api.getConfig().catch(() => null),
    ])
    rows.value = listRes.rows || []
    settings.value = listRes.settings || null
    if (cfg) config.value = cfg
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function goSettings() {
  router.push('/settings')
}

// ── 行操作：拨打（人工补打一通，走同一适配器；演练模式下不会真拨） ──
const callingKey = ref('')
async function doCall(row) {
  callingKey.value = rowKey(row)
  try {
    const r = await api.call({ orderId: row.orderId, supplierId: row.supplierId })
    if (r.dryRun || r.result === 'dry_run') ElMessage.warning('演练模式：未真拨（已记录台账）')
    else ElMessage.success(`已发起拨打（${resultLabel(r.result)}）`)
    fetchAll()
  } catch (e) { /* 已提示 */ } finally {
    callingKey.value = ''
  }
}

// ── 行操作：已处理（remindStopped=1，不再自动拨打） ──
async function doMarkHandled(row) {
  try {
    await ElMessageBox.confirm(
      `确认将 #${row.orderId} · ${row.supplierName || row.supplierId} 标记为已处理？该供应商将不再自动拨打。`,
      '已处理',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    )
  } catch (e) {
    return
  }
  try {
    await api.markHandled({ orderId: row.orderId, supplierId: row.supplierId })
    ElMessage.success('已标记为已处理，停止自动拨打')
    fetchAll()
  } catch (e) { /* 已提示 */ }
}

// ── 记录抽屉（S2b）：GET records?orderId=&supplierId= ──
const drawerVisible = ref(false)
const recordsLoading = ref(false)
const records = ref([])
const drawerTitle = ref('拨打记录')
async function openRecords(row) {
  drawerTitle.value = `#${row.orderId} · ${row.supplierName || row.supplierId} · 拨打记录`
  drawerVisible.value = true
  recordsLoading.value = true
  records.value = []
  try {
    records.value = await api.getRecords({ orderId: row.orderId, supplierId: row.supplierId })
  } catch (e) { /* 已提示 */ } finally {
    recordsLoading.value = false
  }
}

// 列表每分钟自动刷新；离开页面清除定时器
let timer = null
onMounted(() => {
  fetchAll()
  timer = setInterval(fetchAll, 60 * 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.rm-stats {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.rm-stat {
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 6px;
  padding: 10px 14px;
  min-width: 132px;
}
.rm-stat-k {
  font-size: 12px;
  color: #909399;
}
.rm-stat-v {
  font-size: 20px;
  font-weight: 700;
  margin-top: 3px;
}
.rm-stat-v em {
  font-size: 11px;
  font-weight: 400;
  color: #909399;
  font-style: normal;
  margin-left: 3px;
}
.rm-stat-warn .rm-stat-v {
  color: #fa5151;
}
.rm-setbar {
  background: #f5f9ff;
  border: 1px solid #cfe2fa;
  border-radius: 6px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #2b7be4;
}
.rm-setbar-em {
  font-size: 20px;
}
.rm-setbar-tx {
  flex: 1;
  line-height: 1.6;
  color: #2b7be4;
}
.rm-setbar-tx b {
  color: #1f2329;
}
.rm-sub {
  font-size: 11px;
  color: #909399;
}
.rm-timeout {
  color: #fa5151;
  font-weight: 700;
}
.rm-manual {
  color: #fa5151;
  font-weight: 600;
  font-size: 12px;
}
.rm-rec-sub {
  font-size: 12px;
  color: #909399;
  margin-bottom: 10px;
}
.rm-rec-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #f2f4f6;
  font-size: 13px;
}
.rm-rec-ic {
  font-size: 15px;
}
.rm-rec-main {
  flex: 1;
  line-height: 1.7;
}
.rm-rec-main small {
  display: block;
  color: #909399;
  font-size: 11px;
}
.rm-rec-callid {
  word-break: break-all;
}
.rm-rec-result {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
</style>
