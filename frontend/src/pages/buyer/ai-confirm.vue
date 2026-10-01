<template>
  <view class="aic-page" v-if="draft">
    <view class="notice">🤖 本单由 AI 识别生成，请核对商品与数量——可直接调整数量、删除商品，确认后正式下单</view>

    <!-- 商品清单 -->
    <view class="card list-card">
      <view v-for="(it, i) in items" :key="i" class="cart-row">
        <view class="c-img">{{ emojiOf(it.name) }}</view>
        <view class="c-main">
          <view class="c-t">{{ it.name }}</view>
          <view class="c-s">{{ specText(it) }}</view>
          <view class="c-p">¥{{ (it.qty * it.price).toFixed(2) }}</view>
        </view>
        <view class="c-right">
          <view class="ai-del" @tap="remove(i)">✕</view>
          <view class="stepper">
            <view class="st-btn" @tap="change(i, -1)">−</view>
            <view class="st-val">{{ it.qty }}</view>
            <view class="st-btn" @tap="change(i, 1)">+</view>
          </view>
        </view>
      </view>
      <view v-if="!items.length" class="empty-tip">暂未选择商品</view>
    </view>

    <!-- 添加商品 -->
    <view class="add-row">
      <view class="add-btn" @tap="openPicker">＋ 添加商品</view>
    </view>

    <!-- 配送信息 -->
    <view class="card">
      <view class="form-row">
        <view class="fr-l">配送日期</view>
        <view class="chip-group">
          <view v-for="d in dateOptions" :key="d.value" :class="['chip', { on: deliveryDate === d.value }]" @tap="deliveryDate = d.value">{{ d.label }}</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">送达时段</view>
        <view class="chip-group">
          <view v-for="w in winOptions" :key="w.value" :class="['chip', { on: timeWindow === w.value }]" @tap="timeWindow = w.value">{{ w.label }}</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">收货地址</view>
        <view class="fr-r">{{ address || '未设置收货地址' }}</view>
      </view>
      <view class="form-row">
        <view class="fr-l">备注</view>
        <input class="ipt" v-model="remark" placeholder="选填" />
      </view>
    </view>

    <view class="notice">⚖️ 称重商品按验收实际重量结算，多退少补</view>

    <!-- 底部合计 + 确认 -->
    <view class="action-bar">
      <view class="ab-total">共 {{ items.length }} 项 · 预估合计 <b>¥{{ total.toFixed(2) }}</b></view>
      <view class="pbtn primary" :class="{ disabled: !items.length || submitting }" @tap="submit">确认下单</view>
    </view>

    <!-- 添加商品弹层（页内选品，不切页、不丢草稿） -->
    <view v-if="pickerOpen" class="pk-mask" @tap="closePicker">
      <view class="pk-sheet" @tap.stop>
        <view class="pk-head">
          <text class="pk-title">添加商品</text>
          <view class="pk-close" @tap="closePicker">✕</view>
        </view>

        <view class="pk-search">
          <input class="pk-input" v-model="pkKeyword" placeholder="搜索商品" confirm-type="search" @confirm="loadPkGoods" />
          <view class="pk-search-btn" @tap="loadPkGoods">搜索</view>
        </view>

        <view class="pk-body">
          <scroll-view scroll-y class="pk-cate">
            <view :class="['pk-cate-item', { on: pkCate === 0 }]" @tap="switchPkCate(0)">全部</view>
            <view v-for="c in categories" :key="c.id" :class="['pk-cate-item', { on: pkCate === c.id }]" @tap="switchPkCate(c.id)">{{ c.name }}</view>
          </scroll-view>

          <scroll-view scroll-y class="pk-list">
            <view v-for="g in pickerGoods" :key="g.id" class="pk-row">
              <view class="pk-info">
                <view class="pk-name">{{ g.name }}</view>
                <view class="pk-spec">{{ g.specText || (g.weighType === 1 ? '称重' : '固定规格') }}</view>
                <view class="pk-price">¥{{ g.salePrice }}/{{ g.unit }}</view>
              </view>
              <view v-if="qtyOf(g.id)" class="pk-stepper">
                <view class="st-btn" @tap="decProduct(g)">−</view>
                <text class="pk-qty">{{ qtyOf(g.id) }}</text>
                <view class="st-btn" @tap="addProduct(g)">＋</view>
              </view>
              <view v-else class="pk-add" @tap="addProduct(g)">＋</view>
            </view>
            <view v-if="pkLoading" class="empty-tip">加载中…</view>
            <view v-else-if="!pickerGoods.length" class="empty-tip">暂无商品</view>
          </scroll-view>
        </view>

        <view class="pk-foot">
          <text class="pk-foot-txt">已选 {{ items.length }} 项 · 预估 ¥{{ total.toFixed(2) }}</text>
          <view class="pbtn primary" @tap="closePicker">完成</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi, authApi } from '@/api/modules'
