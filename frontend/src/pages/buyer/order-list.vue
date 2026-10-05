<template>
  <view class="page">
    <!-- 卡CF（2026-10-05）浏览优先整改：未登录/未过审空态覆盖层
         （沿用本页 .empty 居中灰字 + 主色按钮；让出 tab 底栏可切换；
          未登录时不请求任何接口、不自动跳转，由用户主动点「去登录/去注册」） -->
    <view v-if="authGate !== 'ok'" class="auth-gate">
      <view class="auth-gate-card">
        <view class="auth-gate-ico">📦</view>
        <view class="auth-gate-t1">{{ authGate === 'guest' ? '登录后可查看订单' : '账号注册并审核通过后可用' }}</view>
        <view class="auth-gate-btn" @tap="authGate === 'guest' ? goLogin() : goRegisterPage()">{{ authGate === 'guest' ? '去登录' : '去注册' }}</view>
      </view>
    </view>

    <!-- 状态筛选 -->
    <scroll-view scroll-x class="chips-row">
      <view v-for="s in statusTabs" :key="s.value" :class="['chip', { on: activeStatus === s.value }]" @tap="switchStatus(s.value)">{{ s.label }}</view>
    </scroll-view>

    <view v-for="o in orders" :key="o.orderId" class="order-card" @tap="goDetail(o.orderId)">
      <view class="oc-head">
        <text class="oc-date">{{ o.deliveryDate }} · {{ timeText(o.timeWindow) }}</text>
        <text class="oc-status">{{ o.statusText }}</text>
      </view>
      <!-- 卡S2（2026-09-29）：支付状态标签 —— 文案来自后端 payStatusText（唯一实现 pay-status.util），
           前端只做配色（按 code）：已付款=绿 / cod_pending=橙 / 其它未付=灰
           卡AG（2026-09-30）：后端给**采购方**的 payStatusText 是**客户版** ——
           cod_pending（COD 已送达未收）与 unpaid 一样显示「未支付」，客户侧不会再看到「待收款」；
           配色仍按 code 走（该档橙色在列表里正好提示"这一单还欠着钱"），本页**不自己判任何支付状态**。 -->
      <view class="oc-pay-row">
        <text :class="['oc-pay', 'oc-pay-' + payClass(o.payStatus)]">{{ o.payStatusText }}</text>
      </view>
      <view class="oc-body">
        <text>{{ o.itemCount }} 项商品</text>
        <text v-if="o.amountFinal" class="oc-amount">¥{{ o.amountFinal }}</text>
      </view>
    </view>

    <view v-if="loadError && !loading" class="empty">
      订单加载失败，请检查网络
      <view class="retry-btn" @tap="load">重试</view>
    </view>
    <view v-if="!orders.length && !loading && !loadError" class="empty">暂无订单</view>

    <BuyerTabBar active="/pages/buyer/order-list" />
    <AiOrderFab :offset="80" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { guardBuyerSuspended } from '@/utils/account-guard'
import BuyerTabBar from '@/components/BuyerTabBar.vue'
import AiOrderFab from '@/components/AiOrderFab.vue'

const orders = ref([])
const activeStatus = ref('')
const loading = ref(false)
const loadError = ref(false)
// 卡CF（2026-10-05）：身份门控 —— ok=已注册可用 / guest=未登录 / pending=有 token 但未过审
const authGate = ref('ok')
// 空态按钮跳转（用户主动点击才引导登录/注册，不自动跳转）
const goLogin = () => uni.navigateTo({ url: '/pages/login/index' })
const goRegisterPage = () => uni.navigateTo({ url: '/pages/buyer/register' })
// 卡CD（2026-10-04）：请求序号 —— 快速连点状态筛选时旧响应不得覆盖新结果
let loadSeq = 0

const statusTabs = [
  { label: '全部', value: '' },
  { label: '待确认', value: 10 },
  { label: '备货中', value: 30 },
  { label: '配送中', value: 50 },
  { label: '已完成', value: 70 },
]

