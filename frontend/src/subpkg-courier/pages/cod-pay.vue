<template>
  <view class="page">
    <view class="notice">💰 货到付款：请客户扫下方收款码付款，付款成功后拍照留证</view>

    <!-- 订单信息 -->
    <view class="card">
      <view class="form-row"><view class="fr-l">订单号</view><view class="fr-r">{{ orderId || '-' }}</view></view>
      <view class="form-row"><view class="fr-l">店铺</view><view class="fr-r">{{ shopName || '-' }}</view></view>
    </view>

    <!-- 收款二维码 -->
    <view class="card qr-card">
      <view class="card-title">平台收款码</view>
      <image v-if="payQr" :src="fullUrl(payQr)" mode="aspectFit" class="qr-img" />
      <view v-else class="qr-placeholder">⚠️ 运营后台尚未上传收款二维码</view>
      <view class="qr-tip">请客户扫码支付，配送员不接触现金</view>
    </view>

    <!-- 付款凭证照片 -->
    <view v-if="proofPhotos.length" class="card">
      <view class="photo-grid">
        <view v-for="(p, i) in proofPhotos" :key="i" class="photo-item">
          <image :src="fullUrl(p)" mode="aspectFill" class="photo-img" />
          <view class="photo-del" @tap="removePhoto(i)">✕</view>
        </view>
      </view>
    </view>

    <!-- 底部操作 -->
    <view class="row-btns">
      <view v-if="codFlow && remaining > 0" class="queue-tip">📋 本单收完后还有 {{ remaining }} 单待收款</view>
      <view class="pbtn primary" :class="{ disabled: submitting }" @tap="takePayProof">📷 付款拍照</view>
      <view v-if="proofPhotos.length" class="pbtn success" :class="{ disabled: submitting }" @tap="submitProof">提交凭证，完成收款</view>
      <view v-if="codFlow" class="pbtn plain" :class="{ disabled: submitting }" @tap="skipThis">跳过此单，继续处理</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import { fullUrl } from '@/api/request'

const orderId = ref('')
const shopName = ref('')
const payQr = ref('')
const proofPhotos = ref([])
const submitting = ref(false)
// 交付流程自动进入时（deliver.vue 写入 codQueue，空数组也是标记），收完/跳过后接力下一单；
// 从任务列表手动进入时无此标记，保持原有 navigateBack 行为
const codFlow = ref(false)
const remaining = ref(0)

/** 收完或跳过当前单后的流转：还有下一单 → redirectTo 接力；收完/跳完 → 回首页提示；任务列表入口 → 原样返回 */
const advance = (submitted) => {
  const queue = uni.getStorageSync('codQueue') || []
  if (queue.length) {
    const next = queue.shift()
    uni.setStorageSync('codQueue', queue)
    remaining.value = queue.length
    uni.redirectTo({ url: `/subpkg-courier/pages/cod-pay?orderId=${next.orderId}&shopName=${encodeURIComponent(next.shopName || '')}` })
    return
  }
  uni.removeStorageSync('codQueue')
  if (!codFlow.value) { uni.navigateBack(); return }
  if (submitted) {
    uni.showToast({ title: '收款凭证已提交', icon: 'success' })
  } else {
    uni.showToast({ title: '已跳过，可稍后在任务列表收款', icon: 'none' })
  }
  setTimeout(() => uni.reLaunch({ url: '/subpkg-courier/pages/home' }), 600)
}

const skipThis = () => {
  if (submitting.value) return
  advance(false)
}

// 拍照 → 转 base64 → 上传
const takePayProof = () => {
  if (submitting.value) return
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    success: async (res) => {
      try {
        const path = res.tempFilePaths[0]
        const base64 = await fileToBase64(path)
        const { url } = await courierApi.uploadImage(base64)
        proofPhotos.value.push(url)
      } catch (e) {
        uni.showToast({ title: '照片上传失败', icon: 'none' })
      }
    },
  })
}

const removePhoto = (i) => proofPhotos.value.splice(i, 1)

const submitProof = async () => {
  if (submitting.value || !proofPhotos.value.length) return
  submitting.value = true
  try {
    await courierApi.submitPayProof(Number(orderId.value), proofPhotos.value)
    advance(true) // 凭证已落库（payProof），流转到下一单或收尾
  } catch (e) {
    // 错误已由 request.js 统一提示
  } finally {
    submitting.value = false
  }
}

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

onLoad(async (opts) => {
  orderId.value = opts.orderId || ''
  shopName.value = opts.shopName ? decodeURIComponent(opts.shopName) : ''
  const queue = uni.getStorageSync('codQueue')
  codFlow.value = Array.isArray(queue) // deliver.vue 交付流程写入（空数组也是标记）
  remaining.value = codFlow.value ? queue.length : 0
  try {
    const res = await courierApi.getPayQr()
    payQr.value = res.url || ''
  } catch (e) { /* 忽略 */ }
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 30px; }
.notice { background: $warn-soft; color: $warn; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 10px 12px; }
.card { background: #fff; border-radius: 12px; margin: 6px 12px; padding: 4px 12px; }
.form-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; font-size: 14px; }
.fr-l { color: $text-second; }
.fr-r { color: $text-body; font-weight: 600; }
.qr-card { text-align: center; padding: 16px 12px; }
.card-title { font-size: 15px; font-weight: 700; color: $text-title; text-align: left; }
.qr-img { width: 200px; height: 200px; margin: 12px auto; }
.qr-placeholder { width: 200px; height: 200px; margin: 12px auto; border: 1px dashed #c0c6cd; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; color: $text-second; }
.qr-tip { font-size: 12px; color: $text-second; padding-bottom: 8px; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 0; }
.photo-item { position: relative; width: 72px; height: 72px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; }
.photo-del { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #fa5151; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.row-btns { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.pbtn { text-align: center; padding: 12px; border-radius: 22px; font-size: 15px; font-weight: 600; }
.pbtn.primary { background: $color-primary; color: #fff; }
.pbtn.success { background: #3b7cff; color: #fff; }
.disabled { opacity: 0.6; }
.queue-tip { font-size: 12px; color: $text-second; text-align: center; padding: 2px 0; }
.pbtn.plain { background: #f2f3f5; color: $text-second; }
</style>
