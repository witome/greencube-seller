<template>
  <view class="buyer-home-page">
    <!-- 未注册引导条（保留现有业务逻辑：未注册采购方先注册） -->
    <view v-if="needRegister" class="buyer-home-reg" @tap="go('/pages/buyer/register')">
      <text>🏪 您还未注册餐馆账号，注册后即可下单采购</text>
      <text class="buyer-home-reg-link">去注册 ›</text>
    </view>

    <!-- ① 商品搜索入口 → 商品 tab -->
    <view class="buyer-home-search" @tap="goTab('/pages/buyer/goods')">🔍 搜索：白菜 / 五花肉 / 鸡蛋…</view>

    <!-- ② 配送说明横幅（接口化：GET /buyer/home-content → home_delivery_note KV；未配置走后端中性默认；加载失败不渲染空横幅） -->
    <view v-if="banner.title" class="buyer-home-banner">
      <text class="buyer-home-banner-b">{{ banner.title }} 🚚</text>
      <text class="buyer-home-banner-s">{{ banner.subtitle }}</text>
    </view>

    <!-- ③ 平台公告（接口化：home_notice KV，enabled=false 或空 → null 不渲染） -->
    <view v-if="platformNotice" class="buyer-home-notice">{{ platformNotice }}</view>


    <!-- ④ 常用功能宫格（8 入口） -->
    <view class="buyer-home-title">常用功能</view>
    <view class="buyer-home-grid">
      <view class="buyer-home-grid-btns">
        <view class="buyer-home-grid-item" @tap="goTab('/pages/buyer/goods')"><view class="buyer-home-grid-ico buyer-home-ico-green">🥬</view><view class="buyer-home-grid-label">分类选购</view></view>
        <view class="buyer-home-grid-item" @tap="goTab('/pages/buyer/goods')"><view class="buyer-home-grid-ico buyer-home-ico-blue">📋</view><view class="buyer-home-grid-label">常购清单</view></view>
        <view class="buyer-home-grid-item" @tap="goTab('/pages/buyer/order-list')"><view class="buyer-home-grid-ico buyer-home-ico-orange">🕐</view><view class="buyer-home-grid-label">最近购买</view></view>
        <view class="buyer-home-grid-item" @tap="todo('配送日期管理')"><view class="buyer-home-grid-ico buyer-home-ico-teal">📅</view><view class="buyer-home-grid-label">配送日期</view></view>
        <view class="buyer-home-grid-item" @tap="go('/pages/buyer/bill')"><view class="buyer-home-grid-ico buyer-home-ico-purple">🧾</view><view class="buyer-home-grid-label">对账单</view></view>
        <view class="buyer-home-grid-item" @tap="go('/pages/buyer/aftersale')"><view class="buyer-home-grid-ico buyer-home-ico-red">🛡️</view><view class="buyer-home-grid-label">售后申请</view></view>
        <view class="buyer-home-grid-item" @tap="todo('优惠券：暂无可用')"><view class="buyer-home-grid-ico buyer-home-ico-orange">🎫</view><view class="buyer-home-grid-label">优惠券</view></view>
        <view class="buyer-home-grid-item" @tap="go('/pages/buyer/kefu')"><view class="buyer-home-grid-ico buyer-home-ico-blue">💬</view><view class="buyer-home-grid-label">AI 客服下单</view></view>
      </view>
    </view>

    <!-- ⑤ 今日推荐商品（接口化：home_recommendations KV 商品 id 有序数组，后端按序返回在售商品；空 → 空态，绝无假数据兜底） -->
    <view class="buyer-home-title">
      <text>今日推荐</text>
      <text class="buyer-home-more" @tap="goTab('/pages/buyer/goods')">更多 ›</text>
    </view>
    <view class="buyer-home-rec">
      <template v-if="recsLoading">
        <view v-for="i in 3" :key="'s'+i" class="buyer-home-rec-card">
          <view class="buyer-home-rec-img buyer-home-skeleton">·</view>
          <view class="buyer-home-rec-body"><view class="buyer-home-skeleton-line"></view><view class="buyer-home-skeleton-line buyer-home-skeleton-line--short"></view><view class="buyer-home-skeleton-line buyer-home-skeleton-line--price"></view></view>
        </view>
      </template>
      <view v-else-if="!recs.length" class="buyer-home-empty buyer-home-rec-empty">暂无推荐，去商品页逛逛 ›</view>
      <template v-else>
        <view v-for="g in recs" :key="g.id" class="buyer-home-rec-card" @tap="goDetail(g.id)">
          <view class="buyer-home-rec-img">{{ emojiOf(g.name) }}</view>
          <view class="buyer-home-rec-body">
            <view class="buyer-home-rec-name">{{ g.name }}</view>
            <view class="buyer-home-rec-spec">{{ g.specText || (g.weighType === 1 ? '称重商品' : '固定规格') }}</view>
            <view class="buyer-home-rec-price">¥{{ g.salePrice }}<text class="buyer-home-rec-unit">/{{ g.unit }}</text></view>
          </view>
        </view>
      </template>
    </view>

    <!-- ⑥ 进行中的订单（真实接口：/order 列表，过滤进行中状态） -->
    <view class="buyer-home-title">进行中的订单</view>
    <view v-if="ordersLoading" class="buyer-home-order-loading">加载中…</view>
    <view v-else-if="ordersFailed" class="buyer-home-order-fail" @tap="loadOrders">
      <text>订单加载失败，点击重试</text>
    </view>
    <view v-else-if="!activeOrders.length" class="buyer-home-empty">暂无进行中的订单，去挑点菜吧</view>
    <view v-else>
      <view v-for="o in activeOrders" :key="o.orderId" class="buyer-home-order" @tap="goOrder(o.orderId)">
        <view class="buyer-home-order-ico" :style="{ background: orderIcon(o.status).bg }">{{ orderIcon(o.status).e }}</view>
        <view class="buyer-home-order-main">
          <view class="buyer-home-order-t">{{ orderNo(o) }}</view>
          <view class="buyer-home-order-d">{{ o.statusText }} · {{ etaText(o) }}</view>
          <view v-if="o.items && o.items.length" class="buyer-home-order-items">{{ (o.items || []).map(i => `${i.name}×${i.qty}`).join('、') }}</view>
        </view>
        <view class="buyer-home-arrow">›</view>
      </view>
    </view>

    <BuyerTabBar active="/pages/buyer/home" />
    <!-- #ifdef MP-WEIXIN -->
    <DevRoleSwitcher />
    <!-- #endif -->
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi, buyerApi } from '@/api/modules'
import BuyerTabBar from '@/components/BuyerTabBar.vue'
// #ifdef MP-WEIXIN
import DevRoleSwitcher from '@/components/DevRoleSwitcher.vue'
// #endif

