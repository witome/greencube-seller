<template>
  <view class="page">
    <!-- 权限边界提示 -->
    <view class="notice">📝 新商品与商品信息变更均需运营审核后生效；日可供量可快速调整、即时生效。销售价由平台维护，您不可见</view>

    <!-- 搜索 + 状态筛选 -->
    <view class="card">
      <input
        v-model="keyword"
        class="ipt"
        placeholder="🔍 搜索我的商品（名称）"
        confirm-type="search"
        @confirm="load"
      />
      <view class="chip-group filter-chips">
        <view
          v-for="f in filters"
          :key="f.key"
          class="chip"
          :class="{ on: f.key === activeFilter }"
          @tap="switchFilter(f.key)"
        >{{ f.label }}</view>
      </view>
    </view>

    <!-- 提交新商品：展开/收起 -->
    <view class="row-btns">
      <view class="pbtn primary" @tap="showForm = !showForm">
        {{ showForm ? '收起表单' : '＋ 提交新商品' }}
      </view>
    </view>
    <view v-if="showForm" class="card">
      <view class="card-title">🆕 提交新商品</view>
      <view class="form-row"><view class="fr-l">商品名称</view><view class="fr-r"><input v-model="form.name" class="ipt" placeholder="如：山东大姜（老姜）" /></view></view>
      <view class="form-row">
        <view class="fr-l">商品分类</view>
        <view class="fr-r">
          <picker v-if="catNames.length" :range="catNames" @change="onCatChange">
            <view class="picker-val">{{ form.categoryName || '请选择分类' }} ▾</view>
          </picker>
          <view v-else class="muted">暂无授权分类，请联系运营开通</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">计量方式</view>
        <view class="fr-r">
          <view class="chip-group">
            <view class="chip" :class="{ on: form.weighType === 1 }" @tap="form.weighType = 1">称重（斤）</view>
            <view class="chip" :class="{ on: form.weighType === 2 }" @tap="form.weighType = 2">固定规格</view>
          </view>
        </view>
      </view>
      <view class="form-row"><view class="fr-l">供货价</view><view class="fr-r"><input v-model="form.supplyPrice" class="ipt" type="digit" placeholder="如 2.20（元/斤，提交后审核）" /></view></view>
      <view class="form-row"><view class="fr-l">日可供量</view><view class="fr-r"><input v-model="form.dailySupply" class="ipt" type="digit" placeholder="如 200（斤）" /></view></view>
      <view class="form-row"><view class="fr-l">资质证明</view><view class="fr-r muted">＋ 上传检疫合格证等（肉类/水产必填）</view></view>
      <view class="row-btns">
        <view class="pbtn primary" @tap="submit">提交申请</view>
      </view>
    </view>

    <!-- 我的商品列表 -->
    <view class="section-title">我的商品（{{ goods.length }}）</view>
    <view v-for="g in goods" :key="g.id" class="list-item">
      <view class="li-ico" :style="{ background: icoBg(g.status) }">{{ iconOf(g.status) }}</view>
      <view class="li-main">
        <view class="li-t">
          {{ g.name }}
          <view class="act-link" @tap="openEdit(g)">✏️ 编辑</view>
          <view class="act-stock" @tap="openStock(g)">⚡ 改库存</view>
        </view>
        <view class="li-d">
          供货价 ¥{{ g.supplyPrice }}/{{ g.unit }} · 日供 {{ g.dailySupply }}{{ g.unit }}
          <text v-if="g.changeInfo" style="color:#FF8F1F;"> · 变更中</text>
          <text v-if="g.rejectReason" style="color:#FA5151;"> · {{ g.rejectReason }}</text>
        </view>
      </view>
      <view class="tag" :class="tagType(g.status)">{{ g.statusText }}</view>
    </view>
    <view v-if="!loading && !goods.length" class="empty">暂无商品，点上方「提交新商品」添加</view>

    <!-- 快速改库存弹层（免审核即时生效） -->
    <view v-if="stockTarget" class="mask" @tap="stockTarget = null">
      <view class="modal" @tap.stop>
        <view class="card-title">⚡ 快速调整日可供量</view>
        <view class="muted" style="margin-bottom:12px;">{{ stockTarget.name }}（库存调整不涉价格规格，免审核，保存即生效）</view>
        <input v-model="stockValue" class="ipt" type="digit" placeholder="输入新的日可供量，如 300" />
        <view class="row-btns">
          <view class="pbtn ghost" @tap="stockTarget = null">取消</view>
          <view class="pbtn primary" @tap="saveStock">保存</view>
        </view>
      </view>
    </view>

    <!-- 编辑商品弹层（走变更审核） -->
    <view v-if="editTarget" class="mask" @tap="editTarget = null">
      <view class="modal" @tap.stop>
        <view class="card-title">✏️ 编辑商品（提交后走运营审核）</view>
        <view class="muted" style="margin-bottom:12px;">{{ editTarget.name }}（变更审核期间原信息继续在售）</view>
        <view class="form-row"><view class="fr-l">商品名称</view><view class="fr-r"><input v-model="editForm.name" class="ipt" placeholder="不改则留空" /></view></view>
        <view class="form-row"><view class="fr-l">供货价</view><view class="fr-r"><input v-model="editForm.supplyPrice" class="ipt" type="digit" placeholder="不改则留空" /></view></view>
        <view class="form-row"><view class="fr-l">日可供量</view><view class="fr-r"><input v-model="editForm.dailySupply" class="ipt" type="digit" placeholder="不改则留空（也可用⚡改库存）" /></view></view>
        <view class="row-btns">
          <view class="pbtn ghost" @tap="editTarget = null">取消</view>
          <view class="pbtn primary" @tap="submitEdit">提交变更</view>
        </view>
      </view>
    </view>

    <!-- 底部固定语音入口（2026-09-25 卡U，与原型①屏一致）：
         插件不可用（H5 / 未声明 WechatSI）时按钮不出现，只剩打字入口 —— 与采购方 kefu.vue 同一策略 -->
    <view class="voice-bar">
      <view class="voice-hint">例：「西红柿三块八，今天有两百斤」</view>
      <view v-if="voiceReady" class="voice-btn" @tap="goVoiceReport">
        <view class="voice-btn-t">🎤 按住说话 改价 / 报量</view>
        <view class="voice-btn-d">说完会念给你确认，认错了可以改</view>
      </view>
      <view v-else class="voice-typing">
        <input v-model="voiceText" class="voice-ipt" placeholder="打字报量 / 改价，如：西红柿三块八，今天有两百斤" confirm-type="send" @confirm="goVoiceByText" />
        <view class="voice-send" :class="{ disabled: !voiceText.trim() }" @tap="goVoiceByText">解析</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'

