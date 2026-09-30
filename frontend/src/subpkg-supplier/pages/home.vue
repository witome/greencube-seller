<template>
  <view class="page">
    <view class="home-head">
      <view class="hello">🥕 {{ stallName || '供应商工作台' }}</view>
      <view class="addr">今日备货 · 有货直接备，缺货异常申报</view>
    </view>

    <!-- 卡AE（2026-09-30）新增：售后待办横幅（0 时不显示） -->
    <view v-if="aftersalePending > 0" class="todo-banner" @tap="goAftersale">
      <text class="ic">🔔</text>
      <view class="tb-main">
        <text class="t">有 {{ aftersalePending }} 条售后待处理</text>
        <text class="s">客户提的少货 / 品质问题，请配合运营核实</text>
      </view>
      <text class="go">查看 ›</text>
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
      <!-- 卡AE 新增第 4 格：售后待处理（点击进售后列表） -->
      <view class="stat-chip" @tap="goAftersale">
        <view class="num red">{{ aftersalePending }}</view>
        <view class="lbl">售后待处理</view>
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
        <!-- 卡AE 新增第 5 格：售后（只读；红点＝待处理条数，0 时不显示） -->
        <view class="gbtn" @tap="goAftersale">
          <view class="gi" style="background:#FFECEC;border:1px dashed #FA5151;">🛠</view>
          <view class="gt" style="color:#D64550;font-weight:700;">售后</view>
          <view v-if="aftersalePending > 0" class="bd">{{ aftersalePending }}</view>
        </view>
      </view>
    </view>

    <!-- 待备货列表（含订单详情 + 确认备货完成 + 异常申报） -->
    <view class="section-title">待备货订单</view>
    <view v-for="o in pendingOrders.slice(0, 5)" :key="o.orderId" class="stock-card">
      <view class="sc-head">
        <text class="sc-title">订单 #{{ o.orderId }}</text>
        <text class="sc-date">{{ o.deliveryDate }} 送达</text>
      </view>
      <view class="sc-items">
        <view v-for="it in o.items" :key="it.orderItemId" class="sc-item-wrap">
          <view class="sc-item">
            <text>{{ it.productName }}</text>
            <text :class="{ shortage: isShortage(it) }">
              {{ isShortage(it) ? `缺货 · 实交 ${it.qtyDeclared}${it.unit || ''}` : `订 ${it.qtyOrdered}${it.unit || ''}` }}
            </text>
          </view>
          <text v-if="it.remark" class="sc-remark">备注：{{ it.remark }}</text>
        </view>
      </view>
      <view class="sc-btns">
        <view class="sc-btn ghost" @tap="goDeclare(o.orderId)">异常申报</view>
        <view class="sc-btn primary" @tap="handover(o)">确认备货完成</view>
      </view>
    </view>
    <view v-if="!pendingOrders.length" class="empty">今日暂无备货任务</view>

    <CustomTabBar :tabs="supplierTabs" active="/subpkg-supplier/pages/home" />
    <!-- #ifdef MP-WEIXIN -->
    <DevRoleSwitcher />
    <!-- #endif -->
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'
import { authApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'
// #ifdef MP-WEIXIN
import DevRoleSwitcher from '@/components/DevRoleSwitcher.vue'
// #endif

const pendingOrders = ref([])
const myGoodsCount = ref(0)
const pendingSettle = ref(0)
const stallName = ref('')
// 卡AE（2026-09-30）：售后待处理条数。来源 = GET /supplier/aftersale 返回的 pendingCount
// （**复用同一个接口**，不另开端点 —— 一个档口的售后量级很小，首页多取一次整列表可接受；
//   这也是本卡「待办数怎么给」的落地选择，已在交接页写清）
const aftersalePending = ref(0)

const supplierTabs = [
  { path: '/subpkg-supplier/pages/home', icon: '📋', label: '今日待办' },
  { path: '/subpkg-supplier/pages/stock-list', icon: '📄', label: '备货单' },
  { path: '/subpkg-supplier/pages/handover', icon: '🤝', label: '交接' },
  { path: '/subpkg-supplier/pages/finance', icon: '💰', label: '应付' },
  { path: '/subpkg-supplier/pages/mine', icon: '👤', label: '我的' },
]

const go = (url) => uni.navigateTo({ url })
// 卡AE：售后页是二级页（不在底部导航里），从首页/统计格/快捷格统一从这里进
const goAftersale = () => uni.navigateTo({ url: '/subpkg-supplier/pages/aftersale' })

const isShortage = (it) => it.qtyDeclared !== null && Number(it.qtyDeclared) < Number(it.qtyOrdered)
const goDeclare = (orderId) => uni.navigateTo({ url: `/subpkg-supplier/pages/stock-declare?orderId=${orderId}` })
const handover = async (o) => {
  await supplierApi.handover(o.orderId)
  uni.showToast({ title: '已确认备货完成', icon: 'success' })
  pendingOrders.value = pendingOrders.value.filter((x) => x.orderId !== o.orderId)
}

// 隐藏采购方原生 tabBar（分包页应有自己的底部导航）+ 每次显示刷新待办
onShow(async () => {

  try {
    const profile = await authApi.getProfile()
    stallName.value = profile.supplier?.stallName || ''
  } catch (e) { /* ignore */ }

  pendingOrders.value = await supplierApi.getStockList()
  const goods = await supplierApi.getMyGoods({})
  myGoodsCount.value = goods.total || goods.list?.length || 0

  // 卡AE：售后待处理数（首页红点）。失败不影响首页其它内容 —— 静默保持 0，不弹错
  try {
    const as = await supplierApi.getAftersales()
    aftersalePending.value = as?.pendingCount || 0
  } catch (e) { /* ignore */ }
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
.num.orange { color: #ff8f1f; } .num.blue { color: #3b7cff; } .num.green { color: #00b96b; } .num.red { color: #fa5151; }
.lbl { font-size: 12px; color: $text-second; margin-top: 2px; }
/* 卡AE：快捷格右下角红点数字（0 时不渲染） */
.gbtn .bd { position: absolute; top: -4px; right: -2px; background: #fa5151; color: #fff; font-size: 10px; border-radius: 8px; padding: 0 5px; line-height: 14px; font-weight: 700; }
.gbtn { position: relative; }
/* 卡AE：售后待办横幅（照原型 B1 的 todo-banner） */
.todo-banner { display: flex; align-items: center; gap: 8px; background: #fff1f1; border: 1px dashed #fa5151; border-radius: 10px; padding: 9px 10px; margin-bottom: 10px; }
.todo-banner .ic { font-size: 18px; }
.todo-banner .tb-main { flex: 1; }
.todo-banner .t { display: block; font-size: 13px; font-weight: 700; color: #d64550; }
.todo-banner .s { display: block; font-size: 11px; color: #b25b5b; margin-top: 2px; }
.todo-banner .go { font-size: 12px; color: #d64550; font-weight: 700; }
.stock-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.sc-head { display: flex; justify-content: space-between; }
.sc-title { font-weight: 700; color: $text-title; }
.sc-date { font-size: 12px; color: $text-second; }
.sc-items { margin-top: 6px; }
.sc-item-wrap { padding: 4px 0; border-bottom: 1px solid #f5f6f7; }
.sc-item { display: flex; justify-content: space-between; font-size: 13px; color: $text-title; }
.sc-item .shortage { color: #fa5151; font-weight: 600; }
.sc-remark { display: block; font-size: 12px; color: #fa8c16; margin-top: 3px; }
.sc-btns { display: flex; gap: 8px; margin-top: 10px; }
.sc-btn { flex: 1; text-align: center; padding: 8px 0; border-radius: 18px; font-size: 13px; font-weight: 600; }
.sc-btn.ghost { background: #f0f1f3; color: $text-second; }
.sc-btn.primary { background: $color-primary; color: #fff; }
.empty { text-align: center; color: $text-placeholder; padding: 30px 0; font-size: 13px; }
</style>
