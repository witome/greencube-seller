<template>
  <view class="page">
    <!-- 接单状态卡片 -->
    <view class="status-card">
      <view class="sc-row">
        <text class="sc-label">上线状态</text>
        <view :class="['switch', { on: status.online === 1 }]" @tap="toggleOnline">
          <view class="switch-dot"></view>
        </view>
        <text :class="['sc-val', status.online === 1 ? 'ok' : 'off']">{{ status.online === 1 ? '上线中' : '已下线' }}</text>
      </view>
      <view class="sc-row">
        <text class="sc-label">接单模式</text>
        <view :class="['switch', { on: status.autoAccept === 1 }]" @tap="toggleAutoAccept">
          <view class="switch-dot"></view>
        </view>
        <text class="sc-val">{{ status.autoAccept === 1 ? '自动接单' : '手动接单' }}</text>
      </view>
      <view class="sc-status">
        <text v-if="status.online !== 1" class="sc-off">已下线，上线后方可接单</text>
        <text v-else-if="status.onRoute === 1" class="sc-route">🚚 配送中，无法接新单（配送完自动恢复）</text>
        <text v-else class="sc-free">✅ 空闲可接单 · 当前 {{ status.activeTasks }} 个任务</text>
      </view>
      <!-- 出发按钮：有任务且空闲时显示 -->
      <view v-if="status.online === 1 && status.onRoute === 0 && status.activeTasks > 0" class="depart-btn" @tap="doDepart">
        🚀 取完货，出发配送
      </view>
    </view>

    <view class="home-head">
      <view class="hello">🚚 配送任务</view>
      <view class="addr">进行中 {{ activeTasks.length }} 个 · 已完成 {{ doneTasks.length }} 单</view>
    </view>

    <view v-for="t in activeTasks" :key="t.taskId" class="task-card">
      <view class="tc-head">
        <text class="tc-route">{{ t.routeNo }}</text>
        <text :class="['tag', statusClass(t.status)]">{{ taskStatusText(t) }}</text>
      </view>
      <view class="tc-stations">{{ deliverStations(t).length }} 件货物 · {{ pickedCount(t) }}/{{ deliverStations(t).length }} 已取</view>
      <!-- 货物（订单）列表：取货 + 异常上报 + 已取状态 -->
      <view v-for="s in deliverStations(t)" :key="s.orderId" :class="['cargo-item', { abnormal: s.abnormal }]">
        <view class="cargo-main">
          <view class="cargo-name">{{ s.shopName }}<text v-if="s.abnormal" class="cargo-abnormal-tag">异常</text></view>
          <view class="cargo-addr">{{ s.address }}</view>
          <view v-if="s.items && s.items.length" class="cargo-items">{{ s.items.map(i => `${i.name}×${i.qty}${i.unit}`).join('、') }}</view>
        </view>
        <view class="cargo-ops">
          <text v-if="s.abnormal" class="cargo-abnormal">⚠️ 异常</text>
          <text v-else-if="s.picked" class="cargo-picked">✓ 已取</text>
          <view v-else class="cargo-btn pickup" @tap="doPickup(s.orderId)">取货</view>
          <view v-if="!s.abnormal" class="cargo-btn report" @tap="doReport(t, s)">异常上报</view>
          <view v-if="!s.abnormal && s.payMethod === 2" class="cargo-btn cod" @tap="goCodPay(s)">货到付款</view>
        </view>
      </view>
      <!-- 底部操作：取货 → 出发 → 交付确认；异常任务可「完成」 -->
      <view class="cargo-actions">
        <view v-if="t.status === 0" class="cargo-deliver pickup" @tap="doPickupAll(t)">📦 取货</view>
        <view v-if="t.status === 1" class="cargo-deliver wait">⏳ 待出发</view>
        <view v-if="t.status === 2" class="cargo-deliver" @tap="goDeliver(t)">✅ 交付确认</view>
        <view v-if="t.status === 4" class="cargo-deliver done" @tap="goDeliver(t)">✅ 完成异常任务</view>
      </view>
    </view>
    <view v-if="!activeTasks.length && !doneTasks.length" class="empty">今日暂无配送任务</view>

    <!-- 已完成订单（灰色展示在底部） -->
    <view v-if="doneTasks.length" class="done-section">
      <view class="done-title">✅ 已完成订单（{{ doneTasks.length }}）</view>
      <view v-for="t in doneTasks" :key="t.taskId" class="task-card done-card">
        <view class="tc-head">
          <text class="tc-route">{{ t.routeNo }}</text>
          <text class="done-tag">已完成</text>
        </view>
        <view v-for="s in deliverStations(t)" :key="s.orderId" class="cargo-item">
          <view class="cargo-main">
            <view class="cargo-name">{{ s.shopName }}</view>
            <view class="cargo-addr">{{ s.address }}</view>
          </view>
          <text class="cargo-picked">✓ 已交付</text>
        </view>
      </view>
    </view>

    <CustomTabBar :tabs="courierTabs" active="/subpkg-courier/pages/home" />
    <!-- #ifdef MP-WEIXIN -->
    <DevRoleSwitcher />
    <!-- #endif -->
  </view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import { useNewOrderAlerter } from '@/utils/new-order-alerter'
