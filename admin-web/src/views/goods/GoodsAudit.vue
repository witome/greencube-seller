<template>
  <div>
    <el-tabs v-model="activeTab">
      <!-- 待审核新品 -->
      <el-tab-pane label="待审核新品" name="apply">
        <el-card shadow="never">
          <!-- 卡BS（2026-10-03）：筛选条（供应商 / 分类 / 关键字）+ 批量通过 -->
          <div class="filter-bar">
            <el-select v-model="applyFilter.supplierName" placeholder="全部供应商" clearable style="width:160px">
              <el-option v-for="s in supplierOptions" :key="s" :label="s" :value="s" />
            </el-select>
            <el-select v-model="applyFilter.categoryId" placeholder="全部分类" clearable style="width:140px">
              <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
            <el-input v-model="applyFilter.keyword" placeholder="商品名称关键字" clearable style="width:180px" />
            <el-button @click="resetApplyFilter">重置</el-button>
            <span class="filter-count">筛选后 {{ filteredPending.length }} / 共 {{ allPending.length }} 条</span>
            <el-button
              type="success"
              :disabled="!selectedApplies.length"
              @click="openBatchApprove"
            >批量通过（已选 {{ selectedApplies.length }} 条）</el-button>
          </div>
          <el-table :data="filteredPending" v-loading="loading" stripe @selection-change="onApplySelectionChange">
            <el-table-column type="selection" width="46" />
            <!-- 卡CA（2026-10-04）：图片列（封面 44 + 资质 22×2 + "+N"）；所有缩略图共用一个
                 合并预览列表 photoList(row)，点哪张从哪张开始翻页；preview-teleported 防表格裁剪 -->
            <el-table-column label="图片" width="104">
              <template #default="{ row }">
                <div class="ph-cell">
                  <template v-if="photoList(row).length">
                    <el-image
                      v-if="row.cover"
                      :src="row.cover"
                      :preview-src-list="photoList(row)"
                      :initial-index="0"
                      :preview-teleported="true"
                      show-progress
                      fit="cover"
                      class="ph-cov"
                      title="封面 · 点击放大"
                    >
                      <template #error>
                        <div class="ph-fail" title="封面加载失败">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="#B3B9C2" stroke-width="1.6"/><circle cx="9" cy="10" r="1.8" fill="#B3B9C2"/><path d="M4 18l5-5 3 3 4-4 4 4" stroke="#B3B9C2" stroke-width="1.6"/><line x1="3" y1="21" x2="21" y2="3" stroke="#B3B9C2" stroke-width="1.6"/></svg>
                        </div>
                      </template>
                    </el-image>
                    <div v-else class="ph-nocov">无封面</div>
                    <div v-if="qualThumbs(row).list.length" class="ph-qs">
                      <el-image
                        v-for="(src, i) in qualThumbs(row).list"
                        :key="i"
                        :src="src"
                        :preview-src-list="photoList(row)"
                        :initial-index="qualThumbs(row).start + i"
                        :preview-teleported="true"
                      show-progress
                        fit="cover"
                        class="ph-q"
                        :title="`资质证明 ${i + 1} · 点击放大`"
                      >
                        <template #error><div class="ph-qerr" /></template>
                      </el-image>
                      <!-- 超出 2 张的资质合并为 +N：可点，从第 3 张资质开始看（角标不挡点击） -->
                      <div v-if="qualThumbs(row).extra > 0" class="ph-more">
                        <el-image
                          :src="photoList(row)[qualThumbs(row).start + 2]"
                          :preview-src-list="photoList(row)"
                          :initial-index="qualThumbs(row).start + 2"
                          :preview-teleported="true"
                      show-progress
                          fit="cover"
                          class="ph-q"
                          :title="`还有 ${qualThumbs(row).extra} 张资质 · 点击放大查看`"
                        />
                        <span class="ph-more-tag">+{{ qualThumbs(row).extra }}</span>
                      </div>
                    </div>
                  </template>
                  <span v-else class="ph-none">—</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="商品名称" min-width="140" />
            <el-table-column prop="supplierName" label="供应商" width="120" />
            <el-table-column label="供货价" width="100">
              <template #default="{ row }">¥{{ row.supplyPrice }}</template>
            </el-table-column>
            <el-table-column label="日可供量" width="90">
              <template #default="{ row }">{{ row.dailySupply }}</template>
            </el-table-column>
            <el-table-column label="计量" width="90">
              <template #default="{ row }">{{ row.weighType === 1 ? '称重' : '固定规格' }}</template>
            </el-table-column>
            <!-- 卡BP（2026-10-02）：商品备注随新品申请一起审核 -->
            <el-table-column label="商品备注" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '—' }}</template>
            </el-table-column>
            <el-table-column label="提交时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.submittedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button type="success" link @click="openApprove(row)">通过</el-button>
                <el-button type="danger" link @click="openReject(row)">驳回</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!allPending.length && !loading" description="暂无待审核新品" />
        </el-card>
      </el-tab-pane>

      <!-- 待审核变更 -->
      <el-tab-pane label="待审核变更" name="change">
        <el-card shadow="never">
          <!-- 卡BS（2026-10-03）：变更 tab 筛选条 + 批量通过（筛选同上：前端过滤，全选只作用于筛选结果） -->
          <div class="filter-bar">
            <el-select v-model="changeFilter.supplierName" placeholder="全部供应商" clearable style="width:160px">
              <el-option v-for="s in supplierOptions" :key="s" :label="s" :value="s" />
            </el-select>
            <el-input v-model="changeFilter.keyword" placeholder="商品名称关键字" clearable style="width:180px" />
            <el-button @click="resetChangeFilter">重置</el-button>
            <span class="filter-count">筛选后 {{ filteredChange.length }} / 共 {{ allChange.length }} 条</span>
            <el-button
              type="success"
              :disabled="!selectedChanges.length"
              @click="openBatchChange"
            >批量通过（已选 {{ selectedChanges.length }} 条）</el-button>
          </div>
          <el-table :data="filteredChange" v-loading="loading" stripe @selection-change="onChangeSelectionChange">
            <el-table-column type="selection" width="46" />
            <el-table-column prop="productName" label="商品" width="120" />
            <el-table-column prop="supplierName" label="供应商" width="120" />
            <el-table-column label="变更内容（原值 → 新值）" min-width="220">
              <template #default="{ row }">
                <div v-for="(d, i) in row.diffs" :key="i" class="diff-row">
                  <span class="diff-field">{{ d.fieldText }}：</span>
                  <span class="diff-old">{{ d.oldValue }}</span>
                  <span class="diff-arrow">→</span>
                  <span class="diff-new">{{ d.newValue }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="160">
              <template #default="{ row }">{{ fmtTime(row.submittedAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button type="success" link @click="approveChange(row)">通过</el-button>
                <el-button type="danger" link @click="openRejectChange(row)">驳回</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!allChange.length && !loading" description="暂无待审核变更" />
        </el-card>
      </el-tab-pane>

      <!-- 供货优先级（在售商品多供应商排序） -->
      <el-tab-pane label="供货优先级" name="priority">
        <el-card shadow="never">
          <el-table :data="priorityProducts" v-loading="priorityLoading" stripe>
            <el-table-column prop="name" label="商品名称" min-width="160" />
            <el-table-column label="销售价" width="100">
              <template #default="{ row }">¥{{ row.salePrice }}</template>
            </el-table-column>
            <el-table-column label="供货供应商数" width="120">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.supplierCount }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="140" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link @click="openPriority(row)">设置优先级</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-if="!priorityProducts.length && !priorityLoading" description="暂无可设置优先级的商品" />
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新品通过弹窗（卡BQ 2026-10-03：比例可留空 —— 留空=按 供应商>分类>全局 自动算（markupOverridden=0）；
         手动填写=固定为「单品」比例（markupOverridden=1，之后调档位不影响它）。照原型屏2两种态） -->
    <el-dialog v-model="approveDialog" title="审核通过 · 上架商品" width="480px">
      <p style="color:#606266; margin-bottom:12px">
        「{{ currentApply?.name }}」供货价 ¥{{ currentApply?.supplyPrice }}，请设定加价比例生成销售价。
      </p>
      <!-- 卡CA（2026-10-04）：弹窗带图（原型画面3）—— 封面+资质全部平铺、无 +N 截断，
           同一个合并预览列表可点开放大；无图时整块不渲染 -->
      <div v-if="currentApply && photoList(currentApply).length" class="dlg-photos">
        <div class="dlg-photos-t">供应商上传的图片<em>封面 + 资质证明 · 点击可放大</em></div>
        <div class="dlg-photos-row">
          <el-image
            v-for="(src, i) in photoList(currentApply)"
            :key="i"
            :src="src"
            :preview-src-list="photoList(currentApply)"
            :initial-index="i"
            :preview-teleported="true"
            show-progress
            fit="cover"
            :class="i === 0 && currentApply.cover ? 'dlg-ph-cov' : 'dlg-ph-q'"
            :title="i === 0 && currentApply.cover ? '封面 · 点击放大' : `资质证明 ${currentApply.cover ? i : i + 1} · 点击放大`"
          >
            <template #error><div class="ph-qerr" /></template>
          </el-image>
        </div>
      </div>
      <el-form label-width="110px">
        <el-form-item label="加价比例">
          <el-input
            v-model="markupRateInput"
            placeholder="留空则自动按档位计算"
            style="width: 180px"
            clearable
          />
          <span class="tip">（如 0.3 = 加价 30%）</span>
          <div v-if="!rateFilled" class="rate-hint">
            留空 = 按 供应商 &gt; 分类 &gt; 全局 自动计算（当前会算出 {{ Math.round(defaultRate * 100) }}%）
          </div>
          <div v-else class="rate-hint orange">
            手动填写会把此商品固定为「单品」比例，之后调整供应商/分类/全局比例不会影响它
          </div>
        </el-form-item>
        <el-form-item label="销售价预览">
          <span class="preview">¥{{ previewSalePrice }}</span>
          <span class="preview-src">
            按「{{ rateFilled ? `单品 ${Math.round(rateNum * 100)}%` : `${defaultSource} ${Math.round(defaultRate * 100)}%` }}」实时算出
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveDialog = false">取消</el-button>
        <el-button type="success" :loading="submitting" @click="submitApprove">确认通过并上架</el-button>
      </template>
    </el-dialog>

    <!-- 新品驳回弹窗 -->
    <el-dialog v-model="rejectDialog" title="驳回新品申请" width="480px">
      <el-input v-model="rejectReason" type="textarea" :rows="3" placeholder="驳回原因（必填，将通知供应商）" />
      <template #footer>
        <el-button @click="rejectDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="submitReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 变更驳回弹窗 -->
    <el-dialog v-model="rejectChangeDialog" title="驳回变更申请" width="480px">
      <el-input v-model="rejectChangeComment" type="textarea" :rows="3" placeholder="驳回原因（选填）" />
      <template #footer>
        <el-button @click="rejectChangeDialog = false">取消</el-button>
        <el-button type="danger" :loading="submitting" @click="submitRejectChange">确认驳回</el-button>
      </template>
    </el-dialog>

    <!-- 卡BS（2026-10-03）：新品批量通过 —— 沿用单条通过的定价口径（留空=档位自动 / 填写=固定单品） -->
    <el-dialog v-model="batchDialog" title="批量通过 · 待审核新品" width="560px">
      <el-alert
        type="warning"
        :closable="false"
        :title="`将通过 ${selectedApplies.length} 条，涉及 ${applySupplierCount} 个供应商`"
        style="margin-bottom:12px"
      />
      <p class="batch-line">供货价区间：¥{{ applyPriceRange }}</p>
      <el-form label-width="110px">
        <el-form-item label="加价比例">
          <el-input v-model="batchRateInput" placeholder="留空则按档位自动计算" style="width:180px" clearable />
          <span class="tip">（如 0.3 = 加价 30%）</span>
          <div v-if="!batchRateFilled" class="rate-hint">
            留空 = 按 供应商 &gt; 分类 &gt; 全局 自动计算（与单条通过同一套逻辑）
          </div>
          <div v-else class="rate-hint orange">
            统一填写会把这批商品都固定为「单品」比例，之后调整供应商/分类/全局比例不会影响它们
          </div>
        </el-form-item>
      </el-form>
      <p class="batch-note">通过后如需改价，去「商品管理」改，或让供应商提变更。</p>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="success" :loading="submitting" @click="submitBatchApprove">确认通过 {{ selectedApplies.length }} 条</el-button>
      </template>
    </el-dialog>

    <!-- 卡BS（2026-10-03）：变更批量通过 —— 通过后立即改动在售价格 -->
    <el-dialog v-model="batchChangeDialog" title="批量通过 · 待审核变更" width="560px">
      <el-alert
        type="warning"
        :closable="false"
        :title="`将通过 ${selectedChanges.length} 条变更，涉及 ${changeSupplierCount} 个供应商`"
        style="margin-bottom:12px"
      />
      <p class="batch-danger">通过后立即改动在售价格，对采购方即时生效</p>
      <ul class="batch-list">
        <li v-for="r in selectedChanges" :key="r.changeId">{{ r.productName }}（{{ r.supplierName }}）</li>
      </ul>
      <p class="batch-note">通过后如需改价，去「商品管理」改，或让供应商提变更。</p>
      <template #footer>
        <el-button @click="batchChangeDialog = false">取消</el-button>
        <el-button type="success" :loading="submitting" @click="submitBatchChange">确认通过 {{ selectedChanges.length }} 条</el-button>
      </template>
    </el-dialog>

    <!-- 供货优先级设置弹窗 -->
    <el-dialog v-model="priorityDialog" :title="`供货优先级 · ${currentPriority?.productName || ''}`" width="560px">
      <el-alert type="info" :closable="false" title="优先级数字越小越优先（自动拆单时优先分配），按供应商调整后保存" style="margin-bottom:12px" />
      <el-table :data="priorityList" v-loading="priorityDetailLoading" stripe>
        <el-table-column prop="supplierName" label="供应商" min-width="140" />
        <el-table-column label="供货价" width="100">
          <template #default="{ row }">¥{{ row.supplyPrice }}</template>
        </el-table-column>
        <el-table-column label="日可供量" width="100">
          <template #default="{ row }">{{ row.dailySupply }}</template>
        </el-table-column>
        <el-table-column label="优先级" width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.priority" :min="1" :max="99" size="small" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="priorityDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="savePriority">保存优先级</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { goodsAdminApi, pricingAdminApi, userAdminApi, categoryAdminApi } from '../../api/modules'

