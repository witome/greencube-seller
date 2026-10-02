<template>
  <view class="page goods-page">
    <!-- 搜索栏 -->
    <view class="search-card">
      <view class="search-bar">
        <input v-model="keyword" placeholder="搜索蔬菜、肉类、水产…" confirm-type="search" @confirm="loadGoods" />
      </view>
    </view>

    <view class="goods-body">
      <!-- 分类侧栏 -->
      <scroll-view scroll-y class="cate-side">
        <view :class="['cate-item', { on: activeCate === 0 }]" @tap="switchCate(0)">全部</view>
        <view
          v-for="c in categories"
          :key="c.id"
          :class="['cate-item', { on: c.id === activeCate }]"
          @tap="switchCate(c.id)"
        >{{ c.name }}</view>
      </scroll-view>

      <!-- 商品流 -->
      <scroll-view scroll-y class="goods-list" :style="{ paddingBottom: barVisible ? '122px' : '70px' }" @scrolltolower="loadMore">
        <view v-for="g in goodsList" :key="g.id" class="goods-card" @tap="goDetail(g.id)">
          <!-- 卡Z1：有封面显真图，无封面回退首字占位（不许白块/破图） -->
          <view class="gc-cover">
            <image v-if="g.cover" :src="fullUrl(g.cover)" mode="aspectFill" class="gc-cover-img" />
            <text v-else>{{ g.name.slice(0, 1) }}</text>
          </view>
          <view class="gc-main">
            <view class="gc-name">{{ g.name }}</view>
            <!-- 卡BP（2026-10-02）：名称下灰字位 = 主供货商备注优先；无备注回退规格/称重（原逻辑） -->
            <view class="gc-spec">{{ g.remark || g.specText || (g.weighType === 1 ? '称重' : '固定规格') }}</view>
            <view class="gc-bottom">
              <!-- 卡AA：价格按审核状态脱敏 —— 不可见时 ¥** + 灰字引导注册，点价格区跳注册页 -->
              <view v-if="g.priceVisible === false" class="gc-price-mask" @tap.stop="goRegister">
                <text class="gc-price">¥**</text>
                <text class="gc-mask-tip">注册审核通过后可见价格</text>
              </view>
              <template v-else>
                <text class="gc-price">¥{{ g.salePrice }}</text>
                <text class="gc-unit">/{{ g.unit }}</text>
              </template>
              <!-- 未选：＋按钮；已选：步进器（可加减/输入数字） -->
              <view v-if="!cartMap[g.id]" class="gc-add" @tap.stop="increase(g)">＋</view>
              <view v-else class="stepper" @tap.stop>
                <!-- 卡AY：给 −/＋ 各加一个区分性 class（样式仍走 .st-btn，视觉零变化）——
                     自测时才能精确点其中一个（automator 按选择器只命中第一个匹配元素） -->
                <view class="st-btn st-minus" @tap.stop="decrease(g)">−</view>
                <input class="st-input" type="number" :value="cartMap[g.id]" @input="onQtyInput(g, $event)" />
                <view class="st-btn st-plus" @tap.stop="increase(g)">＋</view>
              </view>
            </view>
          </view>
        </view>
        <view v-if="loading" class="empty">加载中…</view>
        <view v-else-if="loadError" class="empty load-error" @tap="retryLoadGoods">
          <view>{{ loadError }}</view>
          <view class="retry-btn">点击重试</view>
        </view>
        <view v-else-if="!goodsList.length" class="empty">暂无商品</view>
      </scroll-view>
    </view>

    <!-- 底部结算栏：有选中商品、或有未提交改动（含「减到 0」要删掉的行）时显示 -->
    <view v-if="barVisible" class="cart-bar">
      <view class="cb-left">
        <view class="cb-count">已选 {{ selectedCount }} 件</view>
        <view class="cb-total">合计 <text class="cb-price">¥{{ totalAmount }}</text></view>
      </view>
      <view class="cb-btns">
        <view class="cb-btn ghost" @tap="addAllToCart">加入草稿</view>
        <view class="cb-btn primary" @tap="buyAll">立即下单</view>
      </view>
    </view>

    <BuyerTabBar active="/pages/buyer/goods" />
    <AiOrderFab :offset="136" />
  </view>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'
import { guardBuyerSuspended } from '@/utils/account-guard'
import BuyerTabBar from '@/components/BuyerTabBar.vue'
import AiOrderFab from '@/components/AiOrderFab.vue'

const categories = ref([])
const goodsList = ref([])
const activeCate = ref(0) // 0 = 全部
const keyword = ref('')
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadError = ref('')