import { dateStr, availableTimeWindows } from '@/utils/time-window'
import { clearDraft } from '@/utils/ai-draft'
import { clearMeta, deliveryMeta, syncCartDraft } from '@/utils/ai-draft'
// 卡AQ：确认页也补上「运营停用」拦截（红线 8 列了这项；本页此前没有，纯新增不删任何旧逻辑）
import { guardBuyerSuspended } from '@/utils/account-guard'

const draft = ref(null)
const items = ref([])
const deliveryDate = ref('')
const timeWindow = ref(2)
const remark = ref('')
const address = ref('')
const submitting = ref(false)

const emojiOf = (name) => {
  const map = [['白菜','🥬'],['菜','🥬'],['土豆','🥔'],['肉','🥩'],['姜','🫚'],['葱','🌿'],['蛋','🥚'],['鸡','🍗'],['鱼','🐟'],['米','🌾']]
  for (const [k, e] of map) if (name.includes(k)) return e
  return '🥬'
}
const specText = (it) => {
  const weigh = it.weighType === 1 ? '称重' : '固定规格'
  const spec = it.specText ? ` · ${it.specText}` : ''
  return `${weigh} · ¥${it.price}/${it.unit}${spec}`
}

// ══════════════════════════════════════════════════════════════════
// 卡AQ（2026-10-01）：草稿真身搬到服务端 cart_item —— 确认页以 `GET /cart` 为准
//
// ⚠️ 下面那段老的 onLoad（读 storage `aiDraft`）**一行没删**，理由有二：
//   ① `kefu.vue` 已上生产、本卡零改动，它的「去结算」仍是把草稿写进那份 storage 递过来的；
//   ② 老 onLoad 的判空分支（`!draft.value` → toast + navigateBack）依赖那份 storage 非空。
//   所以这里**在它之前**再注册一个 onLoad：先起服务端请求，回来后整体覆盖 items 与三字段。
//   两个 onLoad 都会跑，后完成的（服务端）覆盖先完成的（storage 镜像）——服务端是最终口径。
// ══════════════════════════════════════════════════════════════════
onLoad(async () => {
  // 卡AQ：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  try {
    const data = await buyerApi.getCart()
    const list = data.list || []
    // 服务端草稿是空的 → 什么都不覆盖，交给老那段判空逻辑（它会 toast 并返回）
    if (!list.length) return

    // 与 cart.vue 同一份换算：cart 出参的 salePrice 就是草稿行的 price
    items.value = list.map((it) => ({
      productId: it.productId,
      name: it.name,
      unit: it.unit,
      specText: it.specText || '',
      weighType: it.weighType,
      qty: Number(it.qty),
      price: Number(it.salePrice),
    }))
    draft.value = { ...(draft.value || {}), items: items.value.map((it) => ({ ...it })) }

    // 三字段（配送日期 / 送达时段 / 备注）＝ 草稿页那份前端 ref，不落服务端表
    const meta = deliveryMeta.value || {}
    deliveryDate.value = meta.deliveryDate || draft.value.deliveryDate || dateStr(new Date(Date.now() + 86400000))
    remark.value = meta.remark || draft.value.remark || ''
    const win = availableTimeWindows(deliveryDate.value)
    timeWindow.value = meta.timeWindow && win.some((w) => w.value === meta.timeWindow)
      ? meta.timeWindow
      : (win.length ? win[0].value : 2)
  } catch (e) {
    /* 拿不到服务端草稿就退回老路径（storage 镜像），错误已由 request.js 统一提示 */
  }
})

const dateOptions = [
  { value: dateStr(), label: `今天 ${dateStr().slice(5)}` },
  { value: dateStr(new Date(Date.now() + 86400000)), label: `明天 ${dateStr(new Date(Date.now() + 86400000)).slice(5)}` },
  { value: dateStr(new Date(Date.now() + 2 * 86400000)), label: `后天 ${dateStr(new Date(Date.now() + 2 * 86400000)).slice(5)}` },
]
const winOptions = computed(() => availableTimeWindows(deliveryDate.value))

const total = computed(() => items.value.reduce((s, it) => s + it.qty * it.price, 0))

const change = (i, delta) => {
  const next = items.value[i].qty + delta
  if (next < 1) return
  items.value[i].qty = Math.round(next * 10) / 10
  syncDraft()
}
const remove = (i) => { items.value.splice(i, 1); syncDraft() }

