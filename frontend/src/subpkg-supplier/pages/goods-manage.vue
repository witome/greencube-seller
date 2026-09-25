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
      <!-- 卡Z1：封面图（一期一张，点选可重选）+ 资质证明（真上传，上限5张） -->
      <view class="form-row form-top">
        <view class="fr-l">封面图</view>
        <view class="fr-r">
          <view v-if="!formCover && !coverPicking" class="cover-empty" @tap="pickFormCover">📷 点击选封面图<small>建议实拍：光线好、菜新鲜、别带包装袋</small></view>
          <view v-else class="cover-picked" @tap="pickFormCover">
            <view class="cover-thumb">
              <image v-if="formCover" :src="fullUrl(formCover)" mode="aspectFill" class="cover-thumb-img" />
              <view v-else class="cover-thumb-img cover-loading"></view>
              <view class="cam-badge lg">📷</view>
            </view>
            <view class="cover-meta">
              <view class="cover-meta-t">{{ coverPicking ? '上传中…' : '已选 1 张 · 点击可重选' }}</view>
              <view class="cover-meta-d">随申请一起提交，走运营审核</view>
            </view>
          </view>
        </view>
      </view>
      <view class="form-row form-top">
        <view class="fr-l">资质证明</view>
        <view class="fr-r">
          <view class="pic-grid">
            <view v-for="(p, i) in formQual" :key="i" class="pic">
              <image :src="fullUrl(p)" mode="aspectFill" class="pic-img" @tap="previewPhotos(formQual, p)" />
              <view class="pic-x" @tap.stop="formQual.splice(i, 1)">✕</view>
            </view>
            <view v-if="formQual.length < 5" class="pic-add" @tap="addQual">＋</view>
          </view>
          <view class="muted" style="font-size:11px;margin-top:4px;">营业执照、检疫合格证等（肉类/水产必填，最多 5 张，点图可查看）</view>
        </view>
      </view>
      <view class="row-btns">
        <view class="pbtn primary" @tap="submit">提交申请</view>
      </view>
    </view>

    <!-- 我的商品列表 -->
    <view class="section-title">我的商品（{{ goods.length }}）</view>
    <view v-for="g in goods" :key="g.id" class="list-item">
      <!-- 卡Z1：封面缩略图（有 cover 显真图，无 cover 回退 emoji；点相机角标换图，免审即时） -->
      <view class="li-thumb" @tap.stop="onTapCover(g)">
        <image v-if="g.cover" :src="fullUrl(g.cover)" mode="aspectFill" class="li-img" />
        <view v-else class="li-ico" :style="{ background: icoBg(g.status) }">{{ iconOf(g.status) }}</view>
        <view v-if="coverUploadingId === g.id" class="thumb-spin"></view>
        <view class="cam-badge">📷</view>
      </view>
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

    <!-- 底部固定语音入口（卡W：真·按住录音，松手落语音报价页确认页 —— 做法 A）：
         有插件（真机）= 真·按住 + 录音浮层 + 「⌨️ 打字报量」切换（形态①，真机保留打字入口）；
         插件不可用（H5 / 未声明 WechatSI）= 整条语音按钮不出现，只剩打字入口（现状保持） -->
    <view class="voice-bar">
      <view class="voice-hint">例：「西红柿三块八，今天有两百斤」</view>
      <template v-if="voiceReady">
        <view
          v-if="!voiceTyping"
          class="voice-btn"
          :class="{ rec: recording }"
          @touchstart.prevent="onMicStart"
          @touchmove.prevent="onMicMove"
          @touchend.prevent="onMicStop"
          @touchcancel="onMicStop"
        >
          <view class="voice-btn-t">🎤 按住说话 改价 / 报量</view>
          <view class="voice-btn-d">说完会念给你确认，认错了可以改</view>
        </view>
        <view v-else class="voice-typing">
          <input v-model="voiceText" class="voice-ipt" placeholder="打字报量 / 改价，如：西红柿三块八，今天有两百斤" confirm-type="send" @confirm="goVoiceByText" />
          <view class="voice-send" :class="{ disabled: !voiceText.trim() }" @tap="goVoiceByText">解析</view>
        </view>
        <view class="voice-swap" @tap="voiceTyping = !voiceTyping">{{ voiceTyping ? '🎤 改用按住说话' : '⌨️ 打字报量' }}</view>
      </template>
      <view v-else class="voice-typing">
        <input v-model="voiceText" class="voice-ipt" placeholder="打字报量 / 改价，如：西红柿三块八，今天有两百斤" confirm-type="send" @confirm="goVoiceByText" />
        <view class="voice-send" :class="{ disabled: !voiceText.trim() }" @tap="goVoiceByText">解析</view>
      </view>
    </view>

    <!-- 录音浮层（与语音报价页同一形态：从底部升起，显示实时识别文字） -->
    <view v-if="recording" class="rec-mask" @touchmove.stop.prevent>
      <view class="rec-panel">
        <view class="rec-wave">
          <i v-for="(h, i) in waveBars" :key="i" :style="{ height: h + 'px' }"></i>
        </view>
        <view class="rec-heard">{{ recText || '正在听您说…' }}<text class="dim">（正在听）</text></view>
        <view class="rec-hint">松手结束 · 最长 30 秒 · 说慢点、说清「哪个菜、多少钱、有多少」</view>
      </view>
    </view>
    <!-- 确认/结果抽屉（卡X：松手/打字后就地升起，不跳页；确认→三选一→提交→结果→关闭全在抽屉内） -->
    <VoiceConfirm
      v-if="drawerOpen"
      :raw-text="confirmData.rawText"
      :draft="confirmData.draft"
      :unmatched-details="confirmData.unmatchedDetails"
      :candidates="confirmData.candidates"
      :question="confirmData.question"
      @close="onDrawerClose"
      @submitted="onDrawerSubmitted"
      @resay="onDrawerResay"
    />
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'
import { post, put, fullUrl } from '@/api/request'
import { pickPhotos, uploadPhoto, previewPhotos } from '@/utils/photo-upload'
import { createVoiceHold } from '@/utils/voice-record'
import VoiceConfirm from '@/components/VoiceConfirm.vue'

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

