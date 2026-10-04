<template>
  <div>
    <el-card shadow="never">
      <!-- 工具栏 -->
      <div class="gm-toolbar">
        <div class="gm-toolbar-left">
          <el-input v-model="keyword" placeholder="🔍 搜索商品名称" clearable style="width: 220px" @keyup.enter="load" @clear="load" />
          <el-select v-model="categoryId" placeholder="全部分类" clearable style="width: 160px" @change="load">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-select v-model="status" placeholder="全部状态" clearable style="width: 140px" @change="load">
            <el-option label="在售" :value="1" />
            <el-option label="下架" :value="0" />
            <el-option label="变更审核中" :value="2" />
          </el-select>
          <el-button type="primary" @click="load">查询</el-button>
        </div>
        <el-button type="success" @click="openCreate">＋ 新增商品</el-button>
      </div>

      <!-- 商品表格 -->
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="商品" min-width="140" />
        <el-table-column label="分类" width="110">
          <template #default="{ row }">{{ row.categoryName || '—' }}</template>
        </el-table-column>
        <el-table-column label="归属供应商" min-width="130">
          <template #default="{ row }">{{ row.primarySupplier?.supplierName || '—' }}</template>
        </el-table-column>
        <el-table-column label="计量" width="90">
          <template #default="{ row }">{{ row.weighType === 1 ? '称重' : '固定' }}<template v-if="row.unit">/{{ row.unit }}</template></template>
        </el-table-column>
        <el-table-column label="供货价" width="100">
          <template #default="{ row }">¥{{ row.primarySupplier?.supplyPrice ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="加价比例" width="90">
          <template #default="{ row }">{{ Math.round((row.markupRate || 0) * 100) }}%</template>
        </el-table-column>
        <el-table-column label="销售价" width="100">
          <template #default="{ row }">¥{{ row.salePrice }}</template>
        </el-table-column>
        <el-table-column label="日可供量" width="100">
          <template #default="{ row }">{{ row.primarySupplier?.dailySupply ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="row.status === 1" link type="danger" @click="toggleStatus(row, 0)">下架</el-button>
            <el-button v-else-if="row.status === 0" link type="success" @click="toggleStatus(row, 1)">上架</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="gm-pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </el-card>

    <!-- 新增/编辑商品弹窗 -->
    <el-dialog v-model="dialog" :title="editing ? '编辑商品' : '新增商品'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="商品名称" required>
          <el-input v-model="form.name" placeholder="如：大白菜" />
        </el-form-item>
        <el-form-item label="分类" required>
          <div class="gm-cat-tags">
            <span
              v-for="c in categories"
              :key="c.id"
              class="gm-cat-tag"
              :class="{ on: form.categoryId === c.id, off: !catAuthorized(c.id) }"
              :title="catAuthorized(c.id) ? '' : '该分类未授权给这家供应商'"
              @click="pickCategory(c)"
            >{{ c.name }}</span>
          </div>
          <!-- 卡BZ-2：未授权分类置灰并说明原因，避免"点了保存没反应" -->
          <div v-if="authTipText" class="gm-tip block gm-auth-tip">{{ authTipText }}</div>
        </el-form-item>
        <el-form-item label="计量方式" required>
          <el-radio-group v-model="form.weighType">
            <el-radio :value="1">称重</el-radio>
            <el-radio :value="2">固定规格</el-radio>
          </el-radio-group>
        </el-form-item>
        <!-- 卡BV-2（大辉 2026-10-03 拍板 ②A 方案）：自由输入 → 下拉（自由输入会造出表外脏值，
             供应商端 chip 里永远选不到）。老商品的单位若已被停用 → 保留该项并标「（已停用）」 -->
        <el-form-item label="单位">
          <el-select v-model="form.unit" placeholder="选择单位" style="width: 160px">
            <el-option
              v-for="u in unitOptions"
              :key="u.name"
              :label="u.label"
              :value="u.name"
            />
          </el-select>
          <div class="gm-tip block">没有想要的单位？到『计量单位』页添加</div>
        </el-form-item>
        <el-form-item label="规格说明">
          <el-input v-model="form.specText" placeholder="如：约 0.8 斤/块（选填）" />
        </el-form-item>
        <el-form-item v-if="!editing" label="供应商" required>
          <el-select v-model="form.supplierId" placeholder="选择合作供应商" style="width: 100%">
            <el-option v-for="s in suppliers" :key="s.supplierId" :label="s.stallName" :value="s.supplierId" />
          </el-select>
        </el-form-item>
        <el-form-item label="供货价" required>
          <el-input-number v-model="form.supplyPrice" :min="0" :precision="2" :step="0.1" />
        </el-form-item>
        <el-form-item label="日可供量" required>
          <el-input-number v-model="form.dailySupply" :min="0" :precision="1" :step="10" />
        </el-form-item>
        <el-form-item label="加价比例">
          <el-input-number v-model="markupPercent" :min="0" :max="500" :step="5" />
          <span class="gm-tip">%（销售价 = 供货价 × (1 + 比例)）</span>
        </el-form-item>
        <el-form-item label="销售价">
          <el-input-number v-model="form.salePrice" :min="0" :precision="2" :step="0.1" />
          <span class="gm-tip">留空则自动 = 供货价 × (1+比例) = ¥{{ autoSalePrice }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { goodsAdminApi, categoryAdminApi, userAdminApi, unitAdminApi } from '../../api/modules'

const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)