// tabBar 页面（商品/购物车/订单/我的）必须用 switchTab 跳转，navigateTo 无效
const go = (url) => uni.navigateTo({ url })
const goTab = (url) => uni.switchTab({ url })
const goOrder = (id) => uni.navigateTo({ url: `/pages/buyer/order-detail?id=${id}` })
// 商品详情页跳转（推荐位只展示真实商品，均为数字 id）
const goDetail = (id) => uni.navigateTo({ url: `/pages/buyer/goods-detail?id=${id}` })

// 暂未实现的入口：给出「功能建设中」提示，不做无声跳转
const todo = (name) => uni.showToast({ title: `${name} · 功能建设中`, icon: 'none' })

const needRegister = ref(false)

// ── 首页内容（GET /buyer/home-content 一次取全：横幅/公告/今日推荐位）──
const banner = ref({ title: '', subtitle: '' })
const platformNotice = ref('') // null/空 → 不渲染（运营停用或未配置公告时）

// ── 今日推荐 ──
const recsLoading = ref(true)
const recs = ref([])

// ── 进行中的订单（10 待确认 ~ 50 配送中） ──
const ACTIVE_STATUS = [10, 20, 30, 40, 45, 50]
const activeOrders = ref([])
const ordersLoading = ref(true)
const ordersFailed = ref(false)

