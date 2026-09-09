<template>
  <view class="page" v-if="order">
    <view class="notice">⚠️ 缺货才需申报：有货的明细无需改动，仅对缺货的填写「实交量」和「缺货原因」。</view>
    <view class="notice gray">有疑问也可直接联系客服后台处理（客服热线见「我的」页）。</view>

    <view v-for="it in order.items" :key="it.orderItemId" class="declare-item">
      <view class="di-name">{{ it.productName }}</view>
      <view class="di-order">订购 {{ it.qtyOrdered }}{{ it.unit }}</view>
      <view v-if="it.remark" class="di-remark">备注：{{ it.remark }}</view>
      <view class="di-row">
        <text class="di-label">实交量</text>
        <input class="di-input" type="digit" v-model="form[it.orderItemId].qty" placeholder="0" />
        <text class="di-unit">{{ it.unit }}</text>
      </view>
      <view v-if="shortage(it.orderItemId)" class="di-row">
        <text class="di-label">缺货原因</text>
        <input class="di-input wide" v-model="form[it.orderItemId].reason" placeholder="缺货必填原因" />
      </view>
    </view>

    <view class="row-btns">
      <view class="pbtn primary" @tap="submit">提交异常申报</view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'

const order = ref(null)
const orderId = ref('')
const form = reactive({})

const shortage = (itemId) => {
  const f = form[itemId]
  const it = order.value.items.find((i) => i.orderItemId === itemId)
  return f && it && Number(f.qty) < it.qtyOrdered
}

const submit = async () => {
  // 只提交缺货明细：实交量 < 订购量才算缺货；满额/未改的明细不提交
  const shortageItems = []
  for (const it of order.value.items) {
    const raw = form[it.orderItemId]?.qty
    // 空值 = 未改，当作满额；数字（含 0）按实际值判断
    const qty = raw === '' || raw === null || raw === undefined ? it.qtyOrdered : Number(raw)
    if (qty < it.qtyOrdered) shortageItems.push({ it, qty })
  }

  if (!shortageItems.length) {
    uni.showToast({ title: '无缺货明细，有货直接备货即可', icon: 'none' })
    return
  }

  const items = shortageItems.map((x) => ({
    orderItemId: x.it.orderItemId,
    qtyDeclared: x.qty,
    shortageReason: form[x.it.orderItemId]?.reason || '',
  }))

  const missing = items.filter((i) => !i.shortageReason)
  if (missing.length) {
    const name = order.value.items.find((it) => it.orderItemId === missing[0].orderItemId)?.productName
    uni.showToast({ title: `「${name}」缺货需填原因`, icon: 'none' })
    return
  }

  await supplierApi.declareStock(Number(orderId.value), items)
  uni.showToast({ title: '异常申报成功', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 600)
}

onLoad(async (opts) => {
  orderId.value = opts.orderId
  const list = await supplierApi.getStockList()
  order.value = list.find((o) => o.orderId === Number(orderId.value))
  order.value?.items.forEach((it) => {
    form[it.orderItemId] = { qty: it.qtyOrdered, reason: '' } // 默认满额
  })
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 30px; }
.notice { margin: 10px 12px; padding: 8px 12px; background: #FFF3E6; border-radius: 8px; font-size: 12px; color: #ff8f1f; }
.notice.gray { background: #f0f1f3; color: $text-second; }
.declare-item { background: #fff; border-radius: 8px; padding: 12px; margin: 0 12px 10px; }
.di-name { font-size: 15px; font-weight: 700; color: $text-title; }
.di-order { font-size: 12px; color: $text-second; margin: 4px 0 8px; }
.di-remark { font-size: 12px; color: #fa8c16; margin: -4px 0 8px; }
.di-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.di-label { font-size: 13px; color: $text-second; width: 60px; }
.di-input { flex: 1; background: #f7f8fa; border-radius: 6px; padding: 8px 10px; font-size: 14px; min-height: 40px; height: 40px; line-height: 24px; }
.di-input.wide { flex: 2; }
.di-unit { font-size: 13px; color: $text-second; }
.row-btns { padding: 12px; }
</style>
