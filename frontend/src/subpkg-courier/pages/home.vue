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
      <view class="addr">今日共 {{ tasks.length }} 个任务</view>
    </view>

    <view v-for="t in tasks" :key="t.taskId" class="task-card" @tap="goDetail(t.taskId)">
      <view class="tc-head">
        <text class="tc-route">{{ t.routeNo }}</text>
        <text :class="['tag', statusClass(t.status)]">{{ statusText(t.status) }}</text>
      </view>
      <view class="tc-stations">{{ t.stationList?.length || 0 }} 站</view>
    </view>
    <view v-if="!tasks.length" class="empty">今日暂无配送任务</view>

    <CustomTabBar :tabs="courierTabs" active="/subpkg-courier/pages/home" />
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'

const tasks = ref([])
const status = reactive({ online: 0, autoAccept: 0, onRoute: 0, activeTasks: 0 })

const courierTabs = [
  { path: '/subpkg-courier/pages/home', icon: '📋', label: '今日任务' },
  { path: '/subpkg-courier/pages/task-detail', icon: '🧭', label: '配送' },
  { path: '/subpkg-courier/pages/deliver', icon: '✅', label: '交付' },
  { path: '/subpkg-courier/pages/mine', icon: '👤', label: '我的' },
]

const statusText = (s) => ({ 0: '待取货', 1: '配送中', 3: '已完成', 4: '异常' }[s] || '未知')
const statusClass = (s) => ({ 0: 'o', 1: 'b', 3: 'g', 4: 'r' }[s] || 'gray')

const goDetail = (taskId) => uni.navigateTo({ url: `/subpkg-courier/pages/task-detail?taskId=${taskId}` })

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
  await courierApi.depart()
  status.onRoute = 1
  uni.showToast({ title: '已出发，配送中', icon: 'success' })
}

onShow(() => {
  uni.hideTabBar({ animation: false })
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
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; }
</style>
