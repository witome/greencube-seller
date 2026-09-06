<template>
  <view class="page">
    <view class="card" style="text-align:center;padding:24px;">
      <view class="card-title">统一收款码</view>
      <view class="qr" @tap="t('平台统一收款码，配送员不接触现金')">🔳<br><text style="font-size:11px;color:#9aa1ab;">支付码占位</text></view>
      <view class="notice" style="margin-top:12px;">⚠️ 客户称已支付请标记，实际以服务端回调为准，配送员不作核销依据</view>
    </view>

    <view class="card">
      <view class="form-row"><view class="fr-l">订单号</view><view class="fr-r"><input class="ipt" type="number" v-model="orderId" placeholder="输入订单号" /></view></view>
    </view>

    <view class="row-btns">
      <view class="pbtn primary" @tap="markPaid">标记「客户称已支付」</view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'

const orderId = ref('')
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })

const markPaid = async () => {
  if (!orderId.value) { t('请输入订单号'); return }
  const data = await courierApi.markPaid(Number(orderId.value))
  uni.showToast({ title: '已标记', icon: 'success' })
}

onLoad((opts) => {
  if (opts.orderId) orderId.value = opts.orderId
})
</script>

<style lang="scss" scoped>
.qr { margin: 12px auto; width: 160px; height: 160px; border: 1px dashed #c0c6cd; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 40px; }
.form-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
.fr-l { color: $text-second; }
.ipt { text-align: right; }
.row-btns { padding: 12px; }
</style>
