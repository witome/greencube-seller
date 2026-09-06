<template>
  <view class="page">
    <view v-if="task">
      <view class="card">
        <view class="td-route">{{ task.routeNo }}</view>
        <view :class="['tag', statusClass]">{{ statusText }}</view>
      </view>

      <!-- 站点列表 -->
      <view class="card">
        <view class="card-title">配送路线</view>
        <view v-for="(s, idx) in task.stationList" :key="idx" class="station">
          <view class="st-seq">{{ s.seq }}</view>
          <view class="st-main">
            <view class="st-name">{{ s.type === 'deliver' ? s.shopName : '取货点' }}</view>
            <view class="st-addr">{{ s.address }}</view>
          </view>
        </view>
      </view>

      <view class="row-btns">
        <view v-if="task.status === 0" class="pbtn primary" @tap="pickup">扫码取货</view>
        <view v-if="task.status === 1" class="pbtn primary" @tap="goDeliver">去交付确认</view>
        <view v-if="task.status === 0" class="pbtn" @tap="goReport">异常上报</view>
      </view>
    </view>
    <view v-else class="empty">暂无进行中的配送任务</view>

    <CustomTabBar :tabs="courierTabs" active="/subpkg-courier/pages/task-detail" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'

const task = ref(null)
const taskId = ref('')

const courierTabs = [
  { path: '/subpkg-courier/pages/home', icon: '📋', label: '今日任务' },
  { path: '/subpkg-courier/pages/task-detail', icon: '🧭', label: '配送' },
  { path: '/subpkg-courier/pages/deliver', icon: '✅', label: '交付' },
  { path: '/subpkg-courier/pages/mine', icon: '👤', label: '我的' },
]

const statusText = computed(() => ({ 0: '待取货', 1: '配送中', 3: '已完成', 4: '异常' }[task.value?.status] || '未知'))
const statusClass = computed(() => ({ 0: 'o', 1: 'b', 3: 'g', 4: 'r' }[task.value?.status] || 'gray'))

onShow(() => {
  uni.hideTabBar({ animation: false })
})

const load = async () => {
  const tasks = await courierApi.getTodayTasks()
  task.value = tasks.find((t) => t.taskId === Number(taskId.value)) || null
}

// 无 taskId（作为 tab 进入）时，自动取当前进行中任务
const loadCurrent = async () => {
  const tasks = await courierApi.getTodayTasks()
  const current = tasks.find((t) => t.status === 1) || tasks.find((t) => t.status === 0) || tasks[0]
  if (current) {
    taskId.value = String(current.taskId)
    await load()
  }
}

const pickup = async () => {
  await courierApi.pickupScan(Number(taskId.value))
  uni.showToast({ title: '已取货', icon: 'success' })
  setTimeout(load, 400)
}

const goDeliver = () => uni.navigateTo({ url: `/subpkg-courier/pages/deliver?taskId=${taskId.value}` })
const goReport = () => uni.navigateTo({ url: `/subpkg-courier/pages/report?taskId=${taskId.value}` })

onLoad((opts) => {
  if (opts.taskId) {
    taskId.value = opts.taskId
    load()
  } else {
    loadCurrent()
  }
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.td-route { font-size: 16px; font-weight: 700; color: $text-title; margin-bottom: 6px; }
.station { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f1f3; }
.st-seq { width: 22px; height: 22px; border-radius: 50%; background: $color-primary; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
.st-name { font-size: 14px; font-weight: 600; color: $text-title; }
.st-addr { font-size: 12px; color: $text-second; margin-top: 2px; }
.row-btns { padding: 12px; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }
</style>