// ── 换封面（卡Z1：免审即时生效，走 PUT /supplier-goods/:id/cover）──
const coverUploadingId = ref(null) // 正在上传的商品 id：盖转圈 + 防重复点击

function onTapCover(g) {
  if (coverUploadingId.value) return // 上传中整页只允许一个在传，防连点并发写
  uni.showActionSheet({
    itemList: ['拍照', '从相册选择'],
    success: ({ tapIndex }) => changeCover(g, tapIndex === 0 ? ['camera'] : ['album']),
    fail: () => {}, // 用户点了取消
  })
}

async function changeCover(g, sourceType) {
  try {
    const paths = await pickPhotos({ count: 1, sourceType })
    const path = paths && paths[0]
    if (!path) return
    coverUploadingId.value = g.id
    try {
      const url = await uploadPhoto(path) // 压缩（≤300KB）→ POST /upload/image
      await put(`/supplier-goods/${g.id}/cover`, { cover: url })
      g.cover = url // 就地替换缩略图，不整页刷新
      uni.showToast({ title: '封面已更新（已生效）', icon: 'none' })
    } finally {
      coverUploadingId.value = null
    }
  } catch (e) {
    coverUploadingId.value = null
    if (e && e.cancelled) return // 用户取消选图
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' }) // 网络/图片过大等可读提示；业务错误 request 层已 toast
  }
}

// ── 新商品表单：封面 + 资质证明（卡Z1：把「＋ 上传检疫合格证」死文案接上真上传）──
const formCover = ref('') // 相对地址 /uploads/xxx
const formQual = ref([])
const coverPicking = ref(false)
const qualUploading = ref(false)

async function pickFormCover() {
  if (coverPicking.value) return
  try {
    const paths = await pickPhotos({ count: 1 })
    if (!paths || !paths[0]) return
    coverPicking.value = true
    try {
      formCover.value = await uploadPhoto(paths[0])
    } finally {
      coverPicking.value = false
    }
  } catch (e) {
    coverPicking.value = false
    if (e && e.cancelled) return
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  }
}