// 商品名 → emoji 封面（真实数据无图片时的可视化兜底）
const emojiOf = (name = '') => {
  if (/白菜|青菜|生菜|菠菜|芹菜|油麦|空心菜|韭菜|娃娃菜/.test(name)) return '🥬'
  if (/土豆|马铃薯/.test(name)) return '🥔'
  if (/肉|排骨|五花|里脊|猪|牛|羊|鸡|鸭/.test(name)) return '🥩'
  if (/蛋/.test(name)) return '🥚'
  if (/鱼|虾|蟹|海鲜|水产/.test(name)) return '🐟'
  if (/姜|蒜|葱|洋葱/.test(name)) return '🧅'
  return '🥬'
}

const orderNo = (o) => `SO-${(o.deliveryDate || '').replace(/-/g, '')}-${String(o.orderId).padStart(4, '0')}`
const timeRange = (w) => ({ 1: '05-08', 2: '10-13', 3: '16-19' }[w] || '')
const localDateStr = (offsetDays) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
const etaText = (o) => {
  if (o.status === 50) return timeRange(o.timeWindow) ? `预计 ${timeRange(o.timeWindow)} 送达` : '配送中'
  if (o.deliveryDate === localDateStr(1)) return '明日达'
  if (o.deliveryDate === localDateStr(0)) return '今日达'
  return `${o.deliveryDate} 送达`
}
const orderIcon = (status) => {
  if (status === 50) return { e: '📦', bg: '#E6F9F0' }        // 配送中
  if (status === 30) return { e: '⏳', bg: '#FFF3E6' }        // 备货中
  if (status === 40 || status === 45) return { e: '🚚', bg: '#E8F1FF' } // 待配送/已派单
  if (status === 10 || status === 20) return { e: '📝', bg: '#E8F1FF' } // 待确认/已拆单
  return { e: '📦', bg: '#F0F1F3' }
}

const loadProfile = async () => {
  try {
    const profile = await authApi.getProfile()
    needRegister.value = !profile || !profile.purchaser
  } catch (e) {
    needRegister.value = true
  }
}

const loadHomeContent = async () => {
  recsLoading.value = true
  try {
    const data = await buyerApi.getHomeContent()
    banner.value = data.deliveryNote || { title: '', subtitle: '' }
    platformNotice.value = data.notice || ''
    recs.value = data.recommendations || [] // 空数组 → 空态，不用假数据兜底
  } catch (e) {
    banner.value = { title: '', subtitle: '' }
    platformNotice.value = ''
    recs.value = [] // 失败显示空态，不用假数据兜底
  } finally {
    recsLoading.value = false
  }
}

const loadOrders = async () => {
  ordersLoading.value = true
  ordersFailed.value = false
  try {
    const data = await buyerApi.getOrderList({ page: 1, pageSize: 10 })
    activeOrders.value = (data.list || []).filter((o) => ACTIVE_STATUS.includes(o.status)).slice(0, 5)
  } catch (e) {
    ordersFailed.value = true
  } finally {
    ordersLoading.value = false
  }
}

onShow(async () => {
  // 标题在本页动态设置，不改 pages.json 全局配置
  uni.setNavigationBarTitle({ title: '绿立方 · 采购' })
  // H5 原生 tabBar 不支持 emoji，统一用自绘 BuyerTabBar 底栏，隐藏原生 tabBar
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  await loadProfile()
  loadHomeContent()
  if (!needRegister.value) loadOrders()
  else { ordersLoading.value = false; activeOrders.value = [] }
})
</script>

<style lang="scss" scoped>
/* ── 首页容器：对齐原型 .phone-body（#F5F6F8 底，各区块自带 12px 外边距） ── */
.buyer-home-page {
  min-height: 100vh;
  background: $bg-page;
  padding-bottom: 80px; /* 预留自定义底部导航高度，避免内容被遮挡 */
  box-sizing: border-box;
}

/* ── 未注册引导条（保留既有业务） ── */
.buyer-home-reg {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: $brand-soft;
  border: 1px solid $brand;
  border-radius: 10px;
  margin: 12px;
  padding: 10px 12px;
  font-size: 12px;
  color: $brand-deep;
}
.buyer-home-reg-link { font-weight: 700; white-space: nowrap; }