const timeText = (w) => ({ 1: '早 05-08', 2: '中 10-13', 3: '晚 16-19' }[w] || '')

// 卡S2：支付状态配色映射（只做展示，不判定 —— 判定在后端 pay-status.util）
const payClass = (code) => ({ paid_wechat: 'ok', paid_proof: 'ok', cod_pending: 'pending' }[code] || 'none')

const load = async () => {
  // 卡CD：加 try/catch/finally —— 原先接口一失败 loading 永远为 true，
  // 空态/列表都不渲染，页面无任何反馈且不会自愈（CODEBUDDY.md 踩坑清单第 9 条同款）
  const seq = ++loadSeq
  loading.value = true
  loadError.value = false
  try {
    // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成 "undefined"，导致后端误过滤
    const params = { page: 1, pageSize: 20 }
    if (activeStatus.value) params.status = activeStatus.value
    const data = await buyerApi.getOrderList(params)
    if (seq !== loadSeq) return // 已有更新的请求，旧响应丢弃
    orders.value = data.list
  } catch (e) {
    if (seq !== loadSeq) return
    loadError.value = true // 可见失败态 + 重试入口；提示由 request 层统一 toast
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

const switchStatus = (v) => { activeStatus.value = v; load() }
const goDetail = (id) => uni.navigateTo({ url: `/pages/buyer/order-detail?id=${id}` })

// tabBar 页用 onShow 刷新（原 onMounted 未导入会导致订单不加载）
onShow(async () => {
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  // 卡CF（2026-10-05）浏览优先整改：未登录 → 空态，不请求订单接口、不自动跳转
  if (!uni.getStorageSync('token')) {
    authGate.value = 'guest'
    return
  }
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  // 卡CF：有 token 但未注册/待审核 → 空态，不打 /order
  if (uni.getStorageSync('accountStatus') !== 2) {
    authGate.value = 'pending'
    return
  }
  authGate.value = 'ok'
  load()
})
</script>

<style lang="scss" scoped>
.chips-row { white-space: nowrap; padding: 10px 12px; }
.chip { display: inline-block; padding: 6px 14px; border-radius: 16px; background: #f0f1f3; font-size: 13px; color: $text-second; margin-right: 8px; }
.chip.on { background: $color-primary; color: #fff; }
.order-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.oc-head { display: flex; justify-content: space-between; font-size: 13px; }
.oc-date { color: $text-title; font-weight: 600; }
.oc-status { color: $color-primary; }
.oc-body { display: flex; justify-content: space-between; font-size: 12px; color: $text-second; margin-top: 8px; }
.oc-amount { color: #fa5151; font-weight: 700; }
/* 卡S2：支付状态标签 */
.oc-pay-row { margin-top: 8px; }
.oc-pay { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
.oc-pay-ok { color: #00b96b; background: #e8f8f0; }
.oc-pay-pending { color: #ff6b00; background: #fff3e6; }
.oc-pay-none { color: $text-second; background: #f2f3f5; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
/* 卡CD：失败态重试入口（样式按 goods.vue 既有 .retry-btn 同款） */
.retry-btn { display: inline-block; margin-top: 12px; padding: 7px 22px; border-radius: 16px; border: 1.5px solid $color-primary; color: $color-primary; font-size: 13px; font-weight: 600; }
/* 卡CF：未登录/未过审空态覆盖层（沿用 .empty 居中灰字 + 主色按钮；让出底部 tab 栏） */
.auth-gate {
  position: fixed; left: 0; right: 0; top: 0; bottom: calc(64px + env(safe-area-inset-bottom));
  background: $bg-page; z-index: 900;
  display: flex; align-items: center; justify-content: center;
}
.auth-gate-card { text-align: center; color: $text-placeholder; padding: 60px 0; }
.auth-gate-ico { font-size: 36px; line-height: 1; }
.auth-gate-t1 { margin-top: 10px; font-size: 13px; }
.auth-gate-btn { display: inline-block; margin-top: 16px; padding: 9px 34px; border-radius: 18px; background: $color-primary; color: #fff; font-size: 13px; font-weight: 600; }
</style>