/**
 * 已选商品：productId -> 数量。
 *
 * 🔒 卡AY（2026-10-01）口径变更：**列表 = 服务端草稿的镜像，服务端是唯一真源**。
 *   以前它是纯本地「本次选择」态 —— 从不读服务端、提交后还被清空，
 *   于是列表完全不认识已经加进草稿的商品（草稿里 黄瓜×5，列表上还是「未加入」的 ＋）。
 *   现在：进页 / 切回来 / FAB 说完话都重新 `GET /cart` 整份回填（见 `syncFromServer`），
 *   页内 ± / 手输仍然只改本地（保持「攒一批再提交」的手感，绝不每点一下打一次接口）。
 */
const cartMap = reactive({})

/**
 * 服务端草稿快照：productId -> { cartItemId, qty }（最近一次 `GET /cart` 的真值）。
 * `cartItemId` 是「加入草稿」时按行分别提交的关键：
 *   · 有它 → 这行已在草稿里 → 用 `PUT /cart/:id`（**覆盖**为目标数量，0 = 删除）；
 *   · 没有 → 是新行 → 用 `POST /cart`（新增）。
 * ⚠️ 绝不能对新老行一律用 `POST /cart`：后端 add 是 `qty: { increment }` 累加，
 *    已存在的行会被重复累加（草稿 5 → 点一下 ＋ → 提交完变 11）。
 */
const serverCart = reactive({})

const go = (url) => uni.navigateTo({ url })

const selectedCount = computed(() => Object.values(cartMap).filter((q) => Number(q) > 0).length)

/**
 * 有没有「已改但还没提交」的行（含**减到 0 = 要删掉**的行）。
 * ⚠️ 结算栏的显示条件必须是「有选中 **或** 有未提交改动」：
 *    草稿里本来有一条、用户把它一路减到 0 时 `selectedCount` 归零 ——
 *    若只按 selectedCount 显示，结算栏会在**删除还没提交**时先消失，
 *    这次删除就永远送不到服务端（返回本页又被回填回来，表现为「删不掉」）。
 */
const dirtyCount = computed(
  () => Object.keys(serverCart).filter((k) => Number(cartMap[k] || 0) !== Number(serverCart[k].qty)).length,
)
const barVisible = computed(() => selectedCount.value > 0 || dirtyCount.value > 0)
const totalAmount = computed(() => {
  return Object.entries(cartMap).reduce((s, [id, qty]) => {
    const g = goodsList.value.find((x) => x.id === Number(id))
    return s + (g && Number(qty) > 0 ? g.salePrice * Number(qty) : 0)
  }, 0).toFixed(2)
})

/**
 * 用服务端清单**整份覆盖**本地镜像（不做合并 —— 合并只有服务端一处）。
 * 两个 map 一起重建：`cartMap` 管页面显示，`serverCart` 管提交时认路。
 */
function applyServerList(list) {
  Object.keys(cartMap).forEach((k) => delete cartMap[k])
  Object.keys(serverCart).forEach((k) => delete serverCart[k])
  ;(list || []).forEach((it) => {
    const k = String(it.productId)
    const qty = Number(it.qty) || 0
    serverCart[k] = { cartItemId: it.cartItemId, qty }
    if (qty > 0) cartMap[k] = qty
  })
}

/**
 * 拉服务端草稿回填本地（卡AY 的「唯一真源」通道）。
 * ⚠️ 失败必须兜住：草稿拉不到**不许**影响商品列表本身（与 `loadGoods` 一个兜底风格）。
 * @returns {Promise<boolean>} 是否拉到了（false = 本次失败，本地镜像保持原样）
 */
const syncFromServer = async () => {
  try {
    const data = await buyerApi.getCart()
    applyServerList(data && data.list)
    return true
  } catch (e) {
    return false
  }
}

// ── 步进器 ──
const increase = (g) => {
  cartMap[g.id] = (cartMap[g.id] || 0) + 1
}
const decrease = (g) => {
  const qty = (cartMap[g.id] || 0) - 1
  if (qty <= 0) delete cartMap[g.id]
  else cartMap[g.id] = qty
}
const onQtyInput = (g, e) => {
  const val = Number(e.detail.value)
  if (val > 0) cartMap[g.id] = val
  else delete cartMap[g.id]
}

// ── 统一加购 / 立即下单 ──
const submitting = ref(false)

