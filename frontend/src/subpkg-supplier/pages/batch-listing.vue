<template>
  <view class="page page-batch">
    <!-- ════ 画面2 · 选图 + 串行上传/识别（卡BW-1 拍板①：一次最多 9 张） ════ -->
    <block v-if="step === 'pick'">
      <view class="row-btns">
        <view class="pbtn primary" @tap="addMore">📷 拍摄 / 从相册选择（最多 9 张）</view>
      </view>
      <view class="muted pick-tip">一次最多 <text class="strong">9 张</text>（微信硬上限）。选完逐张上传 + AI 识别，一张一张排队。</view>

      <view v-if="drafts.length" class="card">
        <view class="card-title pick-head">
          <text>本批照片</text>
          <text class="done-line">已完成 {{ doneCount }} / {{ drafts.length }}</text>
        </view>
        <view class="bgrid">
          <view v-for="(d, i) in drafts" :key="d.key" class="bcell" :class="{ dim: d.phase === 'queued' }">
            <view class="idx">{{ i + 1 }}</view>
            <image :src="fullUrl(d.cover)" mode="aspectFill" class="bimg" />
            <view v-if="d.phase === 'uploading' || d.phase === 'recognizing'" class="spin"></view>
            <view class="st" :class="stCls(d)">
              <text class="st-t">{{ stText(d).t }}</text>
              <text class="st-d">{{ stText(d).d }}</text>
            </view>
            <view v-if="d.phase === 'upload_fail'" class="rebtn" @tap.stop="retryOne(d)">重试</view>
          </view>
        </view>
        <view class="chip-group" style="margin-top:10px;">
          <view class="chip" @tap="addMore">＋ 继续添加（剩余 {{ remainTotal }} 张）</view>
        </view>
        <view class="muted" style="margin-top:6px;">超过 9 张会提示：「一次最多 9 张，多的请再发起一批」</view>
      </view>

      <view class="card">
        <view class="card-title">处理完进批量核对</view>
        <view class="muted" style="margin-bottom:8px;">全部格子出结果后点下面按钮进核对列表（每张照片一条草稿，可补全后提交）。</view>
        <view class="row-btns" style="margin:0;">
          <view class="pbtn ghost" @tap="resetBatch">＋ 再发起一批</view>
          <view class="pbtn primary" :class="{ disabled: !drafts.length || busy }" @tap="goReview">去核对（{{ drafts.length }} 条）</view>
        </view>
      </view>
    </block>

    <!-- ════ 画面3 · 批量核对列表（一张照片 = 一条商品卡） ════ -->
    <block v-else>
      <!-- 拍板②：本批共用资质证明（≤5 张，提交时附到每一条；单条自己传了以单条为准） -->
      <view class="card">
        <view class="card-title">🧾 本批共用资质证明（可选，最多 5 张）</view>
        <view class="pic-grid">
          <view v-for="(p, i) in sharedQual" :key="i" class="pic">
            <image :src="fullUrl(p)" mode="aspectFill" class="pic-img" @tap="previewPhotos(sharedQual, p)" />
            <view class="pic-x" @tap.stop="sharedQual.splice(i, 1)">✕</view>
          </view>
          <view v-if="sharedQual.length < 5" class="pic-add" @tap="addSharedQual">＋</view>
        </view>
        <view class="muted" style="margin-top:6px;">同一批货通常同一份检疫证，提交时附到每一条；单条卡里也能单独加（单条自己传了就以单条的为准）</view>
      </view>

      <!-- 汇总条 -->
      <view class="sumbar">
        共 <text class="strong">{{ drafts.length }}</text> 条 · <text class="n">可提交 {{ okCount }}</text> · <text class="w">待补全 {{ missCount }}</text>
        <text v-if="submitting" class="prog">正在提交 {{ submittedCount }} / {{ submitTotal }} 条 · 已成功 {{ okSubmitCount }}</text>
      </view>

      <!-- 草稿卡列表 -->
      <view v-for="d in drafts" :key="d.key" class="bcard" :class="{ open: d.open }">
        <!-- 收起头：缩略图 + 名称 + 一行关键值 + 状态角标 -->
        <view class="bc-head" @tap="toggleCard(d)">
          <view class="bc-thumb">
            <image v-if="d.cover" :src="fullUrl(d.cover)" mode="aspectFill" class="bc-thumb-img" />
            <view v-else class="bc-thumb-img bc-thumb-empty">📷</view>
          </view>
          <view class="li-main">
            <view class="li-t">
              {{ d.form.name || '（未命名）' }}
              <text class="tag" :class="tagCls(d)">{{ tagText(d) }}</text>
            </view>
            <view class="li-d">{{ headLine(d) }}</view>
            <view v-if="missingOf(d).length && d.submitState !== 'ok'" class="bc-miss">{{ missingOf(d).join('、') }}</view>
          </view>
          <text class="bc-caret">{{ d.open ? '▴' : '▾' }}</text>
        </view>

        <!-- 展开：单条表单同款字段与顺序 -->
        <view v-if="d.open" class="bc-body">
          <view v-if="d.phase === 'done' && (d.ai.name || d.ai.category || d.ai.weigh)" class="ai-flash"><text>✨</text> AI 已识别这张照片，已帮你填好下面 3 项，请核对</view>
          <view v-else-if="d.phase === 'warn'" class="muted" style="margin-bottom:6px;">AI 没认出这张照片，手动填写也一样能提交（和单条链路同一兜底口径）</view>

          <view class="form-row"><view class="fr-l">商品名称</view><view class="fr-r"><input v-model="d.form.name" class="ipt" :class="{ 'ipt-ai': d.ai.name }" placeholder="如：山东大姜（老姜）" @input="d.ai.name = false" /></view></view>
          <view class="form-row form-top">
            <view class="fr-l">商品分类</view>
            <view class="fr-r">
              <view v-if="cats.length" class="chip-group">
                <view v-for="c in cats" :key="c.id" class="chip" :class="{ on: d.form.categoryId === c.id }" @tap="pickCat(d, c)">{{ c.name }}</view>
              </view>
              <view v-else class="muted">暂无授权分类，请联系运营开通</view>
              <view v-if="d.ai.category && d.form.categoryId" class="muted">AI 选的是「{{ d.form.categoryName }}」，认错了点别的分类即可</view>
            </view>
          </view>
          <view class="form-row form-top">
            <view class="fr-l">计量方式</view>
            <view class="fr-r">
              <view class="chip-group">
                <view class="chip" :class="{ on: d.form.weighType === 1 }" @tap="d.form.weighType = 1; d.ai.weigh = false">称重</view>
                <view class="chip" :class="{ on: d.form.weighType === 2 }" @tap="d.form.weighType = 2; d.ai.weigh = false">固定规格</view>
              </view>
            </view>
          </view>
          <view class="form-row form-top">
            <view class="fr-l">单位</view>
            <view class="fr-r">
              <view class="chip-group">
                <view v-for="u in unitOptionsFor(d.form.unit)" :key="u.name" class="chip" :class="{ on: d.form.unit === u.name }" @tap="d.form.unit = u.name">{{ u.name }}<text v-if="u.off" class="chip-off">（已停用）</text></view>
              </view>
              <view class="muted">单位由平台维护，只能从上面选；AI 不猜单位，默认按「斤」</view>
            </view>
          </view>
          <view class="form-row form-top">
            <view class="fr-l">商品备注</view>
            <view class="fr-r">
              <textarea v-model="d.form.remark" class="ipt ta-remark" :maxlength="12" placeholder="如：今天刚到的老姜（可不填）" />
              <view class="muted remark-meta">会显示在采购方商品名下方（灰字），可不填；最多 12 字<text class="remark-count">{{ (d.form.remark || '').length }}/12</text></view>
            </view>
          </view>
          <view class="form-row"><view class="fr-l">供货价</view><view class="fr-r"><input v-model="d.form.supplyPrice" class="ipt" type="digit" placeholder="如 2.20（元/斤，提交后审核）" /></view></view>
          <view class="form-row"><view class="fr-l">日可供量</view><view class="fr-r"><input v-model="d.form.dailySupply" class="ipt" type="digit" placeholder="如 200（斤）" /></view></view>
          <view class="form-row form-top">
            <view class="fr-l">资质证明</view>
            <view class="fr-r">
              <view class="pic-grid">
                <view v-for="(p, i) in d.qual" :key="i" class="pic">
                  <image :src="fullUrl(p)" mode="aspectFill" class="pic-img" @tap="previewPhotos(d.qual, p)" />
                  <view class="pic-x" @tap.stop="d.qual.splice(i, 1)">✕</view>
                </view>
                <view v-if="d.qual.length < 5" class="pic-add" @tap="addDraftQual(d)">＋</view>
              </view>
              <view class="muted" style="font-size:11px;margin-top:4px;">{{ d.qual.length ? '这条用自己上传的资质' : (sharedQual.length ? '提交时默认带入「本批共用」' + sharedQual.length + ' 张，也可单条单独加' : '营业执照、检疫合格证等（肉类/水产必填，最多 5 张）') }}</view>
            </view>
          </view>

          <view v-if="missingOf(d).length" class="bc-err">{{ missingOf(d).join('、') }} —— 补上即可提交，不影响其他条</view>
          <view v-if="d.submitState === 'fail'" class="bc-err">提交失败：{{ d.submitErr }}（已成功的不受影响，可直接再试）</view>

          <view class="bc-sub">
            <view class="pbtn ghost" @tap="removeDraft(d)">删除这条</view>
            <view class="pbtn ghostg" :class="{ disabled: d.submitState === 'submitting' }" @tap="submitOne(d)">{{ singleBtnText(d) }}</view>
          </view>
        </view>
      </view>

      <view v-if="!drafts.length" class="empty">本批没有草稿，返回上一步重新选图</view>

      <!-- 结果面板（画面4③：全跑完出结果） -->
      <view v-if="phase === 'result'" class="card result-card">
        <view class="result-t">成功 <text class="ok-num">{{ okSubmitCount }}</text> 条 · 失败 <text class="bad-num">{{ failSubmitCount }}</text> 条<template v-if="missCount"> · {{ missCount }} 条待补全未参与</template></view>
        <view class="muted" style="margin-top:4px;">已成功的条目已生成「待审核」申请，<text class="strong">不会回滚</text>；失败的那条留在列表里，补好还能单独再交</view>
        <view class="row-btns" style="margin-bottom:0;">
          <view class="pbtn ghost" @tap="phase = 'review'">回到核对列表</view>
          <view class="pbtn primary" @tap="backToGoods">返回商品列表</view>
        </view>
      </view>

      <!-- 底部固定：全部提交（拍板④：两种提交方式都给） -->
      <view v-if="phase !== 'result'" class="foot-bar">
        <view class="pbtn primary" :class="{ disabled: !okCount || submitting }" @tap="askSubmitAll">全部提交（{{ okCount }} 条）</view>
        <view class="muted foot-hint">待补全的 {{ missCount }} 条不会提交，会留在列表里</view>
      </view>

      <!-- 二次确认弹层（画面4①，文案照原型） -->
      <view v-if="confirmAll" class="mask" @tap="confirmAll = false">
        <view class="sheet" @tap.stop>
          <view class="sheet-title">确认批量提交？</view>
          <view class="sheet-body">
            · 将提交 <text class="strong">{{ okCount }} 条商品</text>，全部走运营审核（和单条提交一样）<br>
            · 待补全的 <text class="strong">{{ missCount }} 条不会提交</text>，会留在列表里<template v-if="sharedQual.length"><br>· 本批共用资质证明 × {{ sharedQual.length }} 张（每条都会带上）</template>
          </view>
          <view class="row-btns" style="margin-bottom:0;">
            <view class="pbtn ghost" @tap="confirmAll = false">再想想</view>
            <view class="pbtn primary" @tap="doSubmitAll">确认提交（{{ okCount }} 条）</view>
          </view>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { supplierApi, unitApi } from '@/api/modules'
