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

        <el-divider content-position="left">今日特价位（按顺序展示，最多 10 个；清空 → 首页显示空态）</el-divider>
        <div class="admin-settings-row">
          <el-select v-model="pendingProductId" placeholder="选择在售商品" size="small" style="width:280px" filterable @change="addRecommend">
            <el-option v-for="p in onSaleProducts" :key="p.id" :label="`${p.name}（¥${p.salePrice}/${p.unit}）`" :value="p.id" :disabled="homeForm.recommendationIds.includes(p.id)" />
          </el-select>
          <span class="admin-settings-unit">已选 {{ homeForm.recommendationIds.length }} 个（下方可排序）</span>
        </div>
        <el-table :data="recommendRows" size="small" style="margin-top:10px;" empty-text="尚未配置特价商品">
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

        <!-- 卡BA-2：首页滚动横幅图（开启且有图 → 替换配送说明文字横幅；最多 10 张，选中即压缩上传） -->
        <el-divider content-position="left">首页滚动横幅图（开启且有图时替换文字横幅，最多 10 张）</el-divider>
        <div class="home-banner-config">
          <div class="admin-settings-row">
            <span class="admin-settings-k">启用滚动图</span>
            <el-switch v-model="homeForm.bannerImages.enabled" />
            <input type="file" accept="image/*" style="display:none" ref="bannerFileInput" @change="onBannerFile" />
            <el-button
              class="home-banner-pick-btn"
              size="small"
              :loading="uploadingBanner"
              :disabled="homeForm.bannerImages.images.length >= 10"
              @click="bannerFileInput.click()"
            >选择图片</el-button>
            <span class="admin-settings-unit">已选 {{ homeForm.bannerImages.images.length }}/10 张（选中后立即上传，下方可排序）</span>
          </div>
          <el-table :data="homeForm.bannerImages.images" size="small" style="margin-top:10px;" empty-text="尚未上传横幅图，首页显示配送说明文字横幅">
            <el-table-column type="index" label="顺序" width="60" />
            <el-table-column label="预览" width="110">
              <template #default="{ row }">
                <el-image :src="row" fit="cover" :preview-src-list="homeForm.bannerImages.images" class="home-banner-thumb" />
              </template>
            </el-table-column>
            <el-table-column label="图片地址" min-width="220">
              <template #default="{ row }"><span class="home-banner-url">{{ row }}</span></template>
            </el-table-column>
            <el-table-column label="操作" width="170">
              <template #default="{ $index }">
                <el-button size="small" :disabled="$index === 0" @click="moveBanner($index, -1)">上移</el-button>
                <el-button size="small" :disabled="$index === homeForm.bannerImages.images.length - 1" @click="moveBanner($index, 1)">下移</el-button>
                <el-button type="danger" link @click="removeBanner($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 卡BA-2：常用功能宫格（最多 8 条；留空 → 首页用内置默认宫格） -->
        <el-divider content-position="left">常用功能（按顺序展示，最多 8 个；留空 → 首页使用内置默认宫格）</el-divider>
        <div class="home-feature-config">
          <el-table :data="homeForm.features" size="small" empty-text="尚未配置常用功能，首页将使用内置默认宫格">
            <el-table-column type="index" label="顺序" width="60" />
            <el-table-column label="功能名称" width="150">
              <template #default="{ row }">
                <el-input v-model="row.label" maxlength="8" size="small" placeholder="1~8 字" />
              </template>
            </el-table-column>
            <el-table-column label="图标" width="110">
              <template #default="{ row }">
                <el-input v-model="row.emoji" maxlength="8" size="small" placeholder="如 🥬" />
              </template>
            </el-table-column>
            <el-table-column label="跳转类型" width="140">
              <template #default="{ row }">
                <el-select v-model="row.type" size="small">
                  <el-option v-for="t in featureTypes" :key="t.value" :label="t.label" :value="t.value" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="页面路径" min-width="230">
              <template #default="{ row }">
                <el-select
                  v-model="row.page"
                  size="small"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入页面路径"
                  style="width:100%"
                  :disabled="row.type === 'todo'"
                >
                  <el-option v-for="p in pagePresetPaths" :key="p" :label="p" :value="p" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="170">
              <template #default="{ $index }">
                <el-button size="small" :disabled="$index === 0" @click="moveFeature($index, -1)">上移</el-button>
                <el-button size="small" :disabled="$index === homeForm.features.length - 1" @click="moveFeature($index, 1)">下移</el-button>
                <el-button type="danger" link @click="removeFeature($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="admin-settings-add">
            <el-button
              class="home-feature-add-btn"
              type="success"
              size="small"
              :disabled="homeForm.features.length >= 8"
              @click="addFeature"
            >新增功能</el-button>
            <span class="admin-settings-unit">共 {{ homeForm.features.length }}/8 个（tab类型只能填 tabBar 页；建设中占位无需路径）</span>
          </div>
        </div>

        <!-- 卡BA-2：客服电话（留空 → 首页不显示客服入口） -->
        <el-divider content-position="left">客服电话（留空 → 首页不显示客服入口）</el-divider>
        <div class="home-hotline-config">
          <div class="admin-settings-row">
            <span class="admin-settings-k">客服电话</span>
            <el-input v-model="homeForm.serviceHotline" size="small" style="width:220px" maxlength="20" placeholder="留空则不显示" />
            <span class="admin-settings-unit">手机号（如 13800138000）或座机（如 010-12345678）</span>
          </div>
        </div>

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

    <!-- 卡BN-2（2026-10-02）：未接单催办设置（新增卡，既有卡片一律不动） -->
    <el-card shadow="never" class="admin-settings-card">
      <template #header>📞 未接单催办设置</template>
      <div v-loading="notifyLoading">
        <div class="admin-settings-row">
          <span class="admin-settings-k">电话提醒总开关</span>
          <el-switch v-model="notifyForm.enabled" />
          <span class="admin-settings-unit">关掉=一通都不打，后台仍会提示你</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">未接单判定阈值</span>
          <el-input-number v-model="notifyForm.thresholdMinutes" :min="1" :max="1440" :step="1" :precision="0" size="small" />
          <span class="admin-settings-unit">分钟（建议 1–60）。从下单时间起算</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">第 2 通间隔</span>
          <el-input-number v-model="notifyForm.secondGapMinutes" :min="1" :max="1440" :step="1" :precision="0" size="small" />
          <span class="admin-settings-unit">分钟（从<b>上一次拨打</b>起算，不是从下单起算）</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">最多拨打次数</span>
          <el-input-number v-model="notifyForm.maxCalls" :min="0" :max="5" :step="1" :precision="0" size="small" />
          <span class="admin-settings-unit">次。填 <b>0</b> = 只提醒运营、完全不打电话</span>
        </div>
        <div class="admin-settings-row" style="margin-top:12px;">
          <span class="admin-settings-k">免打扰时段</span>
          <el-time-select v-model="notifyForm.quietStart" start="00:00" end="23:30" step="00:30" size="small" style="width:110px" :disabled="!notifyForm.quietEnabled" />
          <span class="admin-settings-unit">至</span>
          <el-time-select v-model="notifyForm.quietEnd" start="00:00" end="23:30" step="00:30" size="small" style="width:110px" :disabled="!notifyForm.quietEnabled" />
          <span class="admin-settings-unit">不拨打，只进后台列表</span>
          <el-switch v-model="notifyForm.quietEnabled" style="margin-left:6px" />
          <span class="admin-settings-unit">关闭后 24 小时都打</span>
        </div>

        <!-- 只读区：值来自 GET config（AK/密钥后端不回显） -->
        <div class="notify-readonly">
          <b>语音通道（只读 · 由我们配置）</b><br>
          服务商：<b>阿里云语音服务</b>（公共模式 / 专属模式） · 显示号码：<b>{{ notifyConfig?.callerNumber || '未配置' }}</b>（专属号 · 号码固定 · 可回拨）<br>
          语音模板 ID：<b>{{ notifyConfig?.templateId || '未配置' }}</b>（审核通过后不可改）<br>
          计费：接通才计费，<b>0.11 元 / 通</b>（不满 1 分钟按 1 分钟）；未接通不计费；号码月租 35 元/月<br>
          <span class="notify-launchat">⚠️ 只对 <b>{{ fmtLaunchAt }}</b> 之后创建的订单生效（历史订单一律不拨打）</span>
        </div>

        <div style="margin-top:16px;display:flex;gap:10px;align-items:center;">
          <el-button type="primary" size="small" :loading="savingNotify" @click="saveNotify">保存</el-button>
          <el-button size="small" :loading="testingCall" @click="doTestCall">测试拨打（打给运营自己的手机）</el-button>
          <span class="admin-settings-unit">保存后，正在等待的订单会按新设置生效；后台会记一条审计。</span>
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
// 卡BN-2：测试拨打弹窗需要 ElMessageBox（单独补一行 import，不改上面既有行）
import { ElMessageBox } from 'element-plus'
import { financeAdminApi, categoryAdminApi, goodsAdminApi } from '../../api/modules'
import { compressFileToDataUri } from '../../utils/image-compress'
// 卡BN-2（2026-10-02）：催办设置直接走冻结契约接口（不改 api/modules.js，遵守本卡只改 5 文件）
import request from '../../api/request'

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