const goods = ref([])
const loading = ref(false)
const keyword = ref('')
const activeFilter = ref('all')

const filters = [
  { key: 'all', label: '全部' },
  { key: 'on_sale', label: '在售' },
  { key: 'changing', label: '变更中' },
  { key: 'pending', label: '待审核' },
  { key: 'rejected', label: '已驳回' },
  { key: 'off_shelf', label: '已下架' },
]

// 分类（提交新品用）
const cats = ref([])
const catNames = ref([])
const form = ref({ name: '', categoryId: null, categoryName: '', weighType: 1, supplyPrice: '', dailySupply: '' })

const showForm = ref(false)

// 快速改库存
const stockTarget = ref(null)
const stockValue = ref('')

// 编辑（变更审核）
const editTarget = ref(null)
const editForm = ref({ name: '', supplyPrice: '', dailySupply: '' })

// ── 底部语音入口（2026-09-25 卡U）──
const voiceReady = ref(false)
const voiceText = ref('')

// #ifdef MP-WEIXIN
try {
  // 插件未声明/未授权时 requirePlugin 抛错 → 按钮不出现，只剩打字入口（与采购方 kefu.vue 同策略）
  if (typeof requirePlugin === 'function') {
    const si = requirePlugin('WechatSI')
    if (si && typeof si.getRecordRecognitionManager === 'function') {
      voiceReady.value = true
    }
  }
} catch (e) {
  console.warn('[语音报量] 同声传译插件不可用，已切换为打字入口：', e && e.message)
}
// #endif

function goVoiceReport() {
  uni.navigateTo({ url: '/subpkg-supplier/pages/voice-report' })
}

function goVoiceByText() {
  const t = voiceText.value.trim()
  if (!t) { uni.showToast({ title: '先输入报量 / 改价内容', icon: 'none' }); return }
  uni.setStorageSync('voiceReportText', t)
  voiceText.value = ''
  uni.navigateTo({ url: '/subpkg-supplier/pages/voice-report' })
}

const iconOf = (s) => ({ on_sale: '🥬', changing: '🥬', pending: '🫚', rejected: '🥬', off_shelf: '📦' }[s] || '🥬')
const icoBg = (s) => ({ on_sale: '#E6F9F0', changing: '#E6F9F0', pending: '#FFF3E6', rejected: '#FFEDED', off_shelf: '#F0F1F3' }[s] || '#E6F9F0')
const tagType = (s) => ({ on_sale: 'g', changing: 'o', pending: 'o', rejected: 'r', off_shelf: 'gray' }[s] || 'gray')

onShow(() => {
})

async function load() {
  loading.value = true
  try {
    const params = {}
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    if (activeFilter.value !== 'all') params.status = activeFilter.value
    const data = await supplierApi.getMyGoods(params)
    goods.value = data.list || []
  } catch (e) {
    /* 已提示 */
  } finally {
    loading.value = false
  }
}

function switchFilter(key) {
  activeFilter.value = key
  load()
}

async function loadCats() {
  try {
    const roots = await supplierApi.getMyCategories()
    cats.value = roots
    catNames.value = roots.map((c) => c.name)
  } catch (e) { /* 忽略，无授权分类时提交会校验 */ }
}

function onCatChange(e) {
  const idx = Number(e.detail.value)
  const c = cats.value[idx]
  if (c) {
    form.value.categoryId = c.id
    form.value.categoryName = c.name
  }
}