import { post, fullUrl } from '@/api/request'
import { pickPhotos, uploadPhoto, previewPhotos, MAX_PHOTOS } from '@/utils/photo-upload'
import { markBatch } from '@/utils/batch-session' // 卡BW-2：提交成功的 applyId 记入「本批」标记（纯内存）

// ── 页内步骤切换：pick（选图+串行处理）→ review（核对+提交）──
const step = ref('pick')
const busy = ref(false) // 串行总闸：上传/识别排队期间为 true（提交另有 submitting）

// ── 授权分类 + 单位（同 goods-manage 口径：getMyCategories / unitApi.listEnabled）──
const cats = ref([])
const units = ref([])

async function loadCats() {
  try {
    cats.value = (await supplierApi.getMyCategories()) || []
  } catch (e) { /* 无授权分类时提交会校验，不阻塞 */ }
}

async function loadUnits() {
  try {
    units.value = (await unitApi.listEnabled()) || []
  } catch (e) { units.value = [] }
}

// 单位 chip 选项（与 goods-manage 的 unitOptionsFor 同口径：当前值不在启用表里就保留并标注停用）
function unitOptionsFor(current) {
  const list = units.value.map((u) => ({ name: u.name, off: false }))
  if (current && !list.some((u) => u.name === current)) list.push({ name: current, off: units.value.length > 0 })
  return list
}