// ── 首页内容（配送说明/公告/今日特价位 + 卡BA-2：滚动横幅图/常用功能/客服电话） ──
const MAX_BANNER = 10
const MAX_FEATURE = 8
const SERVICE_HOTLINE_RE = /^$|^1[3-9]\d{9}$|^\d{3,4}-?\d{7,8}$/
// 跳转类型三档：tab = tabBar 页（switchTab），page = 普通页（navigateTo），todo = 前端提示「功能建设中」
const featureTypes = [
  { value: 'tab', label: 'tab页切换' },
  { value: 'page', label: '普通页面' },
  { value: 'todo', label: '建设中占位' },
]
// 常用路径快捷选项（仍允许手工输入；tab 类型只有这 5 个 tabBar 页合法）
const pagePresetPaths = [
  '/pages/buyer/home',
  '/pages/buyer/goods',
  '/pages/buyer/cart',
  '/pages/buyer/order-list',
  '/pages/buyer/mine',
  '/pages/buyer/bill',
  '/pages/buyer/aftersale',
  '/pages/buyer/my-demands',
  '/pages/buyer/kefu',
]
const homeLoading = ref(false)
const savingHome = ref(false)
const homeForm = reactive({
  deliveryNote: { title: '', subtitle: '' },
  notice: { enabled: false, text: '' },
  recommendationIds: [],
  bannerImages: { enabled: false, images: [] },
  features: [],
  serviceHotline: '',
})
const onSaleProducts = ref([])
const pendingProductId = ref(null)

