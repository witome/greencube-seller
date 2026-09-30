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
      <scroll-view scroll-y class="goods-list" :style="{ paddingBottom: selectedCount > 0 ? '122px' : '70px' }" @scrolltolower="loadMore">
        <view v-for="g in goodsList" :key="g.id" class="goods-card" @tap="goDetail(g.id)">
          <!-- 卡Z1：有封面显真图，无封面回退首字占位（不许白块/破图） -->
          <view class="gc-cover">
            <image v-if="g.cover" :src="fullUrl(g.cover)" mode="aspectFill" class="gc-cover-img" />
            <text v-else>{{ g.name.slice(0, 1) }}</text>
          </view>
          <view class="gc-main">
            <view class="gc-name">{{ g.name }}</view>
            <view class="gc-spec">{{ g.specText || (g.weighType === 1 ? '称重' : '固定规格') }}</view>
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
                <view class="st-btn" @tap.stop="decrease(g)">−</view>
                <input class="st-input" type="number" :value="cartMap[g.id]" @input="onQtyInput(g, $event)" />
                <view class="st-btn" @tap.stop="increase(g)">＋</view>
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

    <!-- 底部结算栏：有选中商品时显示 -->
    <view v-if="selectedCount > 0" class="cart-bar">
      <view class="cb-left">
        <view class="cb-count">已选 {{ selectedCount }} 件</view>
        <view class="cb-total">合计 <text class="cb-price">¥{{ totalAmount }}</text></view>
      </view>
      <view class="cb-btns">
        <view class="cb-btn ghost" @tap="addAllToCart">加入购物车</view>
        <view class="cb-btn primary" @tap="buyAll">立即下单</view>
      </view>
    </view>

    <BuyerTabBar active="/pages/buyer/goods" />
    <AiOrderFab :offset="136" />
  </view>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
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

// 已选商品：productId -> 数量
const cartMap = reactive({})

const go = (url) => uni.navigateTo({ url })

const selectedCount = computed(() => Object.keys(cartMap).length)
const totalAmount = computed(() => {
  return Object.entries(cartMap).reduce((s, [id, qty]) => {
    const g = goodsList.value.find((x) => x.id === Number(id))
    return s + (g ? g.salePrice * qty : 0)
  }, 0).toFixed(2)
})

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
const addAllToCart = async () => {
  for (const [productId, qty] of Object.entries(cartMap)) {
    await buyerApi.addToCart({ productId: Number(productId), qty })
  }
  uni.showToast({ title: '已加入购物车', icon: 'success' })
  Object.keys(cartMap).forEach((k) => delete cartMap[k])
  uni.$emit('cart-badge-refresh')
}

const buyAll = async () => {
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

onMounted(() => { loadCategories(); loadGoods() })
onShow(async () => {
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  // 上次加载失败（如后端不可达）时，回到本页自动补一次，避免一直卡在「加载中」
  if (loadError.value && !loading.value) loadGoods()
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