// ── 草稿：一张照片 = 一条 ──
let keySeq = 0
const drafts = ref([])

function newDraft(localPath) {
  const firstUnit = units.value.length ? units.value[0].name : '斤'
  // ⚠️ 必须 reactive() 包装：草稿对象被 push 进数组后，processOne 等逻辑拿引用直接改
  // d.phase / d.form.xxx —— 若是原始对象，改的是 raw target，不触发响应式更新，
  // 页面会永远停在「上传中…」/「已完成 8 / 9」（H5 自测实测踩到，别改回去）
  return reactive({
    key: ++keySeq,
    localPath,
    cover: '', // 上传成功后的 /uploads/xxx（该条照片即封面）
    phase: 'queued', // queued | uploading | recognizing | done | warn | upload_fail
    ai: { name: false, category: false, weigh: false }, // AI 预填的三项（绿底标识，用户一动就撤）
    form: { name: '', categoryId: null, categoryName: '', weighType: 1, unit: firstUnit, supplyPrice: '', dailySupply: '', remark: '' },
    qual: [], // 单条自己的资质证明（传了以单条为准，否则用本批共用）
    qualPicking: false,
    open: false,
    submitState: 'idle', // idle | submitting | ok | fail
    submitErr: '',
  })
}

const remainTotal = computed(() => Math.max(0, MAX_PHOTOS - drafts.value.length))
const doneCount = computed(() => drafts.value.filter((d) => ['done', 'warn', 'upload_fail'].includes(d.phase)).length)