// ── 卡BA-2：滚动横幅图（选中即压缩 → /upload/image → 拿 URL） ──
const bannerFileInput = ref(null)
const uploadingBanner = ref(false)

// ── 卡BA-2：常用功能 key 自增序列（保证同一会话内唯一，回填老配置缺 key 时补齐） ──
let featureSeq = 0
function genFeatureKey() {
  featureSeq += 1
  return `hf_${Date.now().toString(36)}_${featureSeq}`
}

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

// ── 卡BA-2：滚动横幅图 ──
async function onBannerFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  if (homeForm.bannerImages.images.length >= MAX_BANNER) {
    ElMessage.warning(`横幅图最多 ${MAX_BANNER} 张`)
    e.target.value = ''
    return
  }
  uploadingBanner.value = true
  try {
    const base64 = await compressFileToDataUri(file)
    const { url } = await financeAdminApi.uploadImage(base64)
    if (!url) throw new Error('上传未返回图片地址')
    homeForm.bannerImages.images.push(url)
    ElMessage.success('横幅图已上传')
  } catch (err) {
    ElMessage.error('横幅图上传失败，请重试')
  } finally {
    e.target.value = '' // 允许重复选择同一文件
    uploadingBanner.value = false
  }
}
function moveBanner(index, delta) {
  const arr = homeForm.bannerImages.images
  const target = index + delta
  if (target < 0 || target >= arr.length) return
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
}
function removeBanner(index) {
  homeForm.bannerImages.images.splice(index, 1)
}

// ── 卡BA-2：常用功能 ──
function addFeature() {
  if (homeForm.features.length >= MAX_FEATURE) return
  homeForm.features.push({ key: genFeatureKey(), label: '', emoji: '', type: 'tab', page: '/pages/buyer/goods' })
}
function moveFeature(index, delta) {
  const arr = homeForm.features
  const target = index + delta
  if (target < 0 || target >= arr.length) return
  ;[arr[index], arr[target]] = [arr[target], arr[index]]
}
function removeFeature(index) {
  homeForm.features.splice(index, 1)
}

