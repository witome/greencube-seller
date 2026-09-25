<template>
  <view class="page" v-if="goods">
    <!-- 封面（卡Z1：有封面显真图，无封面回退首字占位） -->
    <view class="gd-cover">
      <image v-if="goods.cover" :src="fullUrl(goods.cover)" mode="aspectFill" class="gd-cover-img" />
      <text v-else>{{ goods.name.slice(0, 1) }}</text>
    </view>

    <view class="card">
      <view class="gd-name">{{ goods.name }}</view>
      <view class="gd-price">¥{{ goods.salePrice }} <text class="gd-unit">/{{ goods.unit }}</text></view>
      <view class="gd-spec">{{ goods.specText || (goods.weighType === 1 ? '称重商品' : '固定规格') }}</view>
      <view class="gd-supply">今日可售 {{ goods.dailySupply }} {{ goods.unit }}</view>
    </view>

    <!-- 称重说明 -->
    <view class="card" v-if="goods.weighType === 1">
      <view class="card-title">称重说明</view>
      <view class="notice">{{ goods.weighNote || '称重商品按实际重量结算，多退少补' }}</view>
    </view>

    <!-- 数量 + 加购 -->
    <view class="gd-bar">
      <view class="stepper">
        <view class="st-btn" @tap="qty = Math.max(1, qty - 1)">−</view>
        <text class="st-num">{{ qty }}</text>
        <view class="st-btn" @tap="qty++">＋</view>
      </view>
      <view class="gd-btn" @tap="addCart">加入购物车</view>
      <view class="gd-btn primary" @tap="buyNow">立即下单</view>
    </view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'

const goods = ref(null)
const qty = ref(1)
const id = ref('')

const addCart = async () => {
  await buyerApi.addToCart({ productId: Number(id.value), qty: qty.value })
  uni.showToast({ title: '已加入购物车', icon: 'success' })
  uni.$emit('cart-badge-refresh')
}

const buyNow = async () => {
  // 配送日期：当天有可选时段用当天，否则顺延次日；自动选最早可用时段（不弹窗）
  let deliveryDate = dateStr()
  let winList = availableTimeWindows(deliveryDate)
  if (!winList.length) {
    deliveryDate = tomorrowStr()
    winList = availableTimeWindows(deliveryDate)
  }
  const w = winList[0]
  const order = await buyerApi.placeOrder({
    deliveryDate, timeWindow: w.value,
    items: [{ productId: Number(id.value), qty: qty.value }],
  })
  uni.redirectTo({ url: `/pages/buyer/order-detail?id=${order.orderId}` })
}

onLoad(async (opts) => {
  id.value = opts.id
  goods.value = await buyerApi.getGoodsDetail(Number(id.value))
})
</script>

<style lang="scss" scoped>
.gd-cover { height: 200px; background: #e6f9f0; display: flex; align-items: center; justify-content: center; font-size: 72px; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
.gd-cover-img { width: 100%; height: 200px; display: block; }
.gd-name { font-size: 18px; font-weight: 700; color: $text-title; }
.gd-price { color: #fa5151; font-size: 22px; font-weight: 700; margin: 8px 0; }
.gd-unit { font-size: 13px; font-weight: 400; color: $text-second; }
.gd-spec { font-size: 13px; color: $text-second; }
.gd-supply { font-size: 12px; color: $color-primary; margin-top: 6px; }
.gd-bar { position: fixed; left: 0; right: 0; bottom: 0; background: #fff; padding: 12px; display: flex; align-items: center; gap: 10px; box-shadow: 0 -2px 8px rgba(0,0,0,.05); }
.stepper { display: flex; align-items: center; gap: 8px; }
.st-btn { width: 28px; height: 28px; border-radius: 50%; background: #f0f1f3; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.st-num { font-size: 15px; font-weight: 600; min-width: 24px; text-align: center; }
.gd-btn { flex: 1; text-align: center; padding: 10px 0; border-radius: 22px; border: 1px solid $color-primary; color: $color-primary; font-size: 14px; font-weight: 600; }
.gd-btn.primary { background: $color-primary; color: #fff; border: none; }
</style>