// #ifdef MP-WEIXIN
import DevRoleSwitcher from '@/components/DevRoleSwitcher.vue'
// #endif
import CustomTabBar from '@/components/CustomTabBar.vue'

const tasks = ref([])
const status = reactive({ online: 0, autoAccept: 0, onRoute: 0, activeTasks: 0 })

// 新单语音提示（2026-09-12 拍板 1A）：30s 轮询现有接口，比对任务内订单 id，新单播预置音频
// 首次=基线不播；同单只播一次；onHide 停/onShow 启（见 @/utils/new-order-alerter）
useNewOrderAlerter(async () => {
  const ts = await courierApi.getTodayTasks()
  return ts.flatMap((t) => (t.stationList || []).filter((s) => s.type === 'deliver').map((s) => s.orderId))
}, { tag: 'courier-tasks' })

const courierTabs = [
  { path: '/subpkg-courier/pages/home', icon: '📋', label: '今日任务' },
  { path: '/subpkg-courier/pages/task-detail', icon: '🧭', label: '配送' },
  { path: '/subpkg-courier/pages/deliver', icon: '✅', label: '交付' },
  { path: '/subpkg-courier/pages/mine', icon: '👤', label: '我的' },
]

const statusText = (s) => ({ 0: '待取货', 1: '待出发', 2: '配送中', 3: '已完成', 4: '异常' }[s] || '未知')
const statusClass = (s) => ({ 0: 'o', 1: 'b', 2: 'b', 3: 'g', 4: 'r' }[s] || 'gray')

// 任务状态文案：待取货时若已取部分货物则显示「取货中」
const taskStatusText = (t) => {
  if (t.status === 0) return pickedCount(t) > 0 ? '取货中' : '待取货'
  return statusText(t.status)
}

// 货物（订单）级：取任务里的送货站点
const deliverStations = (t) => (Array.isArray(t.stationList) ? t.stationList.filter((s) => s.type === 'deliver') : [])
const pickedCount = (t) => deliverStations(t).filter((s) => s.picked).length

// 进行中（待取货/已取货待出发/配送中/异常）与已完成（status=3）分离
const activeTasks = computed(() => tasks.value.filter((t) => t.status === 0 || t.status === 1 || t.status === 2 || t.status === 4))
const doneTasks = computed(() => tasks.value.filter((t) => t.status === 3))

const goDetail = (taskId) => uni.navigateTo({ url: `/subpkg-courier/pages/task-detail?taskId=${taskId}` })

const doPickup = async (orderId) => {
  await courierApi.pickupOrder(orderId)
  uni.showToast({ title: '已取货', icon: 'success' })
  load()
}

// 任务级一键取货（底部「取货」按钮）：任务 0→1，全部订单标记已取
const doPickupAll = async (t) => {
  await courierApi.pickupScan(t.taskId)
  uni.showToast({ title: '已取货', icon: 'success' })
  load()
}

const doReport = (t, s) => {
  uni.navigateTo({ url: `/subpkg-courier/pages/report?taskId=${t.taskId}&orderId=${s.orderId}` })
}

const goCodPay = (s) => {
  uni.navigateTo({ url: `/subpkg-courier/pages/cod-pay?orderId=${s.orderId}&shopName=${encodeURIComponent(s.shopName || '')}` })
}

