<template>
  <view class="page">
    <view class="card">
      <view class="card-title">异常类型</view>
      <view class="chip-group">
        <view v-for="r in reasons" :key="r" :class="['chip', { on: reason === r }]" @tap="reason = r">{{ r }}</view>
      </view>
    </view>

    <view class="card">
      <view class="card-title">异常描述</view>
      <textarea class="ipt" v-model="desc" rows="4" placeholder="请描述异常情况" />
      <view :class="['fr-l', { disabled: uploading }]" style="margin-top:8px;" @tap="takePhoto">
        {{ uploading ? '⏳ 上传中…' : '📷 ＋ 拍照留证' }}
      </view>
      <view v-if="photos.length" class="photo-grid">
        <view v-for="(p, i) in photos" :key="i" class="photo-item">
          <image :src="fullUrl(p)" mode="aspectFill" class="photo-img" />
          <view class="photo-del" @tap.stop="removePhoto(i)">✕</view>
        </view>
      </view>
      <view v-if="photos.length" class="photo-tip">已上传 {{ photos.length }}/{{ MAX_PHOTOS }} 张，点右上角 ✕ 可删除</view>
    </view>

    <view class="row-btns">
      <view class="pbtn primary" :class="{ disabled: uploading }" @tap="submit">提交上报</view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { pickPhotos, uploadPhoto, MAX_PHOTOS, remainCount } from '@/utils/photo-upload'

const reasons = ['缺货', '拒收', '客户不在', '车辆故障', '其他']
const reason = ref('缺货')
const desc = ref('')
const taskId = ref('')
const orderId = ref('')

// 已上传照片的可访问 URL（/uploads/xxx）；提交时随表单带上（后端字段名 photos）
const photos = ref([])
const uploading = ref(false)

// 拍照留证（2026-09-19 决策⑦）：可多张、可删、有缩略图、上传中有提示、失败有明确提示。
// 压缩复用 utils/image-compress（经 utils/photo-upload 封装），此处不重复实现压缩。
const takePhoto = async () => {
  if (uploading.value) return
  const remain = remainCount(photos.value)
  if (remain <= 0) { uni.showToast({ title: `最多上传 ${MAX_PHOTOS} 张`, icon: 'none' }); return }

  let paths = []
  try {
    paths = await pickPhotos({ count: remain })
  } catch (e) {
    return // 用户取消，静默返回
  }
  if (!paths.length) return

  uploading.value = true
  let failed = 0
  uni.showLoading({ title: `上传中 1/${paths.length}`, mask: true })
  try {
    for (let i = 0; i < paths.length; i++) {
      uni.showLoading({ title: `上传中 ${i + 1}/${paths.length}`, mask: true })
      try {
        photos.value.push(await uploadPhoto(paths[i]))
      } catch (e) {
        // 业务错误（含「图片过大」）request 层已弹过同文案提示，这里只计数汇总
        failed++
      }
    }
  } finally {
    uni.hideLoading()
    uploading.value = false
  }
  if (failed) uni.showToast({ title: `${failed} 张上传失败，请重试`, icon: 'none' })
}

const removePhoto = (i) => photos.value.splice(i, 1)

const submit = async () => {
  if (uploading.value) { uni.showToast({ title: '照片上传中，请稍候', icon: 'none' }); return }
  await courierApi.report({
    taskId: Number(taskId.value) || undefined,
    orderId: Number(orderId.value) || undefined,
    reason: `${reason.value}：${desc.value}`,
    // 照片 URL 数组（可选：不拍照则不传字段）
    ...(photos.value.length ? { photos: photos.value } : {}),
  })
  uni.showToast({ title: '已上报', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 600)
}

onLoad((opts) => {
  if (opts.taskId) taskId.value = opts.taskId
  if (opts.orderId) orderId.value = opts.orderId
})
</script>

<style lang="scss" scoped>
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 14px; border-radius: 16px; background: #f0f1f3; font-size: 13px; color: $text-second; }
.chip.on { background: $color-primary; color: #fff; }
.ipt { width: 100%; background: #f7f8fa; border-radius: 6px; padding: 8px; font-size: 13px; margin-top: 6px; }
.fr-l { color: $color-primary; font-size: 13px; }
.fr-l.disabled { opacity: 0.5; }
.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.photo-item { position: relative; width: 72px; height: 72px; }
.photo-img { width: 72px; height: 72px; border-radius: 8px; background: #f0f1f3; }
.photo-del { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; background: #fa5151; color: #fff; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.photo-tip { margin-top: 6px; font-size: 11px; color: $text-second; }
.row-btns { padding: 12px; }
.disabled { opacity: 0.5; }
</style>