// ── 格子状态文案（对齐原型：上传中…/识别中…/✅ 已填好/⚠️ 没认出来/❌ 上传失败）──
function stText(d) {
  const aiN = ['name', 'category', 'weigh'].filter((k) => d.ai[k]).length
  switch (d.phase) {
    case 'queued': return { t: '排队中', d: '等前一张做完' }
    case 'uploading': return { t: '上传中…', d: '压缩 → 上传' }
    case 'recognizing': return { t: '识别中…', d: '正在认这张' }
    case 'done': return { t: '✅ 已填好', d: aiN ? `AI 已填 ${aiN} 项` : '已就绪' }
    case 'warn': return { t: '⚠️ 没认出来', d: '可手填' }
    case 'upload_fail': return { t: '❌ 上传失败', d: '可重试' }
    default: return { t: '', d: '' }
  }
}
function stCls(d) {
  return { ok: d.phase === 'done', warn: d.phase === 'warn', bad: d.phase === 'upload_fail', busy: d.phase === 'uploading' || d.phase === 'recognizing', q: d.phase === 'queued' }
}

// ── 选图 + 串行处理：一张一张「上传 → 识别」，绝不并发（卡BW-1 禁区④）──
async function addMore() {
  if (busy.value) return
  const remain = remainTotal.value
  if (remain <= 0) {
    uni.showToast({ title: '一次最多 9 张，多的请再发起一批', icon: 'none' })
    return
  }
  let paths
  try {
    paths = await pickPhotos({ count: remain })
  } catch (e) {
    if (e && e.cancelled) return
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
    return
  }
  if (!paths || !paths.length) return
  busy.value = true
  try {
    for (const p of paths) {
      if (drafts.value.length >= MAX_PHOTOS) break
      const d = newDraft(p)
      drafts.value.push(d)
      await processOne(d) // 严格串行：await 完这张才轮到下一张
    }
  } finally {
    busy.value = false
  }
}

