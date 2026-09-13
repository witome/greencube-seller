<template>
  <div class="admin-settings-page">
    <div class="admin-settings-crumb">系统设置 / 交易规则 · 服务费</div>

    <!-- 服务费设置（真实接口） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>💰 平台服务费设置</template>
      <div v-loading="loading">
        <div class="admin-settings-row">
          <span class="admin-settings-k">全局默认费率</span>
          <el-input-number v-model="globalRate" :min="0" :max="100" :step="0.5" :precision="1" size="small" />
          <span class="admin-settings-unit">%</span>
          <el-button type="primary" size="small" :loading="savingGlobal" @click="saveGlobal">保存</el-button>
        </div>

        <el-divider content-position="left">分类覆盖（不设置则按全局费率）</el-divider>

        <el-table :data="categoryRates" size="small" empty-text="尚未配置分类覆盖，全部按全局费率执行">
          <el-table-column prop="categoryName" label="分类" />
          <el-table-column label="费率" width="180">
            <template #default="{ row }">
              <el-input-number v-model="row.rate" :min="0" :max="100" :step="0.5" :precision="1" size="small" />
              <span style="margin-left:4px;color:#8a9099;">%</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button type="primary" link :loading="row.saving" @click="saveCategory(row)">保存</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="admin-settings-add">
          <el-select v-model="newCategoryId" placeholder="选择分类" size="small" style="width:180px" filterable>
            <el-option v-for="c in availableCategories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
          <el-input-number v-model="newRate" :min="0" :max="100" :step="0.5" :precision="1" size="small" />
          <span style="color:#8a9099;">%</span>
          <el-button type="success" size="small" :loading="adding" @click="addCategory">添加覆盖</el-button>
        </div>
      </div>
    </el-card>

    <!-- 运费设置（真实接口） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>🚚 运费与免运费规则</template>
      <div v-loading="feeLoading">
        <div class="admin-settings-row">
          <span class="admin-settings-k">基础运费</span>
          <el-input-number v-model="feeForm.fee" :min="0" :step="1" :precision="1" size="small" />
          <span class="admin-settings-unit">元</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">满额免运费</span>
          <el-input-number v-model="feeForm.freeThreshold" :min="0" :step="10" size="small" />
          <span class="admin-settings-unit">元起免运费（0 = 不启用）</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">次日达免运费</span>
          <el-switch v-model="feeForm.freeNextDay" />
          <span class="admin-settings-unit">选择次日送达的订单免运费</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">加急运费</span>
          <el-input-number v-model="feeForm.urgentFee" :min="0" :step="1" :precision="1" size="small" />
          <span class="admin-settings-unit">元（采购方加急时额外收取）</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">加急满额免运费</span>
          <el-input-number v-model="feeForm.urgentFreeThreshold" :min="0" :step="10" size="small" />
          <span class="admin-settings-unit">元起免加急费（0 = 不启用）</span>
        </div>
        <div style="margin-top:16px;">
          <el-button type="primary" size="small" :loading="savingFee" @click="saveFee">保存运费规则</el-button>
        </div>
      </div>
    </el-card>

    <!-- 首页内容（真实接口：platform_config KV，采购方小程序首页三处数据驱动） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>🏠 首页内容（采购方小程序首页）</template>
      <div v-loading="homeLoading">
        <el-divider content-position="left">配送说明横幅</el-divider>
        <div class="admin-settings-row">
          <span class="admin-settings-k">主文案</span>
          <el-input v-model="homeForm.deliveryNote.title" maxlength="30" show-word-limit size="small" style="width:320px" placeholder="如：下单时选择配送日期，按日送达" />
        </div>
        <div class="admin-settings-row" style="margin-top:10px;">
          <span class="admin-settings-k">副文案</span>
          <el-input v-model="homeForm.deliveryNote.subtitle" maxlength="60" show-word-limit size="small" style="width:320px" placeholder="可空" />
        </div>

        <el-divider content-position="left">平台公告（停用或清空 → 首页不显示）</el-divider>
        <div class="admin-settings-row">
          <span class="admin-settings-k">启用公告</span>
          <el-switch v-model="homeForm.notice.enabled" />
          <el-input v-model="homeForm.notice.text" maxlength="100" show-word-limit size="small" style="width:320px;margin-left:12px" placeholder="公告内容（最长 100 字）" :disabled="!homeForm.notice.enabled" />
        </div>

        <el-divider content-position="left">今日推荐位（按顺序展示，最多 10 个；清空 → 首页显示空态）</el-divider>
        <div class="admin-settings-row">
          <el-select v-model="pendingProductId" placeholder="选择在售商品" size="small" style="width:280px" filterable @change="addRecommend">
            <el-option v-for="p in onSaleProducts" :key="p.id" :label="`${p.name}（¥${p.salePrice}/${p.unit}）`" :value="p.id" :disabled="homeForm.recommendationIds.includes(p.id)" />
          </el-select>
          <span class="admin-settings-unit">已选 {{ homeForm.recommendationIds.length }} 个（下方可排序）</span>
        </div>
        <el-table :data="recommendRows" size="small" style="margin-top:10px;" empty-text="尚未配置推荐商品">
          <el-table-column type="index" label="顺序" width="70" />
          <el-table-column prop="name" label="商品" />
          <el-table-column label="售价" width="120">
            <template #default="{ row }">¥{{ row.salePrice }}/{{ row.unit }}</template>
          </el-table-column>
          <el-table-column label="操作" width="170">
            <template #default="{ row, $index }">
              <el-button size="small" :disabled="$index === 0" @click="moveRecommend($index, -1)">上移</el-button>
              <el-button size="small" :disabled="$index === recommendRows.length - 1" @click="moveRecommend($index, 1)">下移</el-button>
              <el-button type="danger" link @click="removeRecommend($index)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div style="margin-top:16px;">
          <el-button type="primary" size="small" :loading="savingHome" @click="saveHome">保存首页内容</el-button>
        </div>
      </div>
    </el-card>

    <!-- 货到付款收款码 -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>💰 货到付款收款码（配送员端展示，客户扫码付款）</template>
      <div v-loading="qrLoading">
        <div class="admin-settings-qr">
          <div v-if="payQrUrl" class="qr-box">
            <el-image :src="payQrUrl" fit="cover" class="qr-img" />
            <div class="qr-hint">当前收款码</div>
          </div>
          <div v-else class="qr-box qr-empty">尚未上传收款二维码</div>
          <div class="qr-upload">
            <input type="file" accept="image/*" style="display:none" ref="qrFileInput" @change="onQrFile" />
            <el-button type="primary" size="small" @click="qrFileInput.click()">选择图片</el-button>
            <el-button type="success" size="small" :loading="savingQr" :disabled="!pendingQrBase64" @click="saveQr">上传收款码</el-button>
            <div class="qr-upload-tip">上传后配送员「货到付款」页面会展示该收款码，客户扫码付款。</div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 其他配置（暂未接入） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>⚙️ 其他配置</template>
      <div class="admin-settings-empty">
        交易规则（起送金额、申报截止时间）、支付通道、通知开关等暂未接入，待后续提供配置接口后在此维护。
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { financeAdminApi, categoryAdminApi } from '../../api/modules'