/**
 * 「加入草稿」：按行分别提交（卡AY 的核心）。
 *
 *   · **草稿里已有的行**（serverCart 里有 cartItemId）→ `PUT /cart/:id`（覆盖为目标数量；
 *     目标 0 = 该行从草稿删除，后端 update 的 qty=0 就是这个语义）；
 *   · **草稿里没有的新行** → `POST /cart`（新增，累加语义无害，因为它本来就不存在）；
 *   · 数量与服务端一致的行**跳过**（进页回填出来的行没被碰过就别白打一次接口）；
 *   · 单行失败不中断其余行（request.js 已统一 toast），最后统一回读一次真值。
 *
 * ⚠️ 提交完成后**重新 GET /cart 回填**，**不再清空** cartMap ——
 *    清空正是「刚加进草稿的商品，在列表上立刻又变回 ＋」的直接原因。
 */
const addAllToCart = async () => {
  if (submitting.value) return
  submitting.value = true
  let ok = true
  try {
    const ids = Array.from(new Set([...Object.keys(serverCart), ...Object.keys(cartMap)]))
    for (const k of ids) {
      const target = Number(cartMap[k] || 0)
      const srv = serverCart[k]
      try {
        if (srv) {
          if (target === Number(srv.qty)) continue // 没动过：不打接口
          await buyerApi.updateCart(srv.cartItemId, target)
        } else {
          if (target <= 0) continue
          await buyerApi.addToCart({ productId: Number(k), qty: target })
        }
      } catch (e) {
        ok = false // 单行失败不中断其余行
      }
    }
  } finally {
    // 以服务端最新真值回填（不再清空），列表上的步进器继续显示草稿里的真实数量
    await syncFromServer()
    submitting.value = false
    uni.$emit('cart-badge-refresh')
    if (ok) uni.showToast({ title: '已加入草稿', icon: 'success' })
  }
}

const buyAll = async () => {
  // 卡AY：结算栏现在也会为「有未提交改动（如减到 0 待删除）」而显示，
  //   此时「已选」可能为 0 —— 空 items 直接下单会被后端判参数错，先拦住。
  if (!selectedCount.value) {
    uni.showToast({ title: '请先选择商品', icon: 'none' })
    return
  }
  // 配送日期：当天有可选时段用当天，否则顺延次日；自动选最早可用时段（不弹窗）
  let deliveryDate = dateStr()
  let winList = availableTimeWindows(deliveryDate)
  if (!winList.length) {
    deliveryDate = tomorrowStr()
    winList = availableTimeWindows(deliveryDate)
  }
  const w = winList[0]
  const items = Object.entries(cartMap).map(([productId, qty]) => ({ productId: Number(productId), qty }))
  const order = await buyerApi.placeOrder({ deliveryDate, timeWindow: w.value, items })
  uni.showToast({ title: '下单成功', icon: 'success' })
  Object.keys(cartMap).forEach((k) => delete cartMap[k])
  setTimeout(() => uni.navigateTo({ url: `/pages/buyer/order-detail?id=${order.orderId}` }), 600)
}

// ── 商品加载 ──
const loadCategories = async () => {
  try {
    categories.value = await buyerApi.getCategories()
  } catch (e) {
    categories.value = [] // 分类拉取失败不阻塞商品列表
  }
}