/* ── 搜索入口 ── */
.buyer-home-search {
  margin: 12px;
  background: #fff;
  border-radius: 10px;
  padding: 10px 14px;
  color: #9AA1AB;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ── 配送横幅（绿渐变） ── */
.buyer-home-banner {
  margin: 12px;
  border-radius: 12px;
  background: linear-gradient(120deg, #00B96B, #35C98D);
  color: #fff;
  padding: 16px;
}
.buyer-home-banner-b { font-size: 15px; font-weight: 700; display: block; margin-bottom: 4px; }
.buyer-home-banner-s { font-size: 12px; opacity: .9; }

/* ── 平台公告（黄底） ── */
.buyer-home-notice {
  margin: 12px;
  background: #FFF8E6;
  border: 1px solid #FFE7BA;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  color: #B26A00;
  display: flex;
  gap: 6px;
}

/* ── 区块标题 ── */
.buyer-home-title {
  font-size: 15px;
  font-weight: 700;
  color: $text-title;
  margin: 14px 14px 2px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.buyer-home-more { font-size: 12px; color: #8A9099; font-weight: 400; }

/* ── 常用功能宫格 ── */
.buyer-home-grid {
  margin: 12px;
  border-radius: 14px;
  padding: 14px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.buyer-home-grid-btns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 0; }
.buyer-home-grid-item { display: flex; flex-direction: column; align-items: center; padding: 10px 2px; border-radius: 10px; }
.buyer-home-grid-item:active { background: #F2F4F6; }
.buyer-home-grid-ico {
  width: 44px; height: 44px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; margin-bottom: 6px;
}
.buyer-home-ico-green { background: #E6F9F0; }
.buyer-home-ico-blue { background: #E8F1FF; }
.buyer-home-ico-orange { background: #FFF3E6; }
.buyer-home-ico-teal { background: #E3F7F5; }
.buyer-home-ico-purple { background: #F3EDFF; }
.buyer-home-ico-red { background: #FFEDED; }
.buyer-home-grid-label { font-size: 12px; color: #4A5261; font-weight: 500; }

/* ── 今日推荐卡片（横向三卡） ── */
.buyer-home-rec { display: flex; gap: 10px; margin: 0 12px; }
.buyer-home-rec-empty { flex: 1; padding: 30px 0; }
.buyer-home-rec-card {
  flex: 1; min-width: 0;
  background: #fff; border-radius: 14px; overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.buyer-home-rec-img {
  height: 70px;
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; background: #F7F9FA;
}
.buyer-home-rec-img.buyer-home-skeleton { color: #E5E8EB; }
.buyer-home-rec-body { padding: 8px 10px; }
.buyer-home-rec-name { font-size: 12.5px; font-weight: 600; color: $text-title; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.buyer-home-rec-spec { font-size: 10px; color: #8A9099; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.buyer-home-rec-price { font-size: 13px; color: #FA5151; font-weight: 800; margin-top: 1px; }
.buyer-home-rec-unit { font-size: 10px; font-weight: 400; color: #8A9099; }
/* 推荐加载骨架 */
.buyer-home-skeleton-line { height: 9px; border-radius: 4px; background: #EFF2F5; margin-top: 6px; width: 70%; }
.buyer-home-skeleton-line--short { width: 50%; }
.buyer-home-skeleton-line--price { width: 45%; }

/* ── 进行中的订单 ── */
.buyer-home-order {
  background: #fff; border-radius: 12px; margin: 8px 12px; padding: 13px 14px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.buyer-home-order-ico {
  width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 20px;
}
.buyer-home-order-main { flex: 1; min-width: 0; }
.buyer-home-order-t { font-size: 14px; font-weight: 600; color: $text-title; }
.buyer-home-order-d { font-size: 11px; color: #8A9099; margin-top: 2px; }
.buyer-home-order-items { font-size: 11px; color: #8A9099; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.buyer-home-arrow { color: #C2C8D0; font-size: 18px; }
.buyer-home-order-loading,
.buyer-home-order-fail,
.buyer-home-empty {
  text-align: center; color: $text-placeholder; font-size: 12px; padding: 40px 0;
}
.buyer-home-order-fail { color: $info; }
</style>