const keyword = ref('')
const categoryId = ref(null)
const status = ref(null)
const categories = ref([])
const suppliers = ref([])

const dialog = ref(false)
const editing = ref(false)
const saving = ref(false)
const currentId = ref(null)
const form = ref({
  name: '', categoryId: null, weighType: 1, unit: '斤', specText: '',
  supplierId: null, supplyPrice: 0, dailySupply: 0, salePrice: null,
})
const markupPercent = ref(30)

// ── 卡BZ-2（2026-10-04）：供应商「分类授权」校验 ──
// 口径：运营后台给商品选分类时，该分类必须是这家供应商已授权的（与供应商端提交新品一致）。
// supplierCategoryIds = null 表示"还不知道"（未选供应商/接口失败）→ 前端不置灰，仍由后端兜底拦。
const supplierCategoryIds = ref(null)
const editSupplierId = ref(null)      // 编辑态下的主供供应商（弹层里没有供应商选择框）
const initialCategoryId = ref(null)   // 打开弹层时库里的分类，用于判断"分类是否真的改了"
const selectedSupplierId = computed(() => (editing.value ? editSupplierId.value : form.value.supplierId))

function catAuthorized(id) {
  const auth = supplierCategoryIds.value
  if (!auth) return true
  return auth.includes(id)
}

const authTipText = computed(() => {
  const auth = supplierCategoryIds.value
  if (!auth) return ''
  const sup = suppliers.value.find((s) => s.supplierId === selectedSupplierId.value)
  const who = sup?.stallName || '这家供应商'
  if (!auth.length) return `⚠️ ${who}还没有授权任何分类，请先到『供应商管理 → 分类授权』勾选`
  return `灰色分类 = ${who}未授权；勾选后才能选（去『供应商管理 → 分类授权』）`
})

async function loadSupplierCategories(supplierId) {
  if (!supplierId) { supplierCategoryIds.value = null; return }
  try {
    const rows = await categoryAdminApi.getSupplierCategories(supplierId)
    supplierCategoryIds.value = (rows || []).map((r) => r.categoryId)
  } catch (e) {
    supplierCategoryIds.value = null // 拿不到就不拦，交给后端
  }
}

function pickCategory(c) {
  if (!catAuthorized(c.id)) {
    ElMessage.warning(`「${c.name}」未授权给这家供应商，请先到『供应商管理 → 分类授权』勾选后再选`)
    return
  }
  form.value.categoryId = c.id
}