// 单张：上传（复用 uploadPhoto，压到 ≤300KB → POST /upload/image）→ AI 识别（同单条链路判定口径）
async function processOne(d) {
  d.phase = 'uploading'
  try {
    d.cover = await uploadPhoto(d.localPath)
  } catch (e) {
    d.phase = 'upload_fail' // request 层已 toast 业务错误，这里只落格子状态
    return
  }
  d.phase = 'recognizing'
  try {
    const res = await post('/ai/supplier/recognize-goods', { image: d.cover })
    // 判定成功照单条链路：parser==='vl' 且 三项至少一项非空
    if (res && res.parser === 'vl' && (res.name || res.categoryId || res.weighType)) {
      if (res.name) { d.form.name = res.name; d.ai.name = true }
      // 分类只从已授权分类里采用（同 goods-manage：cats.some(...)）
      if (res.categoryId && cats.value.some((c) => c.id === res.categoryId)) {
        d.form.categoryId = res.categoryId
        d.form.categoryName = res.categoryName || ''
        d.ai.category = true
      }
      if (res.weighType) { d.form.weighType = res.weighType; d.ai.weigh = true }
      d.phase = 'done'
    } else {
      d.phase = 'warn'
    }
  } catch (e) {
    d.phase = 'warn' // 识别失败/超时不阻断：留空手填（与单条链路同一兜底口径）
  }
}

// 失败格「重试」= 重新上传 + 识别该张（仍走串行闸）
async function retryOne(d) {
  if (busy.value || d.phase !== 'upload_fail') return
  busy.value = true
  try {
    await processOne(d)
  } finally {
    busy.value = false
  }
}

// 再发起一批：本批草稿不持久化（拍板③：离开即清，不写本地缓存）
function resetBatch() {
  if (busy.value) return
  drafts.value = []
  step.value = 'pick'
}

function goReview() {
  if (!drafts.value.length || busy.value) return
  step.value = 'review'
}

// ── 画面3 · 核对列表逻辑 ──
const sharedQual = ref([]) // 本批共用资质证明（/uploads/xxx 数组，≤5）
const sharedQualBusy = ref(false)
const phase = ref('review') // review | result
const confirmAll = ref(false)

function toggleCard(d) {
  if (submitting.value) return
  d.open = !d.open
}

function pickCat(d, c) {
  if (!c) return
  d.form.categoryId = c.id
  d.form.categoryName = c.name
  d.ai.category = false // 用户手选 → 撤 AI 绿底
}

// 缺必填点名（与 goods-manage submit() 同一口径；红字计入「待补全」）
function missingOf(d) {
  const miss = []
  if (!d.form.name) miss.push('请填写商品名称')
  if (!d.form.categoryId) miss.push('请选择商品分类')
  const price = Number(d.form.supplyPrice)
  const supply = Number(d.form.dailySupply)
  if (!price || price <= 0) miss.push('请填写供货价')
  if (isNaN(supply)) miss.push('请填写日可供量')
  return miss
}

// 收起头一行关键值（照原型：供货价 ¥x/单位 · 日供 y单位）
function headLine(d) {
  const price = Number(d.form.supplyPrice)
  const supply = Number(d.form.dailySupply)
  if (!price && !supply) return d.phase === 'warn' ? '还没动过 · 点开手填也一样能提交' : '还没填价格与日供量 · 点开填写'
  return `供货价 ¥${price || '?'}/${d.form.unit} · 日供 ${supply || '?'}${d.form.unit}`
}