// 草稿回写：数量/新增/删除改动同步到本地草稿，避免页面重载丢失
const syncDraft = () => {
  try {
    uni.setStorageSync('aiDraft', { ...(draft.value || {}), items: items.value.map((it) => ({ ...it })) })
  } catch (e) { /* 忽略 */ }
}

// ── 添加商品弹层（页内选品：原实现 switchTab 跳商品页，会丢掉 AI 草稿） ──
const pickerOpen = ref(false)
const categories = ref([])
const pickerGoods = ref([])
const pkCate = ref(0)
const pkKeyword = ref('')
const pkLoading = ref(false)

const qtyOf = (id) => items.value.find((it) => it.productId === id)?.qty || 0

const addProduct = (g) => {
  const hit = items.value.find((it) => it.productId === g.id)
  if (hit) hit.qty = Math.round(hit.qty * 10 + 10) / 10
  else items.value.push({ productId: g.id, name: g.name, unit: g.unit, specText: g.specText, weighType: g.weighType, qty: 1, price: g.salePrice })
  syncDraft()
}

const decProduct = (g) => {
  const i = items.value.findIndex((it) => it.productId === g.id)
  if (i < 0) return
  const next = Math.round(items.value[i].qty * 10 - 10) / 10
  if (next < 1) items.value.splice(i, 1)
  else items.value[i].qty = next
  syncDraft()
}

const loadPkGoods = async () => {
  pkLoading.value = true
  // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成字符串 "undefined"，导致后端误当搜索词
  const params = { page: 1, pageSize: 50 }
  if (pkCate.value) params.categoryId = pkCate.value
  if (pkKeyword.value) params.keyword = pkKeyword.value
  try {
    const data = await buyerApi.getGoods(params)
    pickerGoods.value = data.list || []
  } catch (e) {
    pickerGoods.value = []
  }
  pkLoading.value = false
}

const switchPkCate = (id) => { pkCate.value = id; loadPkGoods() }

const openPicker = async () => {
  pickerOpen.value = true
  if (!categories.value.length) {
    try { categories.value = await buyerApi.getCategories() } catch (e) { categories.value = [] }
  }
  if (!pickerGoods.value.length) loadPkGoods()
}

const closePicker = () => { pickerOpen.value = false }

const submit = async () => {
  if (!items.value.length || submitting.value) return
  submitting.value = true
  try {
    const order = await buyerApi.placeOrder({
      deliveryDate: deliveryDate.value,
      timeWindow: timeWindow.value,
      remark: remark.value || undefined,
      items: items.value.map((it) => ({ productId: it.productId, qty: it.qty })),
      source: 2, // 2=AI 客服代下单（普通自选下单路径不传，后端默认 1）
    })
    uni.removeStorageSync('aiDraft')
    // 卡AN（2026-09-30）：共享草稿一并清空 —— 否则下单后退回去，右下角 FAB 角标还挂着数字，
    // 客户会以为草稿还在（这份 storage 与共享草稿是两条线，必须都清）
    clearDraft()
    // 卡AQ（2026-10-01）：草稿真身在服务端 cart_item —— 下单成功后也要整体清空，
    // 否则回到草稿页会看到刚下完单的菜还在（走 /cart/sync 空数组，与 AI 说话同一个写口）。
    // ⚠️ 清空失败**不拦跳转**：订单已经成立了，别让客户卡在确认页。
    try {
      await syncCartDraft([])
      clearMeta()
    } catch (e) {
      /* 忽略：订单已成立，回草稿页会再拉一次服务端真值 */
    }
    uni.redirectTo({ url: `/pages/buyer/order-detail?id=${order.orderId}` })
  } catch (e) {
    // 错误已由 request.js 统一提示
  } finally {
    submitting.value = false
  }
}