async function addQual() {
  if (qualUploading.value) return
  const remain = 5 - formQual.value.length
  if (remain <= 0) { uni.showToast({ title: '资质证明最多 5 张', icon: 'none' }); return }
  try {
    const paths = await pickPhotos({ count: remain })
    if (!paths || !paths.length) return
    qualUploading.value = true
    try {
      for (const p of paths) formQual.value.push(await uploadPhoto(p))
    } finally {
      qualUploading.value = false
    }
  } catch (e) {
    qualUploading.value = false
    if (e && e.cancelled) return
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  }
}

// ── 底部语音入口（卡W：真·按住录音，共享实现 utils/voice-record.js，全仓唯一）──
// 卡X：松手/打字不再跳页 —— 就地解析后升起 VoiceConfirm 抽屉（确认→提交→结果→关闭全在本页）
const voiceText = ref('')
const voiceTyping = ref(false) // 形态①：打字是次选入口，点「⌨️ 打字报量」切换显示
const parsing = ref(false)
const drawerOpen = ref(false)
const confirmData = ref({ rawText: '', draft: [], unmatchedDetails: [], candidates: [], question: '' })

const voice = createVoiceHold({
  onDone: (text) => {
    const t = String(text || '').trim()
    if (t) parseText(t) // 卡X：松手 → 就地解析开抽屉（不再 setStorageSync 跳页）
  },
  onFail: (msg, meta) => {
    // 识别空/失败：不跳页，就地兜底（文案由共享实现给）；连说两次没听清 → 就地切到打字（卡W 行为保留）
    uni.showToast({ title: msg, icon: 'none' })
    if (meta && meta.escalated) voiceTyping.value = true
  },
})
const voiceReady = voice.ready
const recording = voice.recording
const recText = voice.partial
const waveBars = voice.waveBars
const onMicStart = () => { if (parsing.value || drawerOpen.value) return; voice.handleStart() }
const onMicStop = voice.handleStop
const onMicMove = voice.handleMove
onHide(() => voice.stopForLeave())
onUnload(() => voice.stopForLeave())

// ── 解析（走 /ai/supplier-parse；确认态计算在 VoiceConfirm 组件内，本页不碰）──
async function parseText(text) {
  const t = (text || '').trim()
  if (!t || parsing.value) return
  parsing.value = true
  try {
    const res = await post('/ai/supplier-parse', { text: t })
    if (!(res.draft || []).length && !(res.unmatchedDetails || []).length && !(res.unmatched || []).length && !res.needClarify) {
      uni.showToast({ title: '没认出可改的内容，试试「菜名 + 价格 / 数量」', icon: 'none' })
      return
    }
    confirmData.value = {
      rawText: res.rawText || t,
      draft: res.draft || [],
      unmatchedDetails: res.unmatchedDetails || [],
      candidates: res.candidates || [],
      question: res.needClarify || '',
    }
    drawerOpen.value = true
  } catch (e) {
    /* 错误已由 request.js 统一提示 */
  } finally {
    parsing.value = false
  }
}

function goVoiceByText() {
  const t = voiceText.value.trim()
  if (!t) { uni.showToast({ title: '先输入报量 / 改价内容', icon: 'none' }); return }
  voiceText.value = ''
  parseText(t) // 卡X：就地抽屉，不跳页
}

// ── 抽屉事件（卡X：关闭后刷新列表，改量后立刻看到新数字）──
function onDrawerClose() {
  drawerOpen.value = false
  load()
}
function onDrawerSubmitted() { /* 结果在组件内展示；关闭时统一刷新 */ }
function onDrawerResay() {
  drawerOpen.value = false
  voiceTyping.value = false // 回到按住说话状态（就地）
  load() // 结果轮「再报一条」走这里，把已提交的数字刷进列表
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
    // 卡Z1：封面 + 资质证明（资质照片走 apply 已有的 images 字段，原型⑦屏口径）一并提交
    cover: formCover.value || undefined,
    images: formQual.value.length ? formQual.value : undefined,
  })
  uni.showToast({ title: '已提交，等待运营审核', icon: 'none' })
  showForm.value = false
  form.value = { name: '', categoryId: null, categoryName: '', weighType: 1, supplyPrice: '', dailySupply: '' }
  formCover.value = ''
  formQual.value = []
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