function tagCls(d) {
  if (d.submitState === 'ok') return 'g'
  if (d.submitState === 'fail') return 'r'
  if (d.submitState === 'submitting') return 'b'
  return missingOf(d).length ? 'o' : 'g'
}
function tagText(d) {
  if (d.submitState === 'ok') return '✅ 已提交'
  if (d.submitState === 'fail') return '❌ 提交失败'
  if (d.submitState === 'submitting') return '⏳ 提交中…'
  const filled = d.form.name || d.form.categoryId || d.form.supplyPrice || d.form.dailySupply
  if (!filled && d.phase === 'warn') return '⬜ 未填'
  return missingOf(d).length ? '⚠️ 待补全' : '✅ 可提交'
}
function singleBtnText(d) {
  if (d.submitState === 'ok') return '已提交'
  if (d.submitState === 'submitting') return '提交中…'
  return missingOf(d).length ? '补完单独提交' : '单独提交'
}

function removeDraft(d) {
  if (submitting.value) return
  drafts.value = drafts.value.filter((x) => x.key !== d.key)
}

// 汇总条：可提交 / 待补全（已提交成功的不计）
const pendingDrafts = computed(() => drafts.value.filter((d) => d.submitState !== 'ok'))
const okCount = computed(() => pendingDrafts.value.filter((d) => !missingOf(d).length && d.submitState !== 'submitting').length)
const missCount = computed(() => pendingDrafts.value.filter((d) => missingOf(d).length).length)

// ── 资质上传（共用 / 单条）：复用 uploadPhoto，逐张串行 ──
async function addSharedQual() {
  if (sharedQualBusy.value) return
  const remain = 5 - sharedQual.value.length
  if (remain <= 0) { uni.showToast({ title: '资质证明最多 5 张', icon: 'none' }); return }
  let paths
  try { paths = await pickPhotos({ count: remain }) } catch (e) { if (e && e.cancelled) return; return }
  if (!paths || !paths.length) return
  sharedQualBusy.value = true
  try {
    for (const p of paths) sharedQual.value.push(await uploadPhoto(p))
  } catch (e) {
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  } finally {
    sharedQualBusy.value = false
  }
}

async function addDraftQual(d) {
  if (d.qualPicking) return
  const remain = 5 - d.qual.length
  if (remain <= 0) { uni.showToast({ title: '资质证明最多 5 张', icon: 'none' }); return }
  let paths
  try { paths = await pickPhotos({ count: remain }) } catch (e) { if (e && e.cancelled) return; return }
  if (!paths || !paths.length) return
  d.qualPicking = true
  try {
    for (const p of paths) d.qual.push(await uploadPhoto(p))
  } catch (e) {
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  } finally {
    d.qualPicking = false
  }
}

// ── 画面4 · 提交（逐条复用 POST /supplier-goods/apply，串行，不回滚）──
const submitting = ref(false)
const submitTotal = ref(0)
const submittedCount = ref(0)
const okSubmitCount = computed(() => drafts.value.filter((d) => d.submitState === 'ok').length)
const failSubmitCount = computed(() => drafts.value.filter((d) => d.submitState === 'fail').length)

// 拍板②：单条自己传了以单条的为准，否则用本批共用的
function qualOf(d) {
  const list = d.qual.length ? d.qual : sharedQual.value
  return list.length ? list : undefined
}

// 提交体字段（卡BW-1 口径，一项不多）：name/categoryId/weighType/unit/supplyPrice/dailySupply/remark/cover/qualification
function buildBody(d) {
  const remark = (d.form.remark || '').trim()
  return {
    name: d.form.name,
    categoryId: d.form.categoryId,
    weighType: d.form.weighType,
    unit: d.form.unit,
    supplyPrice: Number(d.form.supplyPrice),
    dailySupply: Number(d.form.dailySupply),
    remark: remark || undefined,
    cover: d.cover || undefined,
    qualification: qualOf(d),
  }
}

async function submitOne(d) {
  if (d.submitState === 'submitting' || d.submitState === 'ok') return
  const miss = missingOf(d)
  if (miss.length) { uni.showToast({ title: miss[0], icon: 'none' }); return }
  d.submitState = 'submitting'
  d.submitErr = ''
  try {
    // 卡BW-2：POST /supplier-goods/apply 返回 { applyId, status:'pending' }；成功即记入本批
    const res = await supplierApi.submitGoods(buildBody(d))
    if (res && res.applyId != null) markBatch([res.applyId])
    d.submitState = 'ok'
    uni.showToast({ title: '已提交，等待运营审核', icon: 'none' })
  } catch (e) {
    // request 层已 toast；卡片里原样透出后端原因，不自己造文案
    d.submitState = 'fail'
    d.submitErr = (e && e.msg) || '提交失败，请重试'
  }
}

