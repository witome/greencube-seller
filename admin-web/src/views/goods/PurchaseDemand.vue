<template>
  <div class="admin-demand-page">
    <div class="admin-demand-crumb">
      商品管理 / 采购需求（客户要了、我们还没有的货 → 导出成采购清单 → 到货后通知客户）
    </div>

    <!-- 统计卡 -->
    <div class="admin-demand-stats">
      <div class="admin-demand-stat" :class="{ clickable: statusFilter !== 0 }" @click="filterPending">
        <div class="admin-demand-stat-num">{{ stats.pending }}</div>
        <div class="admin-demand-stat-lbl">待采购</div>
        <div class="admin-demand-stat-tip">点一下只看待采购</div>
      </div>
      <div class="admin-demand-stat">
        <div class="admin-demand-stat-num">{{ stats.newThisWeek }}</div>
        <div class="admin-demand-stat-lbl">本周新增</div>
        <div class="admin-demand-stat-tip">按「最近优先」排在最前</div>
      </div>
      <div class="admin-demand-stat">
        <div class="admin-demand-stat-num">{{ stats.hot }}</div>
        <div class="admin-demand-stat-lbl">≥3 人在要</div>
        <div class="admin-demand-stat-tip">要的人多，优先采</div>
      </div>
    </div>

    <!-- 模板未配置提示：不写死模板 id，没配就说清楚，别让运营对着失败按钮猜 -->
    <el-alert
      v-if="!templateConfigured"
      type="warning"
      show-icon
      :closable="false"
      class="admin-demand-alert"
      title="运营还没配置到货通知模板"
      description="小程序端「到货通知我」按钮不会显示，点「到货通知」也会提示未配置。请先在公众平台申请「到货通知」订阅消息模板，拿到模板 id 后写入后端 .env 的 WX_SUBSCRIBE_TMPL_DEMAND 并重启后端。"
    />

    <!-- 筛选 -->
    <el-card shadow="never" class="admin-demand-filter-card">
      <div class="admin-demand-filter">
        <el-radio-group v-model="statusFilter" @change="onQuery">
          <el-radio-button :value="''">全部</el-radio-button>
          <el-radio-button :value="0">待采购</el-radio-button>
          <el-radio-button :value="1">已下单采购中</el-radio-button>
          <el-radio-button :value="2">已到货</el-radio-button>
          <el-radio-button :value="3">已放弃</el-radio-button>
        </el-radio-group>

        <el-input
          v-model="keyword"
          placeholder="搜索菜名"
          clearable
          style="width: 180px; margin-left: 16px"
          @keyup.enter="onQuery"
          @clear="onQuery"
        />

        <el-select v-model="sort" style="width: 170px; margin-left: 12px" @change="onQuery">
          <el-option label="要的人多优先（默认）" value="hot" />
          <el-option label="最近优先" value="recent" />
        </el-select>

        <el-button type="primary" style="margin-left: 12px" @click="onQuery">查询</el-button>
        <div class="admin-demand-spacer" />
        <el-button @click="openCreate">手动新增</el-button>
        <el-button type="success" plain :loading="exporting" @click="onExport">导出 CSV</el-button>
      </div>
      <div class="admin-demand-sort-tip">
        排序口径：要的人多 → 共几次多 → 最近时间新。刚补录的需求会自动切到「最近优先」，保证"新记录出现在第一屏"。
      </div>
    </el-card>

    <!-- 列表 -->
    <el-card shadow="never" class="admin-demand-table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="需求名" min-width="140" show-overflow-tooltip />
        <el-table-column label="几人在要" width="96" align="center">
          <template #default="{ row }">
            <el-tag :type="row.purchaserCount >= 3 ? 'danger' : 'info'" size="small" effect="plain">
              {{ row.purchaserCount }} 人
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="共几次" width="80" align="center">
          <template #default="{ row }">{{ row.demandCount }} 次</template>
        </el-table-column>
        <el-table-column label="最近一次" width="160">
          <template #default="{ row }">{{ fmtTime(row.lastAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status === 0" size="small" @click="markOrdered(row)">已下单</el-button>
            <el-button v-if="row.status !== 2 && row.status !== 3" size="small" type="primary" @click="markArrived(row)">已到货</el-button>
            <el-button v-if="row.status === 2" size="small" type="primary" @click="openNotify(row)">通知客户</el-button>
            <el-button size="small" @click="openEdit(row)">备注</el-button>
            <el-button v-if="row.status !== 3" size="small" type="danger" plain @click="abandon(row)">放弃</el-button>
            <el-button size="small" type="warning" plain @click="openMerge(row)">合并</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        style="margin-top: 16px; justify-content: flex-end"
        @current-change="load"
      />
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="'采购需求详情 · ' + (detail?.demand?.name || '')" size="720px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="需求名">{{ detail.demand.name }}</el-descriptions-item>
          <el-descriptions-item label="归一化键">{{ detail.demand.demandKey }}</el-descriptions-item>
          <el-descriptions-item label="几人在要">{{ detail.demand.purchaserCount }} 人</el-descriptions-item>
          <el-descriptions-item label="共几次">{{ detail.demand.demandCount }} 次</el-descriptions-item>
          <el-descriptions-item label="首次">{{ fmtTime(detail.demand.firstAt) }}</el-descriptions-item>
          <el-descriptions-item label="最近">{{ fmtTime(detail.demand.lastAt) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detail.demand.status)" size="small">{{ detail.demand.statusText }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="命中的已下架商品">
            <span v-if="detail.demand.productId">#{{ detail.demand.productId }}（已有商品·已下架）</span>
            <span v-else>-</span>
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ detail.demand.note || '-' }}</el-descriptions-item>
        </el-descriptions>

        <div class="admin-demand-sub-title">谁能收到到货通知（{{ detail.capability.length }} 位客户）</div>
        <el-table :data="detail.capability" size="small" border>
          <el-table-column prop="shopName" label="客户" min-width="140" show-overflow-tooltip />
          <el-table-column label="要说次数" width="90" align="center">
            <template #default="{ row }">{{ row.times }}</template>
          </el-table-column>
          <el-table-column label="能不能发" width="110">
            <template #default="{ row }">
              <el-tag :type="row.canSend ? 'success' : 'info'" size="small">
                {{ row.canSend ? (row.channel === 1 ? '订阅消息' : '客服消息') : '发不了' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="说明" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.reason || '—' }}</template>
          </el-table-column>
        </el-table>

        <div class="admin-demand-sub-title">需求明细（{{ detail.items.length }} 条，原话片段，不含电话/地址）</div>
        <el-table :data="detail.items" size="small" border max-height="300">
          <el-table-column prop="rawText" label="原话片段" min-width="140" show-overflow-tooltip />
          <el-table-column label="数量" width="110">
            <template #default="{ row }">{{ row.qtyText || (row.qty != null ? row.qty + (row.unit || '') : '-') }}</template>
          </el-table-column>
          <el-table-column label="类型" width="130">
            <template #default="{ row }">
              <el-tag :type="row.kind === 1 ? 'warning' : 'info'" size="small">{{ row.kindText }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="sourceText" label="来源" width="90" />
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>

        <div class="admin-demand-sub-title">通知记录</div>
        <el-table :data="detail.notifyLogs" size="small" border max-height="240">
          <el-table-column prop="channelText" label="通道" width="100" />
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag :type="row.result === 'ok' ? 'success' : 'danger'" size="small">{{ row.result }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="errCode" label="错误码" width="90" />
          <el-table-column prop="errMsg" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
        <div v-if="!detail.notifyLogs.length" class="admin-demand-empty-tip">还没发过到货通知</div>

        <div style="margin-top: 16px">
          <el-button v-if="detail.demand.status !== 2" type="primary" @click="markArrived(detail.demand, true)">标记已到货</el-button>
          <el-button v-else type="primary" @click="openNotify(detail.demand)">通知客户</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 备注/改名 -->
    <el-dialog v-model="editVisible" title="修改需求" width="460px">
      <el-form label-width="80px">
        <el-form-item label="显示名">
          <el-input v-model="editForm.name" maxlength="64" placeholder="后台展示用的菜名" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.note" type="textarea" :rows="3" maxlength="255" placeholder="采购渠道 / 报价 / 为什么放弃…" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 手动新增 -->
    <el-dialog v-model="createVisible" title="手动新增需求（电话 / 微信来的）" width="520px">
      <el-form label-width="90px">
        <el-form-item label="菜名" required>
          <el-input v-model="createForm.name" maxlength="64" placeholder="例如：荷兰豆" />
        </el-form-item>
        <el-form-item label="数量">
          <el-input v-model="createForm.qtyText" maxlength="32" placeholder="例如：20斤（可留空）" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.note" maxlength="255" placeholder="谁要的 / 联系电话 / 报价（可留空）" />
        </el-form-item>
        <el-form-item label="客户账号">
          <el-input v-model.number="createForm.purchaserId" placeholder="采购方ID，可留空" style="width: 200px" />
          <div class="admin-demand-field-tip">留空 = 运营代录：计入「共几次」，不计入「几人在要」</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">新增</el-button>
      </template>
    </el-dialog>

    <!-- 合并 -->
    <el-dialog v-model="mergeVisible" title="合并到另一条需求" width="520px">
      <div class="admin-demand-merge-tip">
        把「<b>{{ mergeSource?.name }}</b>」的明细与计数并入下面选中的那条，<b>源条目会被删除</b>。
        近似词不自动合并就是这个道理：由人确认是同一菜再并。
      </div>
      <el-select v-model="mergeTargetId" filterable placeholder="搜索并选择目标需求" style="width: 100%">
        <el-option
          v-for="d in mergeCandidates"
          :key="d.id"
          :label="`${d.name}（${d.purchaserCount}人 ${d.demandCount}次）`"
          :value="d.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="mergeVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!mergeTargetId" :loading="saving" @click="submitMerge">确认合并</el-button>
      </template>
    </el-dialog>

    <!-- 通知面板 -->
    <el-dialog v-model="notifyVisible" :title="'到货通知 · ' + (notifyPreview?.name || '')" width="680px">
      <template v-if="notifyPreview">
        <div v-if="!notifyPreview.templateConfigured" class="admin-demand-merge-tip">
          ⚠️ 运营还没配置到货通知模板（WX_SUBSCRIBE_TMPL_DEMAND），现在发不出去。
        </div>

        <!-- 发送前：三类名单 -->
        <template v-if="!notifyResult">
          <div class="admin-demand-sub-title">
            ① 可发订阅消息 · {{ notifyPreview.counts.canSubscribe }} 人
          </div>
          <el-table :data="notifyPreview.canSubscribe" size="small" border max-height="160">
            <el-table-column prop="shopName" label="客户" min-width="160" show-overflow-tooltip />
            <el-table-column prop="phone" label="电话" width="130" />
          </el-table>
          <div v-if="!notifyPreview.canSubscribe.length" class="admin-demand-empty-tip">没有已授权且有额度的客户</div>

          <div class="admin-demand-sub-title">
            ② 48 小时内可发客服消息 · {{ notifyPreview.counts.canCustom }} 人
          </div>
          <el-table :data="notifyPreview.canCustom" size="small" border max-height="160">
            <el-table-column prop="shopName" label="客户" min-width="160" show-overflow-tooltip />
            <el-table-column prop="phone" label="电话" width="130" />
          </el-table>
          <div v-if="!notifyPreview.canCustom.length" class="admin-demand-empty-tip">没有处在 48 小时窗口内的客户</div>

          <div class="admin-demand-sub-title">
            ③ 发不出去 · {{ notifyPreview.counts.cannot }} 人（进小程序「我的需求」列表，等其主动来访）
          </div>
          <el-table :data="notifyPreview.cannot" size="small" border max-height="200">
            <el-table-column prop="shopName" label="客户" min-width="140" show-overflow-tooltip />
            <el-table-column prop="reason" label="发不出去的原因" min-width="240" show-overflow-tooltip />
          </el-table>
          <div v-if="!notifyPreview.cannot.length" class="admin-demand-empty-tip">全都能发</div>

          <div class="admin-demand-notify-tip">
            确认后会<b>按上面的名单逐人实发</b>，并逐人写通知记录。发不出去的人不会被群发、也不会被记成「已通知」。
          </div>
        </template>

        <!-- 发送结果 -->
        <template v-else>
          <el-result
            :icon="notifyResult.failed ? 'warning' : 'success'"
            :title="`已通知 ${notifyResult.notified} 人，${notifyResult.failed} 人没发出去`"
          />
          <el-table v-if="notifyResult.failures.length" :data="notifyResult.failures" size="small" border max-height="260">
            <el-table-column prop="shopName" label="客户" min-width="140" show-overflow-tooltip />
            <el-table-column prop="channel" label="尝试通道" width="110" />
            <el-table-column prop="reason" label="没发出去的原因" min-width="240" show-overflow-tooltip />
          </el-table>
        </template>
      </template>
      <template #footer>
        <el-button @click="notifyVisible = false">关闭</el-button>
        <el-button
          v-if="!notifyResult && notifyPreview?.templateConfigured"
          type="primary"
          :loading="sending"
          @click="submitNotify"
        >确认发送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { demandAdminApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const exporting = ref(false)
const saving = ref(false)
const sending = ref(false)

const statusFilter = ref('')
const keyword = ref('')
const sort = ref('hot')
const stats = ref({ pending: 0, newThisWeek: 0, hot: 0 })
const templateConfigured = ref(true)

const detailVisible = ref(false)
const detail = ref(null)

const editVisible = ref(false)
const editForm = ref({ id: null, name: '', note: '' })

const createVisible = ref(false)
const createForm = ref({ name: '', qtyText: '', note: '', purchaserId: undefined })

const mergeVisible = ref(false)
const mergeSource = ref(null)
const mergeTargetId = ref(null)
const mergeCandidates = ref([])

const notifyVisible = ref(false)
const notifyPreview = ref(null)
const notifyResult = ref(null)

const STATUS_TYPE = { 0: 'warning', 1: 'primary', 2: 'success', 3: 'info' }
const statusType = (s) => STATUS_TYPE[s] || 'info'

function fmtTime(s) {
  if (!s) return '-'
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
}

const queryParams = () => {
  const p = { page: page.value, pageSize, sort: sort.value }
  if (statusFilter.value !== '') p.status = statusFilter.value
  if (keyword.value.trim()) p.keyword = keyword.value.trim()
  return p
}

// ⚠️ 仓库约定「坑 9」：loading 必须 try/catch/finally 兜底
async function load() {
  loading.value = true
  try {
    const data = await demandAdminApi.list(queryParams())
    list.value = data.list || []
    total.value = data.total || 0
    stats.value = data.stats || stats.value
    templateConfigured.value = !!data.templateConfigured
  } catch (e) {
    /* 错误已由 request 拦截器提示 */
  } finally {
    loading.value = false
  }
}

function onQuery() {
  page.value = 1
  load()
}

/** 点「待采购」统计卡 → 只看待采购 */
function filterPending() {
  statusFilter.value = 0
  onQuery()
}

async function onExport() {
  exporting.value = true
  try {
    const params = {}
    if (statusFilter.value !== '') params.status = statusFilter.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    const buf = await demandAdminApi.exportCsv(params)
    // ⚠️ buf 是**原始字节**（含后端给的 UTF-8 BOM），直接进 Blob，不要先转字符串
    //    —— 转字符串会把 BOM 洗掉，Excel 打开就是乱码。
    const blob = new Blob([buf], { type: 'text/csv;charset=utf-8' })
    // 文件名用**本地日期**：toISOString() 是 UTC，晚上导出会写成前一天
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `采购需求-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    ElMessage.success('已导出，可直接用 Excel 打开')
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  } finally {
    exporting.value = false
  }
}

async function openDetail(row) {
  detailVisible.value = true
  detail.value = null
  try {
    detail.value = await demandAdminApi.detail(row.id)
  } catch (e) {
    detailVisible.value = false
  }
}

function openEdit(row) {
  editForm.value = { id: row.id, name: row.name, note: row.note || '' }
  editVisible.value = true
}

async function submitEdit() {
  saving.value = true
  try {
    await demandAdminApi.update(editForm.value.id, {
      name: editForm.value.name,
      note: editForm.value.note,
    })
    ElMessage.success('已保存')
    editVisible.value = false
    if (detailVisible.value && detail.value?.demand?.id === editForm.value.id) openDetail({ id: editForm.value.id })
    load()
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false
  }
}

async function setStatus(row, status, label) {
  try {
    await ElMessageBox.confirm(`确认把「${row.name}」标记为「${label}」？`, '二次确认', {
      confirmButtonText: '确认',
      cancelButtonText: '再想想',
      type: 'warning',
    })
  } catch {
    return false
  }
  try {
    await demandAdminApi.update(row.id, { status })
    ElMessage.success(`已标记为${label}`)
    return true
  } catch (e) {
    return false
  }
}

async function markOrdered(row) {
  if (await setStatus(row, 1, '已下单采购中')) load()
}

async function abandon(row) {
  if (await setStatus(row, 3, '已放弃')) {
    if (detailVisible.value) detailVisible.value = false
    load()
  }
}

/** 标记已到货 → 立刻弹通知面板（口径 6：到货商品不自动上架，上架由大辉确认） */
async function markArrived(row, fromDetail = false) {
  const ok = await setStatus(row, 2, '已到货')
  if (!ok) return
  await load()
  if (fromDetail) detailVisible.value = false
  openNotify(row)
}

function openCreate() {
  createForm.value = { name: '', qtyText: '', note: '', purchaserId: undefined }
  createVisible.value = true
}

async function submitCreate() {
  const f = createForm.value
  if (!f.name || !f.name.trim()) {
    ElMessage.warning('请填菜名')
    return
  }
  saving.value = true
  try {
    const body = { name: f.name.trim() }
    if (f.qtyText) body.qtyText = f.qtyText
    if (f.note) body.note = f.note
    if (f.purchaserId) body.purchaserId = Number(f.purchaserId)
    await demandAdminApi.create(body)
    ElMessage.success('已新增')
    createVisible.value = false
    // 仓库约定：新记录必须出现在第一屏 → 新增后切「最近优先」并回第 1 页
    sort.value = 'recent'
    page.value = 1
    load()
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false
  }
}

async function openMerge(row) {
  mergeSource.value = row
  mergeTargetId.value = null
  try {
    const data = await demandAdminApi.list({ page: 1, pageSize: 100, sort: 'hot' })
    mergeCandidates.value = (data.list || []).filter((d) => d.id !== row.id)
  } catch (e) {
    mergeCandidates.value = []
  }
  mergeVisible.value = true
}

async function submitMerge() {
  if (!mergeTargetId.value) return
  const target = mergeCandidates.value.find((d) => d.id === mergeTargetId.value)
  try {
    await ElMessageBox.confirm(
      `确认把「${mergeSource.value.name}」并入「${target?.name}」？源条目会被删除，明细与计数相加。`,
      '二次确认',
      { confirmButtonText: '确认合并', cancelButtonText: '再想想', type: 'warning' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    await demandAdminApi.merge(mergeSource.value.id, mergeTargetId.value)
    ElMessage.success('已合并')
    mergeVisible.value = false
    if (detailVisible.value) detailVisible.value = false
    load()
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false
  }
}

async function openNotify(row) {
  notifyResult.value = null
  notifyPreview.value = null
  notifyVisible.value = true
  try {
    notifyPreview.value = await demandAdminApi.notifyPreview(row.id)
  } catch (e) {
    notifyVisible.value = false
  }
}

async function submitNotify() {
  sending.value = true
  try {
    notifyResult.value = await demandAdminApi.notify(notifyPreview.value.demandId)
    load()
    if (detailVisible.value && detail.value?.demand?.id === notifyPreview.value.demandId) {
      openDetail({ id: notifyPreview.value.demandId })
    }
  } catch (e) {
    /* 错误已由拦截器提示（未配置模板时会返回「运营还没配置到货通知模板」） */
  } finally {
    sending.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.admin-demand-page { padding: 0; }
.admin-demand-crumb { font-size: 13px; color: #909399; margin-bottom: 16px; }
.admin-demand-alert { margin-bottom: 16px; }

.admin-demand-stats { display: flex; gap: 16px; margin-bottom: 16px; }
.admin-demand-stat {
  flex: 1; background: #fff; border-radius: 8px; padding: 16px 20px;
  border: 1px solid #ebeef5;
}
.admin-demand-stat.clickable { cursor: pointer; }
.admin-demand-stat.clickable:hover { border-color: #00B96B; }
.admin-demand-stat-num { font-size: 26px; font-weight: 700; color: #303133; line-height: 1.2; }
.admin-demand-stat-lbl { font-size: 13px; color: #606266; margin-top: 4px; }
.admin-demand-stat-tip { font-size: 11px; color: #a8abb2; margin-top: 4px; }

.admin-demand-filter-card { margin-bottom: 16px; }
.admin-demand-filter { display: flex; align-items: center; flex-wrap: wrap; }
.admin-demand-spacer { flex: 1; }
.admin-demand-sort-tip { font-size: 12px; color: #909399; margin-top: 10px; }
.admin-demand-table-card { margin-bottom: 24px; }

.admin-demand-sub-title { font-size: 14px; font-weight: 600; margin: 16px 0 8px; color: #303133; }
.admin-demand-empty-tip { font-size: 12px; color: #909399; padding: 6px 0; }
.admin-demand-field-tip { font-size: 11px; color: #909399; margin-left: 8px; }
.admin-demand-merge-tip {
  background: #f5f7fa; border-radius: 8px; padding: 10px 12px; font-size: 12px;
  color: #606266; line-height: 1.8; margin-bottom: 12px;
}
.admin-demand-notify-tip {
  background: #fdf6ec; border-radius: 8px; padding: 10px 12px; font-size: 12px;
  color: #b88230; line-height: 1.8; margin-top: 12px;
}
</style>
