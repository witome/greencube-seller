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
          <view class="gc-cover">{{ g.name.slice(0, 1) }}</view>
          <view class="gc-main">
            <view class="gc-name">{{ g.name }}</view>
            <view class="gc-spec">{{ g.specText || (g.weighType === 1 ? '称重商品·多退少补' : '固定规格') }}</view>
            <view class="gc-bottom">
              <text class="gc-price">¥{{ g.salePrice }}</text>
              <text class="gc-unit">/{{ g.unit }}</text>
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
        <view v-if="!goodsList.length && !loading" class="empty">暂无商品</view>
        <view v-if="loading" class="empty">加载中…</view>
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
  </view>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'
import BuyerTabBar from '@/components/BuyerTabBar.vue'

const categories = ref([])
const goodsList = ref([])
const activeCate = ref(0) // 0 = 全部
const keyword = ref('')
const page = ref(1)
const total = ref(0)
const loading = ref(false)

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
  categories.value = await buyerApi.getCategories()
}

const loadGoods = async (reset = true) => {
  if (reset) { page.value = 1; goodsList.value = [] }
  loading.value = true
  // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成字符串 "undefined"，导致后端误当搜索词
  const params = { page: page.value, pageSize: 20 }
  if (activeCate.value) params.categoryId = activeCate.value
  if (keyword.value) params.keyword = keyword.value
  const data = await buyerApi.getGoods(params)
  goodsList.value = reset ? data.list : [...goodsList.value, ...data.list]
  total.value = data.total
  loading.value = false
}

const loadMore = () => {
  if (goodsList.value.length >= total.value || loading.value) return
  page.value++
  loadGoods(false)
}

const switchCate = (id) => { activeCate.value = id; loadGoods() }
const goDetail = (id) => go(`/pages/buyer/goods-detail?id=${id}`)

onMounted(() => { loadCategories(); loadGoods() })
onShow(() => {
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
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
.goods-list { flex: 1; height: 100%; padding: 8px 12px; box-sizing: border-box; }
.goods-card { display: flex; gap: 10px; padding: 10px; background: #fff; border-radius: 8px; margin-bottom: 10px; }
.gc-cover { width: 64px; height: 64px; border-radius: 8px; background: #e6f9f0; display: flex; align-items: center; justify-content: center; font-size: 28px; flex-shrink: 0; }
.gc-main { flex: 1; }
.gc-name { font-size: 15px; font-weight: 600; color: $text-title; }
.gc-spec { font-size: 11px; color: $text-second; margin: 4px 0 8px; }
.gc-bottom { display: flex; align-items: center; gap: 4px; }
.gc-price { color: #fa5151; font-size: 16px; font-weight: 700; }
.gc-unit { font-size: 11px; color: $text-second; flex: 1; }
.gc-add { width: 26px; height: 26px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.stepper { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.st-btn { width: 24px; height: 24px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 14px; }
.st-input { width: 40px; height: 26px; text-align: center; background: #f7f8fa; border-radius: 6px; font-size: 14px; }
.empty { text-align: center; color: $text-placeholder; font-size: 13px; padding: 30px 0; }
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