// 新增态：换供应商 → 重新拉它的可发布分类
watch(() => form.value.supplierId, (v) => { if (!editing.value) loadSupplierCategories(v) })

// ── 卡BV-2（2026-10-03）：计量单位下拉（GET /units，只启用中，按 sort） ──
const units = ref([])
/// 老商品的单位若已被停用：/units 里已没有它 → **保留该项并标注「（已停用）」**，
/// 否则编辑页一打开单位就是空白，保存会把商品单位洗掉。
const unitOptions = computed(() => {
  const opts = units.value.map((u) => ({ name: u.name, label: u.name }))
  const cur = form.value.unit
  if (cur && units.value.length && !opts.some((o) => o.name === cur)) {
    opts.push({ name: cur, label: `${cur}（已停用）` })
  }
  return opts
})

async function loadUnits() {
  try {
    units.value = (await unitAdminApi.listEnabled()) || []
  } catch (e) {
    units.value = []
  }
}

const statusText = (s) => ({ 0: '下架', 1: '在售', 2: '变更审核中' }[s] || '未知')
const statusType = (s) => ({ 0: 'info', 1: 'success', 2: 'warning' }[s] || 'info')

const markupRate = computed(() => markupPercent.value / 100)
const autoSalePrice = computed(() => ((form.value.supplyPrice || 0) * (1 + markupRate.value)).toFixed(2))

/// 打开弹窗时记下「库里的销售价」原值。编辑页仍然照常显示它（不改 UX），
/// 但只有运营真的动过销售价输入框（值与原值不同）才把它写进 payload；
/// 否则整个省略 → 后端进入 供货价/加价比例 → 销售价 的重算分支。
/// 否则运营只改供货价或加价比例时，DB 里的旧销售价会覆盖掉重算出来的正确值。
const initialSalePrice = ref(null)
const salePriceDirty = computed(() => form.value.salePrice !== initialSalePrice.value)