const activeTab = ref('apply')
const loading = ref(false)
const submitting = ref(false)

// 卡BS（2026-10-03）：接口原样数据 + 筛选结果分离（:data 绑筛选结果 → 表头全选天然只作用于筛选结果）
const allPending = ref([])
const allChange = ref([])
const applyFilter = ref({ supplierName: '', categoryId: null, keyword: '' })
const changeFilter = ref({ supplierName: '', keyword: '' })
const selectedApplies = ref([])
const selectedChanges = ref([])
const supplierOptions = ref([])
const categoryOptions = ref([])
// 卡BS：批量通过弹窗（新品 / 变更）
const batchDialog = ref(false)
const batchChangeDialog = ref(false)
const batchRateInput = ref('')

// 供货优先级
const priorityProducts = ref([])
const priorityLoading = ref(false)
const priorityDialog = ref(false)
const priorityDetailLoading = ref(false)
const currentPriority = ref(null)
const priorityList = ref([])

const approveDialog = ref(false)
const rejectDialog = ref(false)
const rejectChangeDialog = ref(false)
const currentApply = ref(null)
const currentChange = ref(null)
// 卡BQ（2026-10-03）：加价比例可留空 —— 留空=档位自动（不传 markupRate）；填了=固定单品
const markupRateInput = ref('')
const rejectReason = ref('')
const rejectChangeComment = ref('')