const goDeliver = (t) => {
  // 已出发(2)或异常(4)任务均可交付/完成
  if (t.status !== 2 && t.status !== 4) {
    uni.showToast({ title: t.status === 1 ? '请先点「出发」再交付' : '请先取完所有货物再交付', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/subpkg-courier/pages/deliver?taskId=${t.taskId}` })
}

const load = async () => {
  tasks.value = await courierApi.getTodayTasks()
  Object.assign(status, await courierApi.getStatus())
}

const toggleOnline = async () => {
  const next = status.online === 1 ? 0 : 1
  await courierApi.setOnline(next)
  status.online = next
  uni.showToast({ title: next === 1 ? '已上线' : '已下线', icon: 'none' })
}

const toggleAutoAccept = async () => {
  const next = status.autoAccept === 1 ? 0 : 1
  await courierApi.setAutoAccept(next)
  status.autoAccept = next
  uni.showToast({ title: next === 1 ? '已切换自动接单' : '已切换手动接单', icon: 'none' })
}

const doDepart = async () => {
  try {
    await courierApi.depart()
    uni.showToast({ title: '已出发，配送中', icon: 'success' })
    load() // 重新拉取任务，刷新状态（待出发→配送中）
  } catch (e) {
    // 后端返回「还有货物未取」等提示，由请求封装统一 toast
  }
}

onShow(() => {
  load()
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.status-card { background: #fff; border-radius: 8px; padding: 14px; margin: 12px; }
.sc-row { display: flex; align-items: center; padding: 8px 0; }
.sc-label { font-size: 14px; color: $text-title; width: 70px; }
.sc-val { font-size: 14px; margin-left: 10px; font-weight: 600; color: $text-title; }
.sc-val.ok { color: $color-primary; }
.sc-val.off { color: $text-placeholder; }
.switch { width: 46px; height: 26px; border-radius: 13px; background: #e5e7eb; position: relative; transition: background .2s; }
.switch.on { background: $color-primary; }
.switch-dot { width: 22px; height: 22px; border-radius: 50%; background: #fff; position: absolute; top: 2px; left: 2px; transition: left .2s; }
.switch.on .switch-dot { left: 22px; }
.sc-status { margin-top: 8px; padding-top: 10px; border-top: 1px solid #f0f1f3; font-size: 13px; }
.sc-off { color: $text-placeholder; }
.sc-route { color: #ff8f1f; }
.sc-free { color: $color-primary; }
.depart-btn { margin-top: 10px; background: $color-primary; color: #fff; text-align: center; padding: 11px; border-radius: 22px; font-size: 15px; font-weight: 600; }
.home-head { padding: 4px 12px 12px; }
.hello { font-size: 18px; font-weight: 700; color: $text-title; }
.addr { font-size: 12px; color: $text-second; margin-top: 4px; }
.task-card { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.tc-head { display: flex; justify-content: space-between; align-items: center; }
.tc-route { font-weight: 700; color: $text-title; }
.tc-stations { font-size: 12px; color: $text-second; margin-top: 6px; }
.cargo-item { display: flex; justify-content: space-between; align-items: center; padding: 9px 0 0; margin-top: 9px; border-top: 1px solid #f5f6f8; }
.cargo-main { flex: 1; min-width: 0; }
.cargo-name { font-size: 14px; font-weight: 600; color: $text-title; }
.cargo-addr { font-size: 12px; color: $text-second; margin-top: 2px; }
.cargo-items { font-size: 12px; color: $text-second; margin-top: 3px; }
.cargo-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.cargo-picked { color: $color-primary; font-size: 13px; font-weight: 600; }
.cargo-abnormal { color: #fa5151; font-size: 13px; font-weight: 600; }
.cargo-abnormal-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; background: #fa5151; color: #fff; font-size: 10px; border-radius: 8px; font-weight: 400; }
.cargo-item.abnormal { opacity: 0.7; }
.cargo-btn { padding: 5px 14px; border-radius: 14px; font-size: 12px; }
.cargo-btn.pickup { background: $color-primary; color: #fff; }
.cargo-btn.report { background: #fff4e6; color: #e6a23c; }
.cargo-btn.cod { background: #fff0e6; color: #ff8f1f; }
.cargo-actions { display: flex; gap: 8px; margin-top: 10px; }
.cargo-deliver { flex: 1; background: $color-primary; color: #fff; text-align: center; padding: 9px; border-radius: 20px; font-size: 14px; font-weight: 600; }
.cargo-deliver.disabled { background: #c0c6cd; }
.cargo-deliver.pickup { background: #3b7cff; }
.cargo-deliver.done { background: #ff8f1f; }
.cargo-deliver.wait { background: #c0c6cd; }
.done-section { margin: 4px 12px 12px; }
.done-title { font-size: 13px; color: $text-second; margin: 8px 0; font-weight: 600; }
.done-card { opacity: 0.6; }
.done-tag { font-size: 12px; color: $text-placeholder; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
</style>