const loading = ref(false)
const globalRate = ref(5)
const categoryRates = ref([])
const allCategories = ref([])

const savingGlobal = ref(false)
const adding = ref(false)
const newCategoryId = ref(null)
const newRate = ref(5)

// 运费规则
const feeForm = reactive({ fee: 5, freeThreshold: 100, freeNextDay: true, urgentFee: 0, urgentFreeThreshold: 0 })
const feeLoading = ref(false)
const savingFee = ref(false)

// 货到付款收款码
const payQrUrl = ref('')
const qrLoading = ref(false)
const savingQr = ref(false)
const pendingQrBase64 = ref('')
const qrFileInput = ref(null)

// ── 首页内容（横幅/公告/今日推荐位） ──
const homeLoading = ref(false)
const savingHome = ref(false)
const homeForm = reactive({
  deliveryNote: { title: '', subtitle: '' },
  notice: { enabled: false, text: '' },
  recommendationIds: [],
})
const onSaleProducts = ref([])
const pendingProductId = ref(null)

// 已选商品按 recommendationIds 顺序展示（上移/下移即调数组序）
const recommendRows = computed(() =>
  homeForm.recommendationIds
    .map((id) => onSaleProducts.value.find((p) => p.id === id))
    .filter(Boolean)
)

function addRecommend(id) {
  if (id && !homeForm.recommendationIds.includes(id) && homeForm.recommendationIds.length < 10) {
    homeForm.recommendationIds.push(id)
  }
  pendingProductId.value = null
}
function moveRecommend(index, delta) {
  const arr = homeForm.recommendationIds
  const target = index + delta
  if (target < 0 || target >= arr.length) return
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
}
function removeRecommend(index) {
  homeForm.recommendationIds.splice(index, 1)
}

async function loadHome() {
  homeLoading.value = true
  try {
    const [cfg, goods] = await Promise.all([
      financeAdminApi.getHomeContent(),
      goodsAdminApi.listProducts({ page: 1, pageSize: 50 }),
    ])
    homeForm.deliveryNote.title = cfg.deliveryNote?.title || ''
    homeForm.deliveryNote.subtitle = cfg.deliveryNote?.subtitle || ''
    homeForm.notice.enabled = !!cfg.notice?.enabled
    homeForm.notice.text = cfg.notice?.text || ''
    const ids = cfg.recommendationIds || []
    // 仅保留在售商品（下架的不回填，避免保存时把下架商品带回去）；admin 列表字段为 productId
    const onSale = (goods.list || []).filter((p) => p.status === 1).map((p) => ({ ...p, id: p.productId }))
    onSaleProducts.value = onSale
    homeForm.recommendationIds = ids.filter((id) => onSale.some((p) => p.id === id))
  } catch (e) { /* 已提示 */ } finally {
    homeLoading.value = false
  }
}