// ── 卡BA-2：保存前本地校验（后端 DTO 同源规则，先本地拦一道，避免 400） ──
function validateHome() {
  if (homeForm.bannerImages.images.length > MAX_BANNER) {
    ElMessage.warning(`横幅图最多 ${MAX_BANNER} 张`)
    return false
  }
  if (homeForm.features.length > MAX_FEATURE) {
    ElMessage.warning(`常用功能最多 ${MAX_FEATURE} 个`)
    return false
  }
  for (let i = 0; i < homeForm.features.length; i++) {
    const f = homeForm.features[i]
    const label = (f.label || '').trim()
    if (!label || label.length > 8) {
      ElMessage.warning(`第 ${i + 1} 个功能：名称需为 1~8 字`)
      return false
    }
    const emoji = (f.emoji || '').trim()
    if (!emoji || emoji.length > 8) {
      ElMessage.warning(`第 ${i + 1} 个功能：图标不能为空且不超过 8 个字符`)
      return false
    }
    if (!featureTypes.some((t) => t.value === f.type)) {
      ElMessage.warning(`第 ${i + 1} 个功能：跳转类型非法`)
      return false
    }
    const page = (f.page || '').trim()
    if (f.type !== 'todo' && !page) {
      ElMessage.warning(`第 ${i + 1} 个功能：${f.type === 'tab' ? 'tab页切换' : '普通页面'}必须选择页面路径`)
      return false
    }
    if (page.length > 100) {
      ElMessage.warning(`第 ${i + 1} 个功能：页面路径过长（最多 100 字符）`)
      return false
    }
  }
  if (!SERVICE_HOTLINE_RE.test((homeForm.serviceHotline || '').trim())) {
    ElMessage.warning('客服电话格式不正确（手机号或座机号，如 13800138000 / 010-12345678）')
    return false
  }
  return true
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
    // 卡BA-2：滚动横幅图 / 常用功能 / 客服电话 回填（异常值一律按空处理，让前台走默认）
    const banner = cfg.bannerImages || {}
    homeForm.bannerImages.enabled = !!banner.enabled
    homeForm.bannerImages.images = Array.isArray(banner.images)
      ? banner.images.filter((u) => typeof u === 'string' && u).slice(0, MAX_BANNER)
      : []
    homeForm.features = (Array.isArray(cfg.features) ? cfg.features : []).slice(0, MAX_FEATURE).map((f) => ({
      key: typeof f?.key === 'string' && f.key ? f.key : genFeatureKey(),
      label: typeof f?.label === 'string' ? f.label : '',
      emoji: typeof f?.emoji === 'string' ? f.emoji : '',
      type: featureTypes.some((t) => t.value === f?.type) ? f.type : 'tab',
      page: typeof f?.page === 'string' ? f.page : '',
    }))
    homeForm.serviceHotline = typeof cfg.serviceHotline === 'string' ? cfg.serviceHotline.trim() : ''
  } catch (e) { /* 已提示 */ } finally {
    homeLoading.value = false
  }
}