function askSubmitAll() {
  if (!okCount.value || submitting.value) return
  confirmAll.value = true
}

// 确认后串行逐条提交：失败的不挡后面的；已成功的不回滚（卡BW-1 拍板④/禁区④）
async function doSubmitAll() {
  confirmAll.value = false
  const list = drafts.value.filter((d) => d.submitState !== 'ok' && !missingOf(d).length)
  if (!list.length) return
  submitting.value = true
  submitTotal.value = list.length
  submittedCount.value = 0
  for (const d of list) {
    d.submitState = 'submitting'
    d.submitErr = ''
    try {
      // 卡BW-2：成功一条记一条（Set 累积，重试成功的也会补进去）
      const res = await supplierApi.submitGoods(buildBody(d))
      if (res && res.applyId != null) markBatch([res.applyId])
      d.submitState = 'ok'
    } catch (e) {
      d.submitState = 'fail'
      d.submitErr = (e && e.msg) || '提交失败，请重试'
    }
    submittedCount.value += 1
  }
  submitting.value = false
  phase.value = 'result'
}

// 画面5：回商品列表。redirectTo 重建 goods-manage 页面实例 → onMounted 里 load() 自动重拉，
// 本批条目即出现在「待审核」区（不改 goods-manage 任何代码）
function backToGoods() {
  uni.redirectTo({ url: '/subpkg-supplier/pages/goods-manage' })
}

onMounted(() => {
  loadCats()
  loadUnits()
})
</script>