async function saveHome() {
  savingHome.value = true
  try {
    await financeAdminApi.updateHomeContent({
      deliveryNote: { title: homeForm.deliveryNote.title, subtitle: homeForm.deliveryNote.subtitle },
      notice: { enabled: homeForm.notice.enabled, text: homeForm.notice.text },
      recommendationIds: homeForm.recommendationIds,
    })
    ElMessage.success('首页内容已保存')
  } catch (e) { /* 已提示 */ } finally {
    savingHome.value = false
  }
}

// 可选分类 = 一级分类里排除已配置覆盖的
const availableCategories = computed(() => {
  const covered = new Set(categoryRates.value.map((c) => c.categoryId))
  return allCategories.value.filter((c) => !covered.has(c.id))
})

async function load() {
  loading.value = true
  try {
    const cfg = await financeAdminApi.getServiceFeeConfigs()
    globalRate.value = Math.round(cfg.globalRate * 1000) / 10
    categoryRates.value = (cfg.categories || []).map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      rate: Math.round(c.rate * 1000) / 10,
    }))
    allCategories.value = await categoryAdminApi.getCategories()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

async function saveGlobal() {
  savingGlobal.value = true
  try {
    await financeAdminApi.updateServiceFee({ rate: globalRate.value / 100 })
    ElMessage.success('全局费率已保存')
  } catch (e) { /* 已提示 */ } finally {
    savingGlobal.value = false
  }
}

async function saveCategory(row) {
  row.saving = true
  try {
    await financeAdminApi.updateServiceFee({ categoryId: row.categoryId, rate: row.rate / 100 })
    ElMessage.success('分类费率已保存')
  } catch (e) { /* 已提示 */ } finally {
    row.saving = false
  }
}

async function addCategory() {
  if (!newCategoryId.value) {
    ElMessage.warning('请选择分类')
    return
  }
  adding.value = true
  try {
    await financeAdminApi.updateServiceFee({ categoryId: newCategoryId.value, rate: newRate.value / 100 })
    ElMessage.success('已添加分类覆盖')
    newCategoryId.value = null
    load()
  } catch (e) { /* 已提示 */ } finally {
    adding.value = false
  }
}

async function loadFee() {
  feeLoading.value = true
  try {
    const fee = await financeAdminApi.getDeliveryFee()
    feeForm.fee = fee.fee
    feeForm.freeThreshold = fee.freeThreshold
    feeForm.freeNextDay = fee.freeNextDay
    feeForm.urgentFee = fee.urgentFee ?? 0
    feeForm.urgentFreeThreshold = fee.urgentFreeThreshold ?? 0
  } catch (e) { /* 已提示 */ } finally {
    feeLoading.value = false
  }
}

async function saveFee() {
  savingFee.value = true
  try {
    await financeAdminApi.updateDeliveryFee({
      fee: feeForm.fee,
      freeThreshold: feeForm.freeThreshold,
      freeNextDay: feeForm.freeNextDay,
      urgentFee: feeForm.urgentFee,
      urgentFreeThreshold: feeForm.urgentFreeThreshold,
    })
    ElMessage.success('运费规则已保存')
  } catch (e) { /* 已提示 */ } finally {
    savingFee.value = false
  }
}

// ── 收款码 ──
async function loadQr() {
  qrLoading.value = true
  try {
    const r = await financeAdminApi.getPayQr()
    payQrUrl.value = r.url || ''
  } catch (e) { /* 已提示 */ } finally {
    qrLoading.value = false
  }
}

function onQrFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { pendingQrBase64.value = reader.result }
  reader.readAsDataURL(file)
}

async function saveQr() {
  if (!pendingQrBase64.value) return
  savingQr.value = true
  try {
    const { url } = await financeAdminApi.uploadImage(pendingQrBase64.value)
    await financeAdminApi.updatePayQr({ url })
    ElMessage.success('收款码已上传')
    pendingQrBase64.value = ''
    loadQr()
  } catch (e) { /* 已提示 */ } finally {
    savingQr.value = false
  }
}

onMounted(() => {
  load()
  loadFee()
  loadQr()
  loadHome()
})
</script>

<style scoped>
.admin-settings-page {
  max-width: 900px;
  margin: 0 auto;
}
.admin-settings-crumb {
  font-size: 13px;
  color: #8a9099;
  margin-bottom: 14px;
}
.admin-settings-card {
  margin-bottom: 16px;
}
.admin-settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.admin-settings-k {
  width: 120px;
  color: #606266;
}
.admin-settings-unit {
  color: #8a9099;
}
.admin-settings-add {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.admin-settings-empty {
  text-align: center;
  color: #b8bec6;
  font-size: 13px;
  line-height: 1.8;
  padding: 32px 16px;
}
.admin-settings-qr {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.qr-box {
  width: 160px;
  height: 160px;
  border: 1px dashed #d0d5db;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.qr-img {
  width: 100%;
  height: 138px;
}
.qr-hint {
  font-size: 12px;
  color: #8a9099;
}
.qr-empty {
  color: #b8bec6;
  font-size: 13px;
}
.qr-upload {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.qr-upload-tip {
  font-size: 12px;
  color: #8a9099;
  line-height: 1.6;
}
</style>