async function saveHome() {
  if (!validateHome()) return
  savingHome.value = true
  try {
    await financeAdminApi.updateHomeContent({
      deliveryNote: { title: homeForm.deliveryNote.title, subtitle: homeForm.deliveryNote.subtitle },
      notice: { enabled: homeForm.notice.enabled, text: homeForm.notice.text },
      recommendationIds: homeForm.recommendationIds,
      // 卡BA-2：三个新字段（缺 key 的条目在此补齐，保证列表 v-for / 前端渲染 key 稳定）
      bannerImages: { enabled: homeForm.bannerImages.enabled, images: [...homeForm.bannerImages.images] },
      features: homeForm.features.map((f) => ({
        key: f.key || genFeatureKey(),
        label: (f.label || '').trim(),
        emoji: (f.emoji || '').trim(),
        type: f.type,
        page: f.type === 'todo' ? '' : (f.page || '').trim(),
      })),
      serviceHotline: (homeForm.serviceHotline || '').trim(),
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

// 选图 → 本地压缩到 300KB 内（原图达标则原样保留）→ 存为待上传 base64
async function onQrFile(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  try {
    pendingQrBase64.value = await compressFileToDataUri(file)
  } catch (err) {
    ElMessage.error('图片读取失败，请重试')
  } finally {
    e.target.value = '' // 允许重复选择同一文件
  }
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

// ── 卡BN-2（2026-10-02）：未接单催办设置卡（纯增量，不改任何既有逻辑） ──
// 契约：GET/PUT /admin/supplier-notify/config；PUT body 为配置子集，launchAt 由后端管理（首次保存写入，之后不可改）
const notifyLoading = ref(false)
const savingNotify = ref(false)
const testingCall = ref(false)
const notifyConfig = ref(null)
const notifyForm = reactive({
  enabled: false,
  thresholdMinutes: 5,
  secondGapMinutes: 10,
  maxCalls: 2,
  quietEnabled: true,
  quietStart: '22:00',
  quietEnd: '05:00',
})

const fmtLaunchAt = computed(() => {
  const iso = notifyConfig.value?.launchAt
  if (!iso) return '（未定）'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

async function loadNotify() {
  notifyLoading.value = true
  try {
    const cfg = await request.get('/admin/supplier-notify/config')
    notifyConfig.value = cfg
    notifyForm.enabled = !!cfg.enabled
    notifyForm.thresholdMinutes = cfg.thresholdMinutes ?? 5
    notifyForm.secondGapMinutes = cfg.secondGapMinutes ?? 10
    notifyForm.maxCalls = cfg.maxCalls ?? 2
    notifyForm.quietEnabled = !!cfg.quietEnabled
    notifyForm.quietStart = cfg.quietStart || '22:00'
    notifyForm.quietEnd = cfg.quietEnd || '05:00'
  } catch (e) { /* 已提示 */ } finally {
    notifyLoading.value = false
  }
}

// 保存前前端基本校验（与后端 validateReminderConfig 同口径）；后端仍会校验，400 的 msg 由 request 拦截器原样 toast
const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
function validateNotify() {
  const intIn = (v, min, max, name) => {
    if (!Number.isInteger(v) || v < min || v > max) {
      ElMessage.warning(`${name} 必须为 ${min}–${max} 的整数`)
      return false
    }
    return true
  }
  if (!intIn(notifyForm.thresholdMinutes, 1, 1440, '未接单判定阈值')) return false
  if (!intIn(notifyForm.secondGapMinutes, 1, 1440, '第 2 通间隔')) return false
  if (!intIn(notifyForm.maxCalls, 0, 5, '最多拨打次数')) return false
  if (!HH_MM_RE.test(notifyForm.quietStart || '') || !HH_MM_RE.test(notifyForm.quietEnd || '')) {
    ElMessage.warning('免打扰时段必须为 HH:mm')
    return false
  }
  return true
}

async function saveNotify() {
  if (!validateNotify()) return
  savingNotify.value = true
  try {
    notifyConfig.value = await request.put('/admin/supplier-notify/config', {
      enabled: notifyForm.enabled,
      thresholdMinutes: notifyForm.thresholdMinutes,
      secondGapMinutes: notifyForm.secondGapMinutes,
      maxCalls: notifyForm.maxCalls,
      quietEnabled: notifyForm.quietEnabled,
      quietStart: notifyForm.quietStart,
      quietEnd: notifyForm.quietEnd,
    })
    ElMessage.success('已保存，正在等待的订单会按新设置生效')
  } catch (e) { /* 已提示（400 的 msg 原样 toast） */ } finally {
    savingNotify.value = false
  }
}

// 测试拨打：弹输入框填手机号 → POST test-call（演练模式下后端 dry-run，不会真拨）
async function doTestCall() {
  let phone = ''
  try {
    const r = await ElMessageBox.prompt('输入运营自己的手机号，系统拨一通测试电话', '测试拨打', {
      confirmButtonText: '拨打',
      cancelButtonText: '取消',
      inputPattern: /^1\d{10}$/,
      inputErrorMessage: 'phone 必须为 11 位手机号',
    })
    phone = (r.value || '').trim()
  } catch (e) {
    return
  }
  testingCall.value = true
  try {
    const r = await request.post('/admin/supplier-notify/test-call', { phone })
    if (r.dryRun || r.result === 'dry_run') ElMessage.warning('演练模式：未真拨（已记审计）')
    else ElMessage.success(`测试电话已发起（${r.result || '已发起'}）`)
  } catch (e) { /* 已提示 */ } finally {
    testingCall.value = false
  }
}

// 与既有 onMounted 并列注册（Vue 3 支持多次注册），不改上面已有的挂载逻辑
onMounted(loadNotify)
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
/* ── 卡BA-2：首页内容三块新区域 ── */
.home-banner-thumb {
  width: 80px;
  height: 44px;
  border-radius: 4px;
  display: block;
}
.home-banner-url {
  font-size: 12px;
  color: #8a9099;
  word-break: break-all;
}

/* ── 卡BE：≤768px 表单行可换行（输入框已由全局规则铺满） ── */
@media (max-width: 768px) {
  .admin-settings-row,
  .admin-settings-add,
  .admin-settings-qr {
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .admin-settings-k {
    flex: 0 0 auto;
    min-width: 96px;
  }
}

/* ── 卡BN-2：未接单催办设置卡 · 语音通道只读区 ── */
.notify-readonly {
  margin-top: 14px;
  background: #fafbfc;
  border: 1px solid #eef1f4;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  color: #606266;
  line-height: 1.9;
}
.notify-readonly b {
  color: #1f2329;
}
.notify-launchat {
  color: #c87000;
}
.notify-launchat b {
  color: #c87000;
}
</style>