// 档位配置（供应商>分类>全局），供「当前会算出 X%」预览用；提交以后端 resolveDefaultMarkup 为准
const markupCfg = ref(null)
const defaultResolve = ref({ rate: 0.3, source: '全局默认' })

const rateNum = computed(() => {
  const v = parseFloat(markupRateInput.value)
  return isNaN(v) ? null : v
})
const rateFilled = computed(() => rateNum.value !== null)
const defaultRate = computed(() => defaultResolve.value.rate)
const defaultSource = computed(() => defaultResolve.value.source)

// ── 卡BS（2026-10-03）：前端筛选（供应商 / 分类 / 关键字）→ 表头全选只作用于筛选结果 ──
function matchRow(row, f) {
  if (f.supplierName && row.supplierName !== f.supplierName) return false
  if (f.categoryId != null && row.categoryId !== f.categoryId) return false
  const kw = (f.keyword || '').trim().toLowerCase()
  if (kw && !String(row.name || '').toLowerCase().includes(kw)) return false
  return true
}
const filteredPending = computed(() => allPending.value.filter((r) => matchRow(r, applyFilter.value)))
const filteredChange = computed(() => {
  const f = changeFilter.value
  const kw = (f.keyword || '').trim().toLowerCase()
  return allChange.value.filter((r) => {
    if (f.supplierName && r.supplierName !== f.supplierName) return false
    if (kw && !String(r.productName || '').toLowerCase().includes(kw)) return false
    return true
  })
})
function resetApplyFilter() { applyFilter.value = { supplierName: '', categoryId: null, keyword: '' } }
function resetChangeFilter() { changeFilter.value = { supplierName: '', keyword: '' } }
function onApplySelectionChange(rows) { selectedApplies.value = rows }
function onChangeSelectionChange(rows) { selectedChanges.value = rows }