<style lang="scss" scoped>
/* 沿用 goods-manage 单条表单同款样式值（不改配色与组件样式） */
.form-row { display: flex; align-items: center; padding: 12px 0; font-size: 14px; }
.form-top { align-items: flex-start; }
.fr-l { width: 76px; color: $text-second; flex-shrink: 0; }
.fr-r { flex: 1; margin-left: 12px; min-width: 0; }
.ipt { width: 100%; min-height: 40px; height: 40px; line-height: 40px; text-align: left; font-size: 14px; color: $text-body; }
.muted { color: $text-placeholder; font-size: 12px; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }
.strong { color: $text-title; font-weight: 700; }
.chip-off { color: #C0C4CC; font-size: 10px; margin-left: 1px; }
.ta-remark { min-height: 52px; height: auto; line-height: 1.5; padding: 8px 9px; background: $bg-soft; border-radius: 8px; width: 100%; box-sizing: border-box; }
.remark-meta { display: flex; justify-content: space-between; margin-top: 4px; }
.remark-count { color: #B3B9C2; flex-shrink: 0; margin-left: 8px; }
/* AI 绿底（沿用单条表单 ipt-ai） */
.ipt-ai { border: 1px solid #00B96B; background: #F2FBF7; border-radius: 8px; padding: 0 9px; box-sizing: border-box; }
.ai-flash {
  display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #00995A;
  background: #E6F9F0; border-radius: 8px; padding: 7px 10px; margin-bottom: 6px;
}
/* 次按钮（原型 ghostg：浅绿描边）与禁用态 */
.pbtn.ghostg { background: #E6F9F0; color: $brand-deep; border: 1px solid #B6E4CF; }
.pbtn.disabled { opacity: 0.45; pointer-events: none; }

/* ── 画面2 · 进度网格 ── */
.pick-tip { margin: 0 4px 12px; line-height: 1.6; }
.pick-head { display: flex; justify-content: space-between; align-items: center; }
.done-line { font-size: 11px; color: #9AA1AB; font-weight: 400; }
.bgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.bcell {
  position: relative; border-radius: 9px; overflow: hidden; background: $bg-soft;
  border: 1px solid $border; min-height: 86px; padding: 4px;
}
.bcell.dim { opacity: 0.75; }
.bcell .idx {
  position: absolute; left: 4px; top: 4px; z-index: 2; min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: rgba(17, 17, 17, 0.6); color: #fff; font-size: 10px; line-height: 16px; text-align: center;
}
.bimg { width: 100%; height: 64px; border-radius: 6px; display: block; }
.bcell .spin {
  position: absolute; left: 50%; top: 26px; width: 18px; height: 18px; margin-left: -9px; z-index: 2;
  border-radius: 50%; border: 3px solid rgba(255, 255, 255, 0.6); border-top-color: #00B96B;
  animation: bcell-spin 0.9s linear infinite;
}
@keyframes bcell-spin { to { transform: rotate(360deg); } }
.st { display: flex; flex-direction: column; padding: 3px 2px 0; line-height: 1.35; }
.st-t { font-size: 11px; font-weight: 700; color: $text-title; }
.st-d { font-size: 10px; color: #9AA1AB; }
.st.ok .st-t { color: #00995A; }
.st.warn .st-t { color: #B26A00; }
.st.bad .st-t { color: $danger; }
.st.busy .st-t, .st.q .st-t { color: $text-second; }
.rebtn {
  margin: 4px 2px 2px; text-align: center; font-size: 11px; font-weight: 600;
  color: $brand-deep; background: #E6F9F0; border: 1px solid #B6E4CF; border-radius: 6px; padding: 3px 0;
}

/* ── 画面3 · 汇总条 + 草稿卡 ── */
.sumbar {
  display: flex; align-items: center; gap: 4px; background: $bg-card; border-radius: $radius-lg;
  padding: 10px 12px; margin-bottom: 10px; font-size: 13px; color: $text-second;
  box-shadow: $shadow-card; flex-wrap: wrap;
}
.sumbar .n { color: #00995A; font-weight: 600; }
.sumbar .w { color: #B26A00; font-weight: 600; }
.sumbar .prog { margin-left: auto; font-size: 11px; color: $info; }
.bcard {
  background: $bg-card; border-radius: $radius-lg; padding: 10px 12px; margin-bottom: 10px;
  box-shadow: $shadow-card;
}
.bc-head { display: flex; align-items: center; }
.bc-thumb { width: 40px; height: 40px; border-radius: 9px; flex-shrink: 0; margin-right: 10px; position: relative; }
.bc-thumb-img { width: 40px; height: 40px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.bc-thumb-empty { background: $bg-soft; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.bc-head .li-t { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.bc-head .tag { flex-shrink: 0; }
.bc-head .li-d { font-size: 12px; }
.bc-caret { color: #9AA1AB; font-size: 12px; margin-left: 8px; flex-shrink: 0; }
.bc-miss { font-size: 11px; color: $danger; margin-top: 2px; }
.bc-body { border-top: 1px solid $border; margin-top: 10px; padding-top: 4px; }
.bc-err { font-size: 12px; color: $danger; background: $danger-soft; border-radius: 8px; padding: 7px 10px; margin-top: 6px; }
.bc-sub { display: flex; gap: 10px; margin-top: 10px; }
/* 资质缩略图网格（同 goods-manage） */
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

/* ── 画面4 · 底部固定 + 确认弹层 + 结果面板 ── */
.page-batch { padding-bottom: 220rpx; }
.foot-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
  background: #fff; border-top: 1px solid #EEF1F4;
  padding: 16rpx 24rpx calc(20rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -8rpx 28rpx rgba(0, 0, 0, 0.05);
}
.foot-hint { text-align: center; margin-top: 6rpx; }
.mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: flex-end; z-index: 99;
}
.sheet {
  width: 100%; background: #fff; border-radius: 24rpx 24rpx 0 0;
  padding: 28rpx 32rpx calc(28rpx + env(safe-area-inset-bottom));
}
.sheet-title { font-size: 30rpx; font-weight: 700; color: $text-title; margin-bottom: 14rpx; }
.sheet-body { font-size: 25rpx; color: $text-second; line-height: 1.7; margin-bottom: 24rpx; }
.result-card { text-align: center; padding: 18px 12px 14px; }
.result-t { font-size: 17px; font-weight: 800; color: $text-title; }
.ok-num { color: #00B578; }
.bad-num { color: $danger; }
</style>
