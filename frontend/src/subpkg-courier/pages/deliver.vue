<template>
  <view class="page">
    <view class="notice">📸 交付前拍照留痕，客户签字确认。配送员不接触现金。</view>

    <view class="card">
      <view class="card-title">交付确认</view>
      <view class="form-row"><view class="fr-l">任务号</view><view class="fr-r">{{ taskId || '暂无进行中任务' }}</view></view>
      <view class="form-row"><view class="fr-l">现场照片</view><view class="fr-r" @tap="t('拍照上传（真实场景接 uni.chooseImage）')">📷 ＋ 拍照</view></view>
      <view class="form-row"><view class="fr-l">客户签名</view><view class="fr-r" @tap="t('电子签名（真实场景用 canvas 手写）')">✍️ 签名区</view></view>
      <view class="form-row"><view class="fr-l">备注</view><view class="fr-r"><input class="ipt" v-model="remark" placeholder="选填" /></view></view>
    </view>

    <view class="row-btns">
      <view class="pbtn primary" :class="{ disabled: !taskId }" @tap="confirm">确认交付</view>
    </view>

    <CustomTabBar :tabs="courierTabs" active="/subpkg-courier/pages/deliver" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import CustomTabBar from '@/components/CustomTabBar.vue'

const taskId = ref('')
const remark = ref('')
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })

const courierTabs = [
  { path: '/subpkg-courier/pages/home', icon: '📋', label: '今日任务' },
  { path: '/subpkg-courier/pages/task-detail', icon: '🧭', label: '配送' },
  { path: '/subpkg-courier/pages/deliver', icon: '✅', label: '交付' },
  { path: '/subpkg-courier/pages/mine', icon: '👤', label: '我的' },
]

onShow(() => {
  uni.hideTabBar({ animation: false })
})

const confirm = async () => {
  if (!taskId.value) { uni.showToast({ title: '暂无进行中任务', icon: 'none' }); return }
  await courierApi.deliverConfirm(Number(taskId.value), { photos: [], signature: '', remark: remark.value })
  uni.showToast({ title: '交付完成', icon: 'success' })
  setTimeout(() => uni.reLaunch({ url: '/subpkg-courier/pages/home' }), 600)
}

onLoad(async (opts) => {
  if (opts.taskId) {
    taskId.value = opts.taskId
  } else {
    // 无 taskId（作为 tab 进入）时，自动取当前进行中任务
    const tasks = await courierApi.getTodayTasks()
    const current = tasks.find((t) => t.status === 1) || tasks[0]
    if (current) taskId.value = String(current.taskId)
  }
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.form-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; font-size: 14px; }
.fr-l { color: $text-second; }
.fr-r { color: $color-primary; }
.ipt { text-align: right; }
.row-btns { padding: 12px; }
.disabled { opacity: 0.5; }
</style>