// ── 卡CA（2026-10-04）：审核看图 —— 封面+资质合并成一个预览列表（封面在前）；
// images 后端已保证是数组，这里再兜一层，绝不让 v-for 拿到 null/undefined ──
function photoList(row) {
  if (!row) return []
  const imgs = Array.isArray(row.images) ? row.images.filter(Boolean) : []
  return row.cover ? [row.cover, ...imgs] : [...imgs]
}
// 图片列资质缩略格：最多排 2 张 22×22，其余合并为 +N；start = 该格在合并列表里的起始下标（有封面则资质从 1 起）
function qualThumbs(row) {
  const start = row && row.cover ? 1 : 0
  const imgs = photoList(row).slice(start)
  return { list: imgs.slice(0, 2), start, extra: Math.max(imgs.length - 2, 0) }
}
// 批量弹窗展示用：涉及供应商数 / 供货价区间
const applySupplierCount = computed(() => new Set(selectedApplies.value.map((r) => r.supplierName)).size)
const changeSupplierCount = computed(() => new Set(selectedChanges.value.map((r) => r.supplierName)).size)
const applyPriceRange = computed(() => {
  const ps = selectedApplies.value.map((r) => Number(r.supplyPrice) || 0).filter((n) => !isNaN(n))
  if (!ps.length) return '0.00 — 0.00'
  return `${Math.min(...ps).toFixed(2)} — ${Math.max(...ps).toFixed(2)}`
})
const batchRateNum = computed(() => {
  const v = parseFloat(batchRateInput.value)
  return isNaN(v) ? null : v
})
const batchRateFilled = computed(() => batchRateNum.value !== null)

