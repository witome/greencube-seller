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
      <view class="fr-l" style="margin-top:8px;" @tap="t('拍照（真实场景接 uni.chooseImage）')">📷 ＋ 拍照留证</view>
    </view>

    <view class="row-btns">
      <view class="pbtn primary" @tap="submit">提交上报</view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'

const reasons = ['缺货', '拒收', '客户不在', '车辆故障', '其他']
const reason = ref('缺货')
const desc = ref('')
const taskId = ref('')
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })

const submit = async () => {
  await courierApi.report({ taskId: Number(taskId.value) || undefined, reason: `${reason.value}：${desc.value}` })
  uni.showToast({ title: '已上报', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 600)
}

onLoad((opts) => {
  if (opts.taskId) taskId.value = opts.taskId
})
</script>

<style lang="scss" scoped>
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 6px 14px; border-radius: 16px; background: #f0f1f3; font-size: 13px; color: $text-second; }
.chip.on { background: $color-primary; color: #fff; }
.ipt { width: 100%; background: #f7f8fa; border-radius: 6px; padding: 8px; font-size: 13px; margin-top: 6px; }
.fr-l { color: $color-primary; font-size: 13px; }
.row-btns { padding: 12px; }
</style>
