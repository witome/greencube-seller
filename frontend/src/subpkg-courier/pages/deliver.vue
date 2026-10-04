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
      <view class="pbtn primary" :class="{ disabled: !taskId || submitting }" @tap="confirm">确认交付</view>
    </view>

    <!-- 卡AH C1（2026-09-30）：有 COD 待收款单时，把原来的「交付完成，请收款」toast
         换成**半屏两路选择** —— 客户付没付，由配送员在当下明确说出口。
         两条路都进收款页（cod-pay.vue）：① 已付款走既有拍照留证；② 未付款带 askUnpaid=1 直接弹二次确认。
         🟠 取消不设门槛：未选就退出按现状处理（订单已交付，不卡配送员）。 -->
    <view v-if="codSheet" class="sheet-mask">
      <view class="sheet">
        <view class="sh-t">交付完成，本单需要收款</view>
        <view class="sh-s">{{ sheetSub }}</view>
        <view class="sbtn primary" @tap="choosePaid">📷 客户已付款 · 上传收款凭证</view>
        <view class="sbtn outline" @tap="chooseUnpaid">⚠️ 客户未付款 · 标记并继续</view>
        <view class="sbtn ghost" @tap="cancelSheet">取消</view>
      </view>
    </view>

    <CustomTabBar :tabs="courierTabs" active="/subpkg-courier/pages/deliver" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { compressToBase64 } from '@/utils/image-compress'
import CustomTabBar from '@/components/CustomTabBar.vue'

const taskId = ref('')
const remark = ref('')
const amount = ref('-')
const showAmount = ref(false)
const photos = ref([])
// 卡CD（2026-10-04）：交付确认进行中标记 —— deliverConfirm 非幂等，连点会重复交付
const submitting = ref(false)
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })

// 拍照 → 本地压缩到 300KB 内 → base64 上传，拿到 url 加入列表
const takePhoto = () => {
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    sizeType: ['compressed'],
    success: async (res) => {
      try {
        const path = res.tempFilePaths[0]
        const base64 = await compressToBase64(path)
        const { url } = await courierApi.uploadImage(base64)
        photos.value.push(url)
      } catch (e) {
        uni.showToast({ title: e?.msg || '照片上传失败', icon: 'none' })
      }
    },
  })
}

const removePhoto = (i) => photos.value.splice(i, 1)

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

// 卡AH（2026-09-30）：交付完成后的「半屏两路选择」——替代原来的「交付完成，请收款」toast
const codSheet = ref(false)
const sheetSub = ref('')
// 本次交付产生的待收款单（首单进收款页，其余放 codQueue 接力）
let pendingCod = []

const confirm = async () => {
  if (submitting.value) return
  if (!taskId.value) { uni.showToast({ title: '暂无进行中任务', icon: 'none' }); return }
  // 卡CD：页面文案「📸 交付前拍照留痕」——不拍照不允许提交（接口零调用）
  if (!photos.value.length) { uni.showToast({ title: '请先拍摄交付照片', icon: 'none' }); return }
  submitting.value = true
  try {
    const res = await courierApi.deliverConfirm(Number(taskId.value), { photos: photos.value, remark: remark.value })
    // 货到付款自动进收款页（2026-09-19 拍板卡）：后端返回本任务内已送达、payMethod=2
    // 且尚无收款凭证(non-empty photos)的订单。多个 COD 单逐个收（队列存 storage，cod-pay 接力）；
    // 微信支付订单照常回首页不受影响。
    const codOrders = res?.codOrders || []
    if (codOrders.length) {
      // 队列 = 除首单外的剩余待收款单（空数组也写入：向 cod-pay 标记「来自交付流程」）
      uni.setStorageSync('codQueue', codOrders.slice(1))
      pendingCod = codOrders
      const first = codOrders[0]
      const amt = first.amount != null ? `本单 ¥${Number(first.amount).toFixed(2)}` : '本单'
      const rest = codOrders.length - 1
      sheetSub.value = `客户扫码付了吗？选完直接进下一步（${amt}${rest > 0 ? ` · 还有 ${rest} 单待收款` : ''}）`
      codSheet.value = true
    } else {
      uni.removeStorageSync('codQueue')
      uni.showToast({ title: '交付完成', icon: 'success' })
      setTimeout(() => uni.reLaunch({ url: '/subpkg-courier/pages/home' }), 600)
    }
  } finally {
    submitting.value = false
  }
}

/** 进收款页：askUnpaid=1 → 收款页 onLoad 直接弹「客户未付款」二次确认（同页半屏，不新增页面） */
const enterCodPay = (askUnpaid) => {
  const first = pendingCod[0]
  if (!first) { codSheet.value = false; return }
  codSheet.value = false
  const extra = askUnpaid ? '&askUnpaid=1' : ''
  uni.redirectTo({
    url: `/subpkg-courier/pages/cod-pay?orderId=${first.orderId}&shopName=${encodeURIComponent(first.shopName || '')}${extra}`,
  })
}

// ① 客户已付款 → 既有拍照留证流程一行不改
const choosePaid = () => enterCodPay(false)
// ② 客户未付款 → 进二次确认（备注选填）→ 确认后回收款队列继续下一单
const chooseUnpaid = () => enterCodPay(true)
// 取消 → 不设门槛：订单已交付，配送员可稍后从任务列表的「货到付款」再进收款页
const cancelSheet = () => { codSheet.value = false }

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
.page { padding-bottom: 70px; padding-bottom: calc(70px + env(safe-area-inset-bottom)); padding-bottom: calc(70px + var(--ctb-safe-final, env(safe-area-inset-bottom))); } /* 卡BF: 三重声明，env 失效时由 CustomTabBar 写入的 --ctb-safe-final 兜底 */
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

/* 卡AH C1：交付完成后的半屏两路选择（原型：拍照留痕 → 客户付没付二选一） */
.sheet-mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0, 0, 0, 0.34); display: flex; align-items: flex-end; z-index: 99; }
.sheet { width: 100%; background: #fff; border-radius: 16px 16px 0 0; padding: 14px 14px 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom)); box-sizing: border-box; }
.sh-t { font-size: 15px; font-weight: 800; color: $text-title; }
.sh-s { font-size: 12px; color: $text-second; margin-top: 4px; line-height: 1.6; }
.sbtn { border-radius: 22px; padding: 12px 0; text-align: center; font-size: 15px; font-weight: 700; margin-top: 9px; }
.sbtn.primary { background: $color-primary; color: #fff; }
.sbtn.outline { border: 1px solid #d5dae0; color: #c87000; background: #fff; font-weight: 600; }
.sbtn.ghost { color: $text-placeholder; font-weight: 400; font-size: 14px; margin-top: 7px; }
</style>