// 展示层近似解析（与后端 resolveMarkupFromConfigs 同口径）：供应商 > 分类 > 全局 > 0.30
// pending 接口只回 supplierName，按档口名匹配配置（仅预览展示用，落库值由后端权威解析）
function resolveDefaultFor(row) {
  const cfg = markupCfg.value
  if (!cfg || !row) return { rate: 0.3, source: '全局默认' }
  const sup = (cfg.suppliers || []).find((s) => s.stallName === row.supplierName && s.rate != null)
  if (sup) return { rate: sup.rate, source: '供应商' }
  const cat = (cfg.categories || []).find((c) => c.categoryId === row.categoryId && c.rate != null)
  if (cat) return { rate: cat.rate, source: '分类' }
  if (cfg.global != null) return { rate: cfg.global, source: '全局默认' }
  return { rate: 0.3, source: '全局默认' }
}

const previewSalePrice = computed(() => {
  if (!currentApply.value) return '0.00'
  const rate = rateFilled.value ? rateNum.value : defaultRate.value
  return ((currentApply.value.supplyPrice || 0) * (1 + rate)).toFixed(2)
})

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    allPending.value = await goodsAdminApi.getGoodsPending()
    allChange.value = await goodsAdminApi.getGoodsChangePending()
    selectedApplies.value = []
    selectedChanges.value = []
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