/* ── 封面缩略图（卡Z1）：有 cover 显真图，无 cover 回退 emoji；点角标换图 ── */
.li-thumb {
  width: 46px; height: 46px; border-radius: 9px; flex-shrink: 0;
  position: relative; overflow: visible; margin-right: 12px;
}
.li-img { width: 46px; height: 46px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.cam-badge {
  position: absolute; right: -4px; bottom: -4px; width: 18px; height: 18px; border-radius: 50%;
  background: rgba(17, 17, 17, 0.78); color: #fff; font-size: 9px; line-height: 1;
  display: flex; align-items: center; justify-content: center; border: 2px solid #fff; z-index: 2;
}
.cam-badge.lg { width: 24px; height: 24px; font-size: 12px; right: -6px; bottom: -6px; }
.thumb-spin {
  position: absolute; left: 0; top: 0; width: 46px; height: 46px; border-radius: 9px;
  background: rgba(255, 255, 255, 0.72); z-index: 3; overflow: hidden;
}
.thumb-spin::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border-radius: 50%; border: 3px solid #E6F9F0; border-top-color: #00B96B;
  animation: cover-spin 0.9s linear infinite;
}
@keyframes cover-spin { to { transform: rotate(360deg); } }

/* 新商品表单：封面区 + 资质网格（原型⑦屏） */
.form-top { align-items: flex-start; }
.cover-empty {
  border: 1.5px dashed #C9D2DA; border-radius: 9px; padding: 18px 12px; text-align: center;
  color: #8A9099; font-size: 13px; display: flex; flex-direction: column; gap: 4px;
}
.cover-empty small { font-size: 11px; color: #B3B9C2; }
.cover-picked { display: flex; align-items: center; gap: 10px; }
.cover-thumb { width: 52px; height: 52px; border-radius: 9px; position: relative; flex-shrink: 0; }
.cover-thumb-img { width: 52px; height: 52px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.cover-thumb-img.cover-loading { background: #F0F1F3; }
.cover-meta-t { font-size: 13px; font-weight: 600; color: $text-title; }
.cover-meta-d { font-size: 10.5px; color: #8A9099; margin-top: 2px; }
.pic-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.pic { width: 52px; height: 52px; border-radius: 9px; position: relative; }
.pic-img { width: 52px; height: 52px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.pic-x {
  position: absolute; top: -6px; right: -6px; width: 17px; height: 17px; border-radius: 50%;
  background: rgba(17, 17, 17, 0.78); color: #fff; font-size: 10px;
  display: flex; align-items: center; justify-content: center; border: 2px solid #fff;
}
.pic-add {
  width: 52px; height: 52px; border-radius: 9px; border: 1.5px dashed #C9D2DA;
  display: flex; align-items: center; justify-content: center; font-size: 20px; color: #B3B9C2;
}

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

/* ── 底部固定语音入口（卡U 建，卡W 改真·按住）：列表底部留白跟着加大，别让最后一行被盖住 ── */
.page { padding-bottom: 280rpx; }
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
.voice-btn.rec { background: #1F2329; box-shadow: none; opacity: 0.92; }
.voice-btn-t { font-size: 32rpx; font-weight: 700; }
.voice-btn-d { font-size: 20rpx; opacity: 0.92; margin-top: 6rpx; }
/* 形态①：打字是次选入口 —— 小切换链接（点开变输入框），不跟主按钮抢宽度 */
.voice-swap { font-size: 22rpx; color: #8A9099; text-align: center; padding: 10rpx 0 0; }
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

/* 录音浮层（与语音报价页 voice-report.vue 同一套值：从底部升起） */
.rec-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 99;
  background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end;
}
.rec-panel {
  width: 100%; background: #1F2329; color: #fff;
  padding: 40rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  display: flex; flex-direction: column; align-items: center; gap: 24rpx;
}
.rec-wave { display: flex; align-items: flex-end; gap: 8rpx; height: 84rpx; }
.rec-wave i { display: block; width: 10rpx; border-radius: 6rpx; background: #35C98D; }
.rec-heard { font-size: 28rpx; line-height: 1.75; text-align: center; background: rgba(255, 255, 255, 0.09); border-radius: 20rpx; padding: 18rpx 22rpx; width: 100%; box-sizing: border-box; }
.rec-heard .dim { color: #9AA3AD; font-size: 22rpx; }
.rec-hint { font-size: 22rpx; color: #C6CDD6; text-align: center; line-height: 1.7; }
</style>