const loadGoods = async (reset = true) => {
  if (reset) { page.value = 1; goodsList.value = [] }
  loading.value = true
  loadError.value = ''
  try {
    // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成字符串 "undefined"，导致后端误当搜索词
    const params = { page: page.value, pageSize: 20 }
    if (activeCate.value) params.categoryId = activeCate.value
    if (keyword.value) params.keyword = keyword.value
    const data = await buyerApi.getGoods(params)
    goodsList.value = reset ? data.list : [...goodsList.value, ...data.list]
    total.value = data.total
  } catch (e) {
    // ⚠️ 必须在这里兜住：否则 loading 永远为 true，页面永久停在「加载中」，
    //    且网络恢复后不会自愈、也没有重试入口，只能整页刷新
    if (goodsList.value.length) uni.showToast({ title: '加载失败，请稍后重试', icon: 'none' })
    else loadError.value = '商品加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

const retryLoadGoods = () => loadGoods()

const loadMore = () => {
  if (goodsList.value.length >= total.value || loading.value) return
  page.value++
  loadGoods(false)
}

const switchCate = (id) => { activeCate.value = id; loadGoods() }
const goDetail = (id) => go(`/pages/buyer/goods-detail?id=${id}`)
// 卡AA：价格不可见时点价格区 → 注册页
const goRegister = () => go('/pages/buyer/register')

/**
 * 卡AY（2026-10-01）：FAB 说完话 → 本页**重拉服务端草稿**回填。
 *
 * 与本页自己的提交不同，AI 说话走的是 `PUT /cart/sync`（整份替换），写完之后
 * 本页的 `cartMap` 完全不知情 —— 必须靠这条事件通道把列表拉回服务端真值。
 * ⚠️ 只监听 `ai-draft-synced`，**不监听** `cart-badge-refresh`：
 *   ① 本页提交成功后自己就在 finally 里回读过一次真值，再监听它等于每次提交多拉一次；
 *   ② 别的页（草稿页 cart.vue、商品详情 goods-detail.vue）改完草稿后回到本页，
 *      `onShow` 一定会回填一次 —— 已被覆盖，监听是重复请求；
 *   ③ `cart-badge-refresh` 语义是「角标该刷新了」（tabBar 用），拿它当草稿刷新源会重复。
 *      ⇒ 两条通道（onShow + ai-draft-synced）已覆盖全部入口，**不许出现「改了草稿列表不更新」**。
 * ⚠️ `visible`：页面不在前台时不拉（回前台 onShow 会整体回填一次，不会漏）。
 */
const visible = ref(false)
const onDraftSynced = async () => {
  if (!visible.value) return
  await syncFromServer()
}

onMounted(() => { loadCategories(); loadGoods() })
// ⚠️ 注册一次即可；页面反复进出会重复注册 → 一次事件触发 N 遍回读，故 onUnload 配对 $off
uni.$on('ai-draft-synced', onDraftSynced)
onUnload(() => {
  visible.value = false
  uni.$off('ai-draft-synced', onDraftSynced)
})
onHide(() => { visible.value = false })

onShow(async () => {
  visible.value = true
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  // 上次加载失败（如后端不可达）时，回到本页自动补一次，避免一直卡在「加载中」
  if (loadError.value && !loading.value) loadGoods()
  // 卡AY：进页 / 从别的页（草稿页、商品详情、下单页…）切回来 → 以服务端草稿为准回填
  await syncFromServer()
})
</script>

<style lang="scss" scoped>
.goods-page { display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
.search-card { padding: 8px 12px; flex-shrink: 0; }
.search-bar input { background: $bg-soft; border-radius: $radius-round; padding: 8px 14px; font-size: 13px; }
.goods-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
.cate-side { width: 88px; background: #f7f8fa; height: 100%; flex-shrink: 0; }
.cate-item { padding: 14px 8px; font-size: 13px; color: $text-second; text-align: center; }
.cate-item.on { background: #fff; color: $color-primary; font-weight: 700; }
.goods-list { flex: 1; min-width: 0; height: 100%; padding: 8px 6px; box-sizing: border-box; }
.goods-card { display: flex; gap: 10px; padding: 10px; background: #fff; border-radius: 8px; margin-bottom: 10px; }
.gc-cover { width: 64px; height: 64px; border-radius: 8px; background: #e6f9f0; display: flex; align-items: center; justify-content: center; font-size: 28px; flex-shrink: 0; overflow: hidden; }
.gc-cover-img { width: 64px; height: 64px; display: block; }
.gc-main { flex: 1; min-width: 0; }
.gc-name { font-size: 15px; font-weight: 600; color: $text-title; }
.gc-spec { font-size: 11px; color: $text-second; margin: 4px 0 8px; }
.gc-bottom { display: flex; align-items: center; gap: 4px; min-width: 0; }
.gc-price { color: #fa5151; font-size: 16px; font-weight: 700; flex-shrink: 0; }
/* 卡AA：价格脱敏态（¥** + 引导注册灰字，纵向排列，点击整块跳注册页） */
.gc-price-mask { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.gc-mask-tip { font-size: 10px; color: $text-placeholder; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gc-unit { font-size: 11px; color: $text-second; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.gc-add { width: 26px; height: 26px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.stepper { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.st-btn { width: 24px; height: 24px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; }
.st-input { width: 40px; height: 26px; text-align: center; background: #f7f8fa; border-radius: 6px; font-size: 14px; }
.empty { text-align: center; color: $text-placeholder; font-size: 13px; padding: 30px 0; }
.load-error { color: $text-second; }
.retry-btn { display: inline-block; margin-top: 12px; padding: 7px 22px; border-radius: 16px; border: 1.5px solid $color-primary; color: $color-primary; font-size: 13px; font-weight: 600; }
/* 底部结算栏（抬高避开 tabBar） */
.cart-bar { position: fixed; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom)); background: #fff; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 -2px 8px rgba(0,0,0,.05); z-index: 10; }
.cb-left { flex: 1; }
.cb-count { font-size: 12px; color: $text-second; }
.cb-total { font-size: 14px; color: $text-title; margin-top: 2px; }
.cb-price { color: #fa5151; font-size: 18px; font-weight: 700; }
.cb-btns { display: flex; gap: 8px; }
.cb-btn { padding: 9px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; }
.cb-btn.ghost { background: #fff; border: 1px solid $color-primary; color: $color-primary; }
.cb-btn.primary { background: $color-primary; color: #fff; }
</style>