async function submit() {
  if (!form.value.name) { uni.showToast({ title: '请填写商品名称', icon: 'none' }); return }
  if (!form.value.categoryId) { uni.showToast({ title: '请选择商品分类', icon: 'none' }); return }
  const price = Number(form.value.supplyPrice)
  const supply = Number(form.value.dailySupply)
  if (!price || price <= 0) { uni.showToast({ title: '请填写正确的供货价', icon: 'none' }); return }
  if (isNaN(supply)) { uni.showToast({ title: '请填写日可供量', icon: 'none' }); return }

  await supplierApi.submitGoods({
    name: form.value.name,
    categoryId: form.value.categoryId,
    weighType: form.value.weighType,
    supplyPrice: price,
    dailySupply: supply,
  })
  uni.showToast({ title: '已提交，等待运营审核', icon: 'none' })
  showForm.value = false
  form.value = { name: '', categoryId: null, categoryName: '', weighType: 1, supplyPrice: '', dailySupply: '' }
  load()
}

function openStock(g) {
  stockTarget.value = g
  stockValue.value = String(g.dailySupply)
}

async function saveStock() {
  const v = Number(stockValue.value)
  if (isNaN(v) || v < 0) { uni.showToast({ title: '请输入有效数量', icon: 'none' }); return }
  await supplierApi.quickStock(stockTarget.value.id, v)
  uni.showToast({ title: '已生效（免审核）', icon: 'none' })
  stockTarget.value = null
  load()
}

function openEdit(g) {
  editTarget.value = g
  editForm.value = { name: '', supplyPrice: '', dailySupply: '' }
}

async function submitEdit() {
  const changes = {}
  if (editForm.value.name.trim()) changes.name = editForm.value.name.trim()
  const price = Number(editForm.value.supplyPrice)
  const supply = Number(editForm.value.dailySupply)
  if (editForm.value.supplyPrice && (!price || price <= 0)) { uni.showToast({ title: '供货价无效', icon: 'none' }); return }
  if (editForm.value.dailySupply && (isNaN(supply) || supply < 0)) { uni.showToast({ title: '日可供量无效', icon: 'none' }); return }
  if (price) changes.supplyPrice = price
  if (editForm.value.dailySupply) changes.dailySupply = supply

  if (!Object.keys(changes).length) { uni.showToast({ title: '未填写任何变更内容', icon: 'none' }); return }

  await supplierApi.applyChange(editTarget.value.id, { changes })
  uni.showToast({ title: '变更已提交，等待审核', icon: 'none' })
  editTarget.value = null
  load()
}

onMounted(() => {
  loadCats()
  load()
})
</script>

<style lang="scss" scoped>
.filter-chips { margin-top: 8px; }
.act-link { display: inline; color: $brand-deep; font-size: 12px; font-weight: 600; margin-left: 8px; }
.act-stock { display: inline; color: $info; font-size: 12px; font-weight: 600; margin-left: 8px; }
.form-row { display: flex; align-items: center; padding: 12px 0; font-size: 14px; }
.fr-l { width: 76px; color: $text-second; flex-shrink: 0; }
.fr-r { flex: 1; margin-left: 12px; min-width: 0; }
.ipt { width: 100%; min-height: 40px; height: 40px; line-height: 40px; text-align: left; font-size: 14px; color: $text-body; }
.picker-val { color: $color-primary; }
.muted { color: $text-placeholder; font-size: 12px; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }

/* 弹层 */
.mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 99;
}
.modal {
  width: 86%; background: #fff; border-radius: 12px; padding: 16px;
}
.modal .ipt {
  background: $bg-soft; border-radius: 8px; padding: 10px 12px; text-align: left; margin-bottom: 4px;
}

/* ── 底部固定语音入口（卡U）：列表底部留白跟着加大，别让最后一行被盖住 ── */
.page { padding-bottom: 180rpx; }
.voice-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
  background: #fff; border-top: 1px solid #EEF1F4;
  padding: 16rpx 24rpx calc(20rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -8rpx 28rpx rgba(0, 0, 0, 0.05);
}
.voice-hint { font-size: 20rpx; color: #8A9099; text-align: center; margin-bottom: 12rpx; }
.voice-btn {
  background: linear-gradient(120deg, #00B96B, #35C98D); color: #fff;
  border-radius: 28rpx; padding: 22rpx; text-align: center;
  box-shadow: 0 12rpx 32rpx rgba(0, 185, 107, 0.28);
}
.voice-btn-t { font-size: 32rpx; font-weight: 700; }
.voice-btn-d { font-size: 20rpx; opacity: 0.92; margin-top: 6rpx; }
.voice-typing { display: flex; gap: 12rpx; align-items: center; }
.voice-ipt {
  flex: 1; min-height: 72rpx; height: 72rpx; line-height: 72rpx;
  background: #F5F6F8; border-radius: 16rpx; padding: 0 20rpx; font-size: 26rpx;
}
.voice-send {
  flex: none; background: #00B96B; color: #fff; font-size: 26rpx; font-weight: 600;
  padding: 16rpx 28rpx; border-radius: 16rpx;
}
.voice-send.disabled { opacity: 0.5; }
</style>
