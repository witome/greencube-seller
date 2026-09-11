<template>
  <view class="page">
    <view class="notice">📸 交付前拍照留痕。配送员不接触现金。</view>

    <view class="card">
      <view class="card-title">交付确认</view>
      <view class="form-row"><view class="fr-l">任务号</view><view class="fr-r">{{ taskId || '暂无进行中任务' }}</view></view>
      <view v-if="showAmount" class="form-row"><view class="fr-l">订单总金额（货到付款）</view><view class="fr-r amount">{{ amount }}</view></view>
      <view class="form-row">
        <view class="fr-l">现场照片</view>
        <view class="fr-r" @tap="takePhoto">📷 ＋ 拍照</view>
      </view>
      <view v-if="photos.length" class="photo-grid">
        <view v-for="(p, i) in photos" :key="i" class="photo-item">
          <image :src="fullUrl(p)" mode="aspectFill" class="photo-img" />
          <view class="photo-del" @tap="removePhoto(i)">✕</view>
        </view>
      </view>
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
import { fullUrl } from '@/api/request'
import CustomTabBar from '@/components/CustomTabBar.vue'

const taskId = ref('')
const remark = ref('')
const amount = ref('-')
const showAmount = ref(false)
const photos = ref([])
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })

// 拍照 → 转 base64 → 上传，拿到 url 加入列表
const takePhoto = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    success: async (res) => {
      try {
        const path = res.tempFilePaths[0]
        const base64 = await fileToBase64(path)
        const { url } = await courierApi.uploadImage(base64)
        photos.value.push(url)
      } catch (e) {
        uni.showToast({ title: '照片上传失败', icon: 'none' })
      }
    },
  })
}

const removePhoto = (i) => photos.value.splice(i, 1)

// 本地文件转 base64（小程序端 readFile；H5 端 chooseImage 已返回 base64）
const fileToBase64 = (path) => {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (r) => resolve(`data:image/jpeg;base64,${r.data}`),
      fail: reject,
    })
    // #endif
    // #ifndef MP-WEIXIN
    resolve(path)
    // #endif
  })
}

// 查任务订单总金额（仅货到付款订单显示，供配送员与采购方核对交付金额）
const loadAmount = async () => {
  if (!taskId.value) { showAmount.value = false; amount.value = '-'; return }
  try {
    const res = await courierApi.getTaskAmount(Number(taskId.value))
    showAmount.value = !!res.showAmount
    amount.value = res.totalAmount != null ? `¥${Number(res.totalAmount).toFixed(2)}` : '-'
  } catch (e) {
    showAmount.value = false
    amount.value = '-'
  }
}

const courierTabs = [
  { path: '/subpkg-courier/pages/home', icon: '📋', label: '今日任务' },
  { path: '/subpkg-courier/pages/task-detail', icon: '🧭', label: '配送' },
  { path: '/subpkg-courier/pages/deliver', icon: '✅', label: '交付' },
  { path: '/subpkg-courier/pages/mine', icon: '👤', label: '我的' },
]

onShow(() => {
})

const confirm = async () => {
  if (!taskId.value) { uni.showToast({ title: '暂无进行中任务', icon: 'none' }); return }
  await courierApi.deliverConfirm(Number(taskId.value), { photos: photos.value, remark: remark.value })
  uni.showToast({ title: '交付完成', icon: 'success' })
  setTimeout(() => uni.reLaunch({ url: '/subpkg-courier/pages/home' }), 600)
}

onLoad(async (opts) => {
  if (opts.taskId) {
    taskId.value = opts.taskId
    loadAmount()
  } else {
    // 无 taskId（作为 tab 进入）时，自动取当前配送中(已出发)任务
    const tasks = await courierApi.getTodayTasks()
    const current = tasks.find((t) => t.status === 2) || tasks[0]
    if (current) { taskId.value = String(current.taskId); loadAmount() }
  }
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.form-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; font-size: 14px; }
.fr-l { color: $text-second; }
.fr-r { color: $color-primary; }
.amount { color: #fa5151; font-weight: 700; }
.ipt { text-align: right; min-height: 40px; height: 40px; line-height: 40px; }
.row-btns { padding: 12px; }
.disabled { opacity: 0.5; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 0; }
.photo-item { position: relative; width: 72px; height: 72px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; }
.photo-del { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #fa5151; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
</style>