// 卡BQ：档位配置加载（预览用；失败不阻断审核，回退 0.30）
async function loadMarkupCfg() {
  try {
    markupCfg.value = await pricingAdminApi.getMarkupConfig()
  } catch (e) { markupCfg.value = null }
}

function openApprove(row) {
  currentApply.value = row
  markupRateInput.value = '' // 默认留空态（照原型屏2）
  defaultResolve.value = resolveDefaultFor(row)
  approveDialog.value = true
}

function openReject(row) {
  currentApply.value = row
  rejectReason.value = ''
  rejectDialog.value = true
}

async function submitApprove() {
  if (rateFilled.value && (rateNum.value < 0 || rateNum.value > 2)) {
    ElMessage.warning('加价比例需在 0 ~ 2 之间（如 0.3 = 加价 30%）')
    return
  }
  submitting.value = true
  try {
    // 卡BQ：留空时**只传 approved** —— 比例与销售价一律由后端 resolveDefaultMarkup 权威解析
    // （前端预览仅展示用）。卡BQ 复核建议（2026-10-03）：原先前端还传一个按预览档位算出的
    // salePrice，等于把定价权交给前端的档口名匹配逻辑，预览与落库有分叉风险，故不再传。
    const payload = { approved: true }
    if (rateFilled.value) {
      payload.markupRate = rateNum.value
    }
    await goodsAdminApi.reviewGoodsApply(currentApply.value.applyId, payload)
    ElMessage.success(
      rateFilled.value
        ? `已通过。该商品已固定为「单品 ${Math.round(rateNum.value * 100)}%」`
        : `已通过。该商品按「${defaultSource.value} ${Math.round(defaultRate.value * 100)}%」定价`,
    )
    approveDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

// ── 卡BS（2026-10-03）：批量通过（新品 / 变更）──
const BATCH_LIMIT = 50

function openBatchApprove() {
  if (!selectedApplies.value.length) return
  if (selectedApplies.value.length > BATCH_LIMIT) {
    ElMessage.warning(`一次最多 ${BATCH_LIMIT} 条，请分批`)
    return
  }
  batchRateInput.value = '' // 默认留空 = 按档位自动（与单条通过同口径）
  batchDialog.value = true
}

async function submitBatchApprove() {
  if (batchRateFilled.value && (batchRateNum.value < 0 || batchRateNum.value > 2)) {
    ElMessage.warning('加价比例需在 0 ~ 2 之间（如 0.3 = 加价 30%）')
    return
  }
  const ids = selectedApplies.value.map((r) => r.applyId)
  if (ids.length > BATCH_LIMIT) { ElMessage.warning(`一次最多 ${BATCH_LIMIT} 条，请分批`); return }
  submitting.value = true
  try {
    const res = await goodsAdminApi.batchReviewGoodsApply(ids, batchRateFilled.value ? batchRateNum.value : null)
    batchDialog.value = false
    reportBatchResult(res, '新品')
    load()
  } catch (e) { /* 已提示 */ } finally { submitting.value = false }
}

function openBatchChange() {
  if (!selectedChanges.value.length) return
  if (selectedChanges.value.length > BATCH_LIMIT) {
    ElMessage.warning(`一次最多 ${BATCH_LIMIT} 条，请分批`)
    return
  }
  batchChangeDialog.value = true
}

async function submitBatchChange() {
  const ids = selectedChanges.value.map((r) => r.changeId)
  if (ids.length > BATCH_LIMIT) { ElMessage.warning(`一次最多 ${BATCH_LIMIT} 条，请分批`); return }
  submitting.value = true
  try {
    const res = await goodsAdminApi.batchReviewGoodsChange(ids)
    batchChangeDialog.value = false
    reportBatchResult(res, '变更')
    load()
  } catch (e) { /* 已提示 */ } finally { submitting.value = false }
}

// 部分失败也要给出可读明细（商品名 + 失败原因），不能只报数字
function reportBatchResult(res, label) {
  const approved = res?.approved ?? 0
  const failed = res?.failed || []
  if (!failed.length) {
    ElMessage.success(`${label}批量通过成功 ${approved} 条`)
    return
  }
  const lines = failed.map((f) => `${f.name ? `${f.name}：` : ''}${f.reason}（id ${f.id}）`).join('<br>')
  ElMessageBox.alert(
    `成功 ${approved} 条，失败 ${failed.length} 条：<br><span style="color:#f56c6c">${lines}</span>`,
    `${label}批量通过结果`,
    { dangerouslyUseHTMLString: true, confirmButtonText: '知道了' },
  )
}

async function submitReject() {
  if (!rejectReason.value.trim()) { ElMessage.warning('请填写驳回原因'); return }
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsApply(currentApply.value.applyId, { approved: false, rejectReason: rejectReason.value.trim() })
    ElMessage.success('已驳回')
    rejectDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function approveChange(row) {
  // 卡BS（2026-10-03）：单条「通过」原先点一下直接改在售价格，补二次确认
  try {
    await ElMessageBox.confirm(
      `通过后立即改动「${row.productName}」的在售价格，对采购方即时生效。<br>通过后如需改价，去商品管理改，或让供应商提变更。`,
      '确认通过这条变更？',
      { type: 'warning', dangerouslyUseHTMLString: true, confirmButtonText: '确认通过', cancelButtonText: '取消' },
    )
  } catch (e) {
    return // 用户取消 → 不生效
  }
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsChange(row.changeId, { approved: true })
    ElMessage.success('变更已生效')
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

function openRejectChange(row) {
  currentChange.value = row
  rejectChangeComment.value = ''
  rejectChangeDialog.value = true
}

async function submitRejectChange() {
  submitting.value = true
  try {
    await goodsAdminApi.reviewGoodsChange(currentChange.value.changeId, { approved: false, comment: rejectChangeComment.value })
    ElMessage.success('已驳回')
    rejectChangeDialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

// ── 供货优先级 ──
async function loadPriorityProducts() {
  priorityLoading.value = true
  try {
    priorityProducts.value = await pricingAdminApi.getList()
  } catch (e) { /* 已提示 */ } finally {
    priorityLoading.value = false
  }
}

async function openPriority(row) {
  currentPriority.value = row
  priorityDetailLoading.value = true
  priorityDialog.value = true
  try {
    const detail = await goodsAdminApi.getPriority(row.productId)
    priorityList.value = detail.suppliers || []
  } catch (e) {
    priorityList.value = []
  } finally {
    priorityDetailLoading.value = false
  }
}

async function savePriority() {
  submitting.value = true
  try {
    const items = priorityList.value.map((s) => ({ supplierId: s.supplierId, priority: s.priority }))
    await goodsAdminApi.setPriority(currentPriority.value.productId, items)
    ElMessage.success('优先级已保存')
    priorityDialog.value = false
    loadPriorityProducts()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

// 卡BS：筛选条下拉数据（供应商 / 分类）；失败不阻断审核，只是下拉为空
async function loadFilterOptions() {
  try {
    const sup = await userAdminApi.getSuppliers()
    supplierOptions.value = [...new Set((sup || []).map((s) => s.stallName).filter(Boolean))].sort()
  } catch (e) { supplierOptions.value = [] }
  try {
    const cats = await categoryAdminApi.getCategories()
    categoryOptions.value = (cats || [])
      .map((c) => ({ id: c.id != null ? c.id : c.categoryId, name: c.name }))
      .filter((c) => c.id != null)
  } catch (e) { categoryOptions.value = [] }
}

onMounted(() => {
  load()
  loadPriorityProducts()
  loadMarkupCfg()
  loadFilterOptions()
})
</script>

<style scoped>
.diff-row {
  padding: 2px 0;
  font-size: 13px;
}
.diff-field { color: #606266; }
.diff-old { color: #909399; text-decoration: line-through; margin-right: 6px; }
.diff-arrow { color: #c0c4cc; margin: 0 6px; }
.diff-new { color: #f56c6c; font-weight: 600; }
.tip { color: #909399; font-size: 12px; margin-left: 8px; }
.preview { color: #00b96b; font-size: 18px; font-weight: 700; }
/* 卡BQ：留空态灰字 / 手填态橙色警示 + 预览来源小字 */
.rate-hint { color: #8a9099; font-size: 12px; line-height: 1.6; margin-top: 4px; }
.rate-hint.orange { color: #ff8f1f; }
.preview-src { color: #8a9099; font-size: 11px; margin-left: 6px; }
/* 卡BS（2026-10-03）：筛选条 + 批量弹窗 */
.filter-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.filter-count { color: #8a9099; font-size: 12px; margin-right: auto; }
.batch-line { color: #606266; font-size: 13px; margin: 0 0 12px; }
.batch-note { color: #8a9099; font-size: 12px; margin: 12px 0 0; }
.batch-danger { color: #f56c6c; font-size: 13px; font-weight: 600; margin: 0 0 8px; }
.batch-list { margin: 0 0 8px; padding-left: 18px; color: #606266; font-size: 13px; max-height: 160px; overflow: auto; }
/* 卡CA（2026-10-04）：图片列 + 放大 + 通过弹窗带图（照原型逐项） */
.ph-cell { display: flex; align-items: center; gap: 6px; min-height: 44px; }
.ph-cov { width: 44px; height: 44px; border-radius: 6px; border: 1px solid #ebeef2; flex: 0 0 auto; cursor: pointer; }
.ph-qs { display: flex; flex-direction: column; flex-wrap: wrap; gap: 3px; height: 47px; align-content: flex-start; }
.ph-q { width: 22px; height: 22px; border-radius: 4px; border: 1px solid #ebeef2; flex: 0 0 auto; cursor: pointer; }
.ph-more { position: relative; width: 22px; height: 22px; flex: 0 0 auto; }
.ph-more .ph-q { border-color: #e5e8eb; }
.ph-more-tag { position: absolute; inset: 0; z-index: 1; display: flex; align-items: center; justify-content: center; background: rgba(242, 244, 246, 0.9); color: #8a9099; font-size: 10px; font-weight: 700; border-radius: 4px; pointer-events: none; }
.ph-none { color: #b3b9c2; font-size: 13px; }
.ph-nocov { width: 44px; height: 44px; border-radius: 6px; background: #f2f4f6; border: 1px solid #e5e8eb; color: #8a9099; font-size: 10px; display: flex; align-items: center; justify-content: center; text-align: center; line-height: 1.3; flex: 0 0 auto; }
.ph-fail, .ph-qerr { width: 100%; height: 100%; background: #f2f4f6; display: flex; align-items: center; justify-content: center; color: #b3b9c2; }
.dlg-photos { background: #f7f9fa; border: 1px solid #eef1f4; border-radius: 8px; padding: 10px 12px; margin: 0 0 14px; }
.dlg-photos-t { font-size: 12px; font-weight: 700; color: #1f2329; margin-bottom: 8px; }
.dlg-photos-t em { font-style: normal; font-weight: 400; color: #8a9099; font-size: 11px; margin-left: 8px; }
.dlg-photos-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dlg-ph-cov { width: 40px; height: 40px; border-radius: 6px; border: 1px solid #ebeef2; cursor: pointer; }
.dlg-ph-q { width: 22px; height: 22px; border-radius: 4px; border: 1px solid #ebeef2; cursor: pointer; }
</style>