async function load() {
  loading.value = true
  try {
    const data = await goodsAdminApi.listProducts({
      keyword: keyword.value || undefined,
      categoryId: categoryId.value ?? undefined,
      status: status.value ?? undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  currentId.value = null
  form.value = { name: '', categoryId: null, weighType: 1, unit: '斤', specText: '', supplierId: null, supplyPrice: 0, dailySupply: 0, salePrice: null }
  initialSalePrice.value = null
  markupPercent.value = 30
  // 卡BZ-2：换供应商才重新拉分类授权，这里先清空
  editSupplierId.value = null
  initialCategoryId.value = null
  supplierCategoryIds.value = null
  dialog.value = true
}

function openEdit(row) {
  editing.value = true
  currentId.value = row.productId
  form.value = {
    name: row.name,
    // 卡BZ（2026-10-04）：列表接口现在回 categoryId，正常走第一个分支把当前分类点亮；
    // 兜底：万一上游只给了 categoryName（老接口/其它数据源），按名字回填 id，
    // 免得弹层分类栏又是空的、不点一下保存就被「请选择分类」拦住。
    categoryId: row.categoryId ?? categories.value.find((c) => c.name === row.categoryName)?.id ?? null,
    weighType: row.weighType,
    unit: row.unit,
    specText: row.specText,
    supplierId: row.primarySupplier?.supplierId ?? null,
    supplyPrice: row.primarySupplier?.supplyPrice ?? 0,
    dailySupply: row.primarySupplier?.dailySupply ?? 0,
    salePrice: row.salePrice ?? null,
  }
  // 记下原值作为脏标记基线：不动销售价框 → save() 不发这个字段 → 后端重算
  initialSalePrice.value = row.salePrice ?? null
  markupPercent.value = Math.round((row.markupRate || 0) * 100)
  // 卡BZ-2：记下"打开时的分类"和主供供应商，并拉它的分类授权（未授权的标签置灰）
  initialCategoryId.value = form.value.categoryId
  editSupplierId.value = row.primarySupplier?.supplierId ?? null
  supplierCategoryIds.value = null
  loadSupplierCategories(editSupplierId.value)
  dialog.value = true
}

async function toggleStatus(row, targetStatus) {
  try {
    await goodsAdminApi.updateProductStatus(row.productId, targetStatus)
    ElMessage.success(targetStatus === 1 ? '已上架' : '已下架')
    load()
  } catch (e) { /* 已提示 */ }
}

async function save() {
  if (!form.value.name) { ElMessage.warning('请填写商品名称'); return }
  if (!form.value.categoryId) { ElMessage.warning('请选择分类'); return }
  if (!editing.value && !form.value.supplierId) { ElMessage.warning('请选择供应商'); return }
  // 卡BZ-2：分类真的改了、且新分类未授权给该供应商 → 前端先拦（后端同样会拦，双保险）
  if (
    form.value.categoryId !== initialCategoryId.value &&
    supplierCategoryIds.value &&
    !supplierCategoryIds.value.includes(form.value.categoryId)
  ) {
    ElMessage.warning('该商品分类未授权给这家供应商，请先到『供应商管理 → 分类授权』勾选后再保存')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.value.name,
      categoryId: form.value.categoryId,
      weighType: form.value.weighType,
      unit: form.value.unit,
      specText: form.value.specText || undefined,
      supplyPrice: form.value.supplyPrice,
      dailySupply: form.value.dailySupply,
      markupRate: markupRate.value,
    }
    // 只有运营真的改过销售价才发这个字段；没改就整个省略，
    // 让后端按 供货价 × (1 + 加价比例) 重算，避免旧销售价把重算结果覆盖掉。
    if (salePriceDirty.value && form.value.salePrice !== null && form.value.salePrice !== undefined) {
      payload.salePrice = form.value.salePrice
    }
    if (editing.value) {
      await goodsAdminApi.updateProduct(currentId.value, payload)
      ElMessage.success('已保存')
    } else {
      payload.supplierId = form.value.supplierId
      await goodsAdminApi.createProduct(payload)
      ElMessage.success('商品已创建并上架')
    }
    dialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    saving.value = false
  }
}

onMounted(async () => {
  load()
  loadUnits() // 卡BV-2：单位下拉（只读字典，失败不阻塞）
  try {
    categories.value = await categoryAdminApi.getCategories()
  } catch (e) { /* 忽略 */ }
  try {
    const all = await userAdminApi.getSuppliers()
    suppliers.value = (all || []).filter((s) => s.status === 1)
  } catch (e) { /* 忽略 */ }
})
</script>

<style scoped>
.gm-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.gm-toolbar-left {
  display: flex;
  gap: 10px;
  align-items: center;
}
.gm-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
.gm-cat-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.gm-cat-tag {
  padding: 5px 14px;
  border-radius: 14px;
  background: #f0f2f5;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  line-height: 20px;
}
.gm-cat-tag.on {
  background: #e6f7ef;
  color: #00b96b;
  font-weight: 600;
}
/* 卡BZ-2：该分类未授权给这家供应商 → 置灰不可选 */
.gm-cat-tag.off {
  background: #f7f8fa;
  color: #c8ccd4;
  cursor: not-allowed;
}
/* 当前分类恰好是未授权的（历史遗留商品）→ 用琥珀色标出来，提示运营换一个 */
.gm-cat-tag.off.on {
  background: #fdf6e3;
  color: #b88230;
}
.gm-tip {
  color: #909399;
  font-size: 12px;
  margin-left: 8px;
}
/* 卡BV-2：单位下拉下方的灰字提示（整行，不跟在控件右侧） */
.el-form-item .gm-tip.block {
  display: block;
  margin-left: 0;
  margin-top: 4px;
  line-height: 1.7;
}
</style>
