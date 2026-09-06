<template>
  <view class="page">
    <view class="home-head">
      <view class="hello">🥕 {{ stallName || '供应商工作台' }}</view>
      <view class="addr">今日备货 · 有货直接备，缺货异常申报</view>
    </view>

    <!-- 待办统计 -->
    <view class="stat-row">
      <view class="stat-chip" @tap="go('/subpkg-supplier/pages/stock-list')">
        <view class="num orange">{{ pendingOrders.length }}</view>
        <view class="lbl">待备货</view>
      </view>
      <view class="stat-chip" @tap="go('/subpkg-supplier/pages/goods-manage')">
        <view class="num blue">{{ myGoodsCount }}</view>
        <view class="lbl">我的商品</view>
      </view>
      <view class="stat-chip" @tap="go('/subpkg-supplier/pages/finance')">
        <view class="num green">{{ pendingSettle }}</view>
        <view class="lbl">待对账</view>
      </view>
    </view>

    <!-- 快捷操作 -->
    <view class="card">
      <view class="card-title">快捷操作</view>
      <view class="grid-btns">
        <view class="gbtn" @tap="go('/subpkg-supplier/pages/stock-list')">
          <view class="gi" style="background:#FFF3E6;">📄</view><view class="gt">备货单</view>
        </view>
        <view class="gbtn" @tap="go('/subpkg-supplier/pages/goods-manage')">
          <view class="gi" style="background:#E6F9F0;">📦</view><view class="gt">商品管理</view>
        </view>
        <view class="gbtn" @tap="go('/subpkg-supplier/pages/handover')">
          <view class="gi" style="background:#E8F1FF;">🤝</view><view class="gt">交接确认</view>
        </view>
        <view class="gbtn" @tap="go('/subpkg-supplier/pages/finance')">
          <view class="gi" style="background:#F3EDFF;">💰</view><view class="gt">历史与应付</view>
        </view>
      </view>
    </view>

    <!-- 待备货列表预览 -->
    <view class="section-title">待备货订单</view>
    <view v-for="o in pendingOrders.slice(0, 5)" :key="o.orderId" class="list-item" @tap="go('/subpkg-supplier/pages/stock-list')">
      <view class="li-ico" style="background:#FFF3E6;">📄</view>
      <view class="li-main">
        <view class="li-t">订单 #{{ o.orderId }}</view>
        <view class="li-d">{{ o.deliveryDate }} 送达 · {{ o.items.length }} 项 · 请及时备货</view>
      </view>
      <view class="tag o">备货中</view>
    </view>
    <view v-if="!pendingOrders.length" class="empty">今日暂无备货任务</view>

    <CustomTabBar :tabs="supplierTabs" active="/subpkg-supplier/pages/home" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'
import { authApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'

const pendingOrders = ref([])
const myGoodsCount = ref(0)
const pendingSettle = ref(0)
const stallName = ref('')

const supplierTabs = [
  { path: '/subpkg-supplier/pages/home', icon: '📋', label: '今日待办' },
  { path: '/subpkg-supplier/pages/stock-list', icon: '📄', label: '备货单' },
  { path: '/subpkg-supplier/pages/handover', icon: '🤝', label: '交接' },
  { path: '/subpkg-supplier/pages/finance', icon: '💰', label: '应付' },
  { path: '/subpkg-supplier/pages/mine', icon: '👤', label: '我的' },
]

const go = (url) => uni.navigateTo({ url })

// 隐藏采购方原生 tabBar（分包页应有自己的底部导航）+ 每次显示刷新待办
onShow(async () => {
  uni.hideTabBar({ animation: false })

  try {
    const profile = await authApi.getProfile()
    stallName.value = profile.supplier?.stallName || ''
  } catch (e) { /* ignore */ }

  pendingOrders.value = await supplierApi.getStockList()
  const goods = await supplierApi.getMyGoods({})
  myGoodsCount.value = goods.total || goods.list?.length || 0
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.home-head { padding: 4px 2px 12px; }
.hello { font-size: 18px; font-weight: 700; color: $text-title; }
.addr { font-size: 12px; color: $text-second; margin-top: 4px; }
.stat-row { display: flex; gap: 10px; margin-bottom: 10px; }
.stat-chip { flex: 1; background: #fff; border-radius: 8px; padding: 12px; text-align: center; }
.num { font-size: 20px; font-weight: 700; }
.num.orange { color: #ff8f1f; } .num.blue { color: #3b7cff; } .num.green { color: #00b96b; }
.lbl { font-size: 12px; color: $text-second; margin-top: 2px; }
.empty { text-align: center; color: $text-placeholder; padding: 30px 0; font-size: 13px; }
</style>
