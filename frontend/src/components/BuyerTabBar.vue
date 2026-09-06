<template>
  <view class="buyer-tabbar">
    <view v-for="t in tabs" :key="t.path" class="buyer-tabbar-item" @tap="switchTo(t.path)">
      <text class="buyer-tabbar-ico" :class="{ on: t.path === active }">{{ t.icon }}</text>
      <text class="buyer-tabbar-label" :class="{ on: t.path === active }">{{ t.label }}</text>
      <text v-if="t.path === '/pages/buyer/cart' && cartCount > 0" class="buyer-tabbar-badge">{{ cartCount }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import { onMounted, onUnmounted } from 'vue'
import { buyerApi } from '@/api/modules'

// 采购方 emoji 底部导航（H5 端原生 tabBar 不支持 emoji/自定义，故全局自绘）
const props = defineProps({
  active: { type: String, default: '/pages/buyer/home' },
})

const tabs = [
  { path: '/pages/buyer/home', icon: '🏠', label: '首页' },
  { path: '/pages/buyer/goods', icon: '🥕', label: '商品' },
  { path: '/pages/buyer/cart', icon: '🛒', label: '购物车' },
  { path: '/pages/buyer/order-list', icon: '📦', label: '订单' },
  { path: '/pages/buyer/mine', icon: '👤', label: '我的' },
]

const cartCount = ref(0)

const refreshCart = async () => {
  try {
    const data = await buyerApi.getCart()
    cartCount.value = Array.isArray(data) ? data.length : data?.list?.length || 0
  } catch (e) {
    cartCount.value = 0
  }
}

const switchTo = (path) => {
  if (path === props.active) return
  uni.switchTab({ url: path })
}

onMounted(refreshCart)
watch(() => props.active, refreshCart)
uni.$on('cart-badge-refresh', refreshCart)
onUnmounted(() => {
  uni.$off('cart-badge-refresh', refreshCart)
})
</script>

<style lang="scss" scoped>
.buyer-tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 999;
  display: flex; background: #fff; border-top: 1px solid #EDEEF0;
  padding: 6px 0 10px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
}
.buyer-tabbar-item {
  flex: 1; text-align: center; font-size: 10px; color: #8A9099; position: relative;
}
.buyer-tabbar-ico { font-size: 22px; display: block; margin-bottom: 2px; filter: grayscale(1); opacity: .55; }
.buyer-tabbar-ico.on { filter: none; opacity: 1; }
.buyer-tabbar-label { font-size: 10px; }
.buyer-tabbar-label.on { color: #00B96B; font-weight: 600; }
.buyer-tabbar-badge {
  position: absolute; top: -2px; right: 26%;
  background: #FA5151; color: #fff; font-size: 10px;
  min-width: 16px; height: 16px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; padding: 0 4px;
}
</style>