onLoad(async () => {
  draft.value = uni.getStorageSync('aiDraft') || null
  if (!draft.value) {
    uni.showToast({ title: '未找到订单草稿', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 800)
    return
  }
  items.value = (draft.value.items || []).map((it) => ({ ...it }))
  deliveryDate.value = draft.value.deliveryDate || dateStr(new Date(Date.now() + 86400000))
  remark.value = draft.value.remark || ''
  const win = availableTimeWindows(deliveryDate.value)
  timeWindow.value = win.length ? win[0].value : 2
  try {
    const profile = await authApi.getProfile()
    address.value = profile?.purchaser?.address || ''
  } catch (e) { /* 忽略 */ }
})
</script>

<style lang="scss" scoped>
.aic-page { padding-bottom: 70px; }
.notice { background: $warn-soft; color: $warn; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 10px 12px; }
.card { background: $bg-card; border-radius: 12px; margin: 6px 12px; padding: 4px 12px; }
.list-card { padding: 4px 10px; }
.cart-row { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid $bg-soft; }
.cart-row:last-child { border-bottom: none; }
.c-img { width: 46px; height: 46px; border-radius: 10px; background: $bg-soft; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
.c-main { flex: 1; min-width: 0; }
.c-t { font-size: 13px; font-weight: 600; color: $text-title; }
.c-s { font-size: 10px; color: $text-second; margin-top: 2px; }
.c-p { font-size: 13px; color: $danger; font-weight: 700; margin-top: 3px; }
.c-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.ai-del { color: $text-disabled; font-size: 15px; padding: 0 4px; }
.stepper { display: flex; align-items: center; gap: 8px; }
.st-btn { width: 26px; height: 26px; border-radius: 8px; border: 1px solid $border-strong; background: #fff; font-size: 16px; color: $text-body; display: flex; align-items: center; justify-content: center; }
.st-val { min-width: 40px; text-align: center; font-size: 14px; font-weight: 700; color: $text-title; }
.empty-tip { text-align: center; color: $text-placeholder; padding: 24px 0; font-size: 13px; }

.add-row { padding: 4px 12px; }
.add-btn { text-align: center; padding: 11px 0; border-radius: 10px; border: 1.5px solid $brand; color: $brand; font-size: 13px; font-weight: 600; background: #fff; }

.form-row { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid $bg-soft; }
.form-row:last-child { border-bottom: none; }
.fr-l { width: 72px; font-size: 13px; color: $text-second; flex-shrink: 0; }
.fr-r { flex: 1; font-size: 13px; color: $text-body; }
.ipt { flex: 1; font-size: 13px; }
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 12px; border-radius: 16px; border: 1.5px solid $border-strong; font-size: 12px; color: $text-body; background: #fff; }
.chip.on { background: $brand-soft; border-color: $brand; color: $brand; font-weight: 600; }

.action-bar { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; border-top: 1px solid $border; padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
.ab-total { flex: 1; font-size: 12px; color: $text-second; }
.ab-total b { font-size: 17px; color: $danger; }
.pbtn { flex: none; border-radius: 10px; padding: 11px 24px; text-align: center; font-size: 14px; font-weight: 600; }
.pbtn.primary { background: $brand; color: #fff; }
.pbtn.disabled { opacity: 0.5; }

/* ── 添加商品弹层 ── */
.pk-mask { position: fixed; top: 0; right: 0; bottom: 0; left: 0; background: rgba(0, 0, 0, 0.45); z-index: 90; display: flex; align-items: flex-end; }
.pk-sheet { width: 100%; height: 78vh; background: #fff; border-radius: 14px 14px 0 0; display: flex; flex-direction: column; overflow: hidden; }
.pk-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid $bg-soft; }
.pk-title { font-size: 15px; font-weight: 700; color: $text-title; }
.pk-close { display: inline; color: $text-placeholder; font-size: 16px; padding: 0 4px; }
.pk-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; }
.pk-input { flex: 1; background: $bg-soft; border-radius: 16px; padding: 7px 14px; font-size: 13px; }
.pk-search-btn { display: inline; font-size: 13px; color: $brand; font-weight: 600; flex-shrink: 0; }
.pk-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
.pk-cate { width: 84px; background: #f7f8fa; height: 100%; flex-shrink: 0; }
.pk-cate-item { padding: 12px 6px; font-size: 12px; color: $text-second; text-align: center; }
.pk-cate-item.on { background: #fff; color: $brand; font-weight: 700; }
.pk-list { flex: 1; min-width: 0; height: 100%; padding: 6px 12px; box-sizing: border-box; }
.pk-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid $bg-soft; }
.pk-info { flex: 1; min-width: 0; }
.pk-name { font-size: 13px; font-weight: 600; color: $text-title; }
.pk-spec { font-size: 10px; color: $text-second; margin-top: 2px; overflow: hidden; white-space: nowrap; }
.pk-price { font-size: 12px; color: $danger; font-weight: 700; margin-top: 2px; }
.pk-stepper { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.pk-qty { min-width: 34px; text-align: center; font-size: 13px; font-weight: 700; color: $text-title; }
.pk-add { width: 26px; height: 26px; border-radius: 50%; background: $brand; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.pk-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid $border; }
.pk-foot-txt { flex: 1; font-size: 12px; color: $text-second; }
</style>
