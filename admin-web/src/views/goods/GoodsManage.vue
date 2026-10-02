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
              :class="{ on: form.categoryId === c.id }"
              @click="form.categoryId = c.id"
            >{{ c.name }}</span>
          </div>
        </el-form-item>
        <el-form-item label="计量方式" required>
          <el-radio-group v-model="form.weighType">
            <el-radio :value="1">称重</el-radio>
            <el-radio :value="2">固定规格</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="form.unit" placeholder="斤 / 份 / 箱" style="width: 120px" />
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
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { goodsAdminApi, categoryAdminApi, userAdminApi } from '../../api/modules'

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

const statusText = (s) => ({ 0: '下架', 1: '在售', 2: '变更审核中' }[s] || '未知')
const statusType = (s) => ({ 0: 'info', 1: 'success', 2: 'warning' }[s] || 'info')

const markupRate = computed(() => markupPercent.value / 100)
const autoSalePrice = computed(() => ((form.value.supplyPrice || 0) * (1 + markupRate.value)).toFixed(2))

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
  markupPercent.value = 30
  dialog.value = true
}

function openEdit(row) {
  editing.value = true
  currentId.value = row.productId
  form.value = {
    name: row.name,
    categoryId: row.categoryId ?? null,
    weighType: row.weighType,
    unit: row.unit,
    specText: row.specText,
    supplierId: row.primarySupplier?.supplierId ?? null,
    supplyPrice: row.primarySupplier?.supplyPrice ?? 0,
    dailySupply: row.primarySupplier?.dailySupply ?? 0,
    salePrice: row.salePrice,
  }
  markupPercent.value = Math.round((row.markupRate || 0) * 100)
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
    if (form.value.salePrice !== null && form.value.salePrice !== undefined) {
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
.gm-tip {
  color: #909399;
  font-size: 12px;
  margin-left: 8px;
}
</style>
