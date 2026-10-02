<template>
  <view class="page">
    <!-- 卡S1（2026-09-29）：本单已在**线上**收到钱（微信支付流水已支付）→ 不能再收现金、也不能再留现金凭证（那就是重复收款） -->
    <view v-if="onlinePaid" class="online-banner">✅ 本单已通过微信支付到账，无需再收现金</view>
    <!-- 「客户称已付」标记（2026-09-19 卡L）：采购方在订单详情点了「我已付款」。
         ⚠️ 这只是客户声明，**不是核销** —— 是否真到账仍以本页拍照留证的凭证为准。 -->
    <view v-else-if="clientClaimed" class="claim-banner">🔔 客户称已付款，请核对是否到账，确认后拍照留证</view>

    <view v-if="!onlinePaid" class="notice">💰 货到付款：请客户扫下方收款码付款，付款成功后拍照留证</view>

    <!-- 订单信息 -->
    <view class="card">
      <view class="form-row"><view class="fr-l">订单号</view><view class="fr-r">{{ orderId || '-' }}</view></view>
      <view class="form-row"><view class="fr-l">店铺</view><view class="fr-r">{{ shopName || '-' }}</view></view>
    </view>

    <!-- 收款二维码：已线上收款时不展示（避免配送员照着码再收一次） -->
    <view v-if="!onlinePaid" class="card qr-card">
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

    <!-- 卡AH（2026-09-30）：标记「客户未付款」的后果说明（橙 = 提醒，不是核销、不动钱） -->
    <view v-if="!onlinePaid" class="unpaid-tip">
      ⚠️ 客户没给钱？点下方「<text class="b">客户未付款</text>」标记 —— 标记后<text class="b">客户侧显示为「未支付」</text>；客户之后用<text class="b">微信</text>付了，会自动变「已付款」，<text class="b">标记自动失效</text>，不用你回来改。
    </view>

    <!-- 底部操作
         卡S2（2026-09-29）：「跳过此单，继续处理」已删除 —— 现金单的唯一出口 = 提交凭证完成收款
         （收不到钱走「异常上报」，不再有"稍后再收"的口子）。
         「继续下一单」是**导航**不是跳过收款：已线上收款的单不需要收现金，必须给它离开动作。
         卡AH（2026-09-30）：新增**次要样式**「客户未付款」—— 橙描边，不与「付款拍照」抢主色。 -->
    <view class="row-btns">
      <view v-if="codFlow && remaining > 0" class="queue-tip">📋 本单收完后还有 {{ remaining }} 单待收款</view>
      <!-- 已线上收款 → 现金动作整块不渲染（只留"继续下一单"）；「客户未付款」也一并消失（钱已到账，标记毫无意义） -->
      <template v-if="!onlinePaid">
        <view class="pbtn primary" :class="{ disabled: submitting }" @tap="takePayProof">📷 付款拍照</view>
        <view v-if="proofPhotos.length" class="pbtn success" :class="{ disabled: submitting }" @tap="submitProof">提交凭证，完成收款</view>
        <view class="pbtn outline" :class="{ disabled: submitting }" @tap="openUnpaidSheet">⚠️ 客户未付款</view>
        <view class="pbtn-hint">「客户未付款」是次要动作，不与「付款拍照」抢主色</view>
      </template>
      <view v-if="onlinePaid && codFlow" class="pbtn plain" :class="{ disabled: submitting }" @tap="goNext">继续下一单</view>
    </view>

    <!-- 卡AH C3 · 「客户未付款」二次确认（半屏，同页实现，**不新增页面文件**）
         出口：确认后回收款队列继续下一单；客户后来又给了钱 → 回本页走「提交凭证」那条路，标记自动撤销。 -->
    <view v-if="unpaidSheet" class="sheet-mask" @tap="closeUnpaidSheet">
      <view class="sheet" @tap.stop>
        <view class="sh-t">确认这单没收到钱？</view>
        <view class="sh-s">标记只是<text class="b">提醒运营注意</text>这一单：不改订单金额、不进结算、不进账单。</view>
        <view class="fld-lb">备注 <text class="fld-hint">（选填，如「客户说下午转」）</text></view>
        <textarea
          v-model="markRemark"
          class="ta"
          maxlength="255"
          placeholder="客户说下午转"
          placeholder-class="ta-ph"
        />
        <view class="sh-green">🔄 客户后来又给了钱？回收款页走「上传凭证」那条路，标记自动撤销 / 改口（或客户线上付款 → 自动失效）</view>
        <view class="sheet-btns">
          <view class="sbtn outline" @tap="closeUnpaidSheet">取消</view>
          <view class="sbtn warn" :class="{ disabled: submitting }" @tap="confirmUnpaid">确认标记</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { courierApi } from '@/api/modules'
import { fullUrl } from '@/api/request'
import { compressToBase64 } from '@/utils/image-compress'

const orderId = ref('')
const shopName = ref('')
const payQr = ref('')
const proofPhotos = ref([])
const submitting = ref(false)
// 交付流程自动进入时（deliver.vue 写入 codQueue，空数组也是标记），收完后接力下一单；
// 从任务列表手动进入时无此标记，保持原有 navigateBack 行为
const codFlow = ref(false)
const remaining = ref(0)
// 「客户称已付」标记（2026-09-19 卡L）：仅提示，不参与核销
const clientClaimed = ref(false)
// 卡S1（2026-09-29）：本单已在**线上**收到钱（微信支付流水 status=1；退款后自动回 false）
// → 本页不得再引导收现金、不得再提交现金凭证
const onlinePaid = ref(false)

/** 队列流转（卡S2：只允许两个入口推进 —— ① 提交凭证成功；② 已线上收款单点「继续下一单」）
 *  还有下一单 → redirectTo 接力；队列空 → 回首页（可带收尾提示）；任务列表入口 → 原样返回 */
const advance = (toastMsg) => {
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
  if (toastMsg) {
    uni.showToast({ title: toastMsg, icon: 'success' })
  }
  setTimeout(() => uni.reLaunch({ url: '/subpkg-courier/pages/home' }), 600)
}

/** 已线上收款单的「继续下一单」（导航，不是跳过收款 —— 本单钱已在线上到账，无需再收现金） */
const goNext = () => {
  if (submitting.value) return
  advance('')
}

// ── 卡AH（2026-09-30）：标记「客户未付款」──
// 只在**未线上到账**时可用（钱已到账的单按钮都不渲染；后端也会拒绝，双保险）
const unpaidSheet = ref(false)
const markRemark = ref('')

const openUnpaidSheet = () => {
  if (submitting.value || onlinePaid.value) return
  markRemark.value = ''
  unpaidSheet.value = true
}

const closeUnpaidSheet = () => {
  if (submitting.value) return
  unpaidSheet.value = false
}

/** 确认标记 → 写 pay_proof.unpaidMark（后端不动金额、不推进状态）→ 回收款队列继续下一单 */
const confirmUnpaid = async () => {
  if (submitting.value) return
  submitting.value = true
  try {
    await courierApi.markUnpaid(Number(orderId.value), markRemark.value)
    unpaidSheet.value = false
    advance('已标记客户未付款')
  } catch (e) {
    // 错误已由 request.js 统一提示（如「该单已通过线上支付到账，无需标记未付款」）
  } finally {
    submitting.value = false
  }
}

// 拍照 → 本地压缩到 300KB 内 → base64 上传
const takePayProof = () => {
  if (submitting.value) return
  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    sizeType: ['compressed'],
    success: async (res) => {
      try {
        const path = res.tempFilePaths[0]
        const base64 = await compressToBase64(path)
        const { url } = await courierApi.uploadImage(base64)
        proofPhotos.value.push(url)
      } catch (e) {
        uni.showToast({ title: e?.msg || '照片上传失败', icon: 'none' })
      }
    },
  })
}

const removePhoto = (i) => proofPhotos.value.splice(i, 1)

const submitProof = async () => {
  // 卡S1：已线上收款 → 不允许再提交现金凭证（重复收款的口子，前端先堵一层）
  if (submitting.value || !proofPhotos.value.length || onlinePaid.value) return
  submitting.value = true
  try {
    await courierApi.submitPayProof(Number(orderId.value), proofPhotos.value)
    advance('收款凭证已提交') // 凭证已落库（payProof），流转到下一单或收尾
  } catch (e) {
    // 错误已由 request.js 统一提示
  } finally {
    submitting.value = false
  }
}

onLoad(async (opts) => {
  orderId.value = opts.orderId || ''
  shopName.value = opts.shopName ? decodeURIComponent(opts.shopName) : ''
  // 任务列表跳进来时会带上标记，先即时显示
  clientClaimed.value = opts.clientClaimed === '1'
  const queue = uni.getStorageSync('codQueue')
  codFlow.value = Array.isArray(queue) // deliver.vue 交付流程写入（空数组也是标记）
  remaining.value = codFlow.value ? queue.length : 0
  try {
    const res = await courierApi.getPayQr()
    payQr.value = res.url || ''
  } catch (e) { /* 忽略 */ }
  // 再以任务列表为准核一次（URL 参数只负责首屏即时显示；深链进来时也能拿到）
  // 拉不到就算了 —— 标记只是提示，绝不能影响既有收款流程
  try {
    const ts = await courierApi.getTodayTasks()
    const hit = ts.flatMap((t) => t.stationList || []).find((s) => String(s.orderId) === String(orderId.value))
    if (hit) {
      clientClaimed.value = !!hit.buyerPaidClaimAt
      onlinePaid.value = !!hit.onlinePaidAt // 卡S1
    }
  } catch (e) { /* 忽略 */ }
  // 卡AH：交付完成页选「客户未付款」跳过来（askUnpaid=1）→ 直接弹二次确认（同页半屏，不新增页面）
  if (opts.askUnpaid === '1' && !onlinePaid.value) openUnpaidSheet()
})
</script>

<style lang="scss" scoped>
.page { padding-bottom: 30px; }
.notice { background: $warn-soft; color: $warn; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 10px 12px; }
/* 「客户称已付」标记（2026-09-19 卡L）：橙色 = 仅客户声明，绿色留给「已收款留证」 */
.claim-banner { background: #fff3e6; color: #ff6b00; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 10px 12px -4px; font-weight: 600; }
/* 「已线上收款」（卡S1 2026-09-29）：钱真的到账了 → 绿色，且这一页不再给任何收现金的动作 */
.online-banner { background: #e8f8f0; color: #00b96b; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin: 10px 12px -4px; font-weight: 600; }
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
/* 卡AH：「客户未付款」的**次要样式**（橙描边）—— 明确不与「付款拍照」抢主色（原型 C2） */
.pbtn.outline { background: #fff; border: 1px solid #d5dae0; color: #c87000; font-weight: 600; }
.pbtn-hint { text-align: center; font-size: 12px; color: $text-placeholder; margin-top: -4px; }
/* 卡AH：标记后果说明（橙 = 提醒/展示，**不是核销、不动钱**） */
.unpaid-tip { background: #fff3e6; color: #c87000; font-size: 12px; line-height: 1.7; padding: 10px 12px; border-radius: 8px; margin: 6px 12px; }
.unpaid-tip .b { font-weight: 700; color: #c87000; }

/* 卡AH C3：二次确认半屏（同页实现，不新增页面文件） */
.sheet-mask { position: fixed; left: 0; right: 0; top: 0; bottom: 0; background: rgba(0, 0, 0, 0.34); display: flex; align-items: flex-end; z-index: 99; }
.sheet { width: 100%; background: #fff; border-radius: 16px 16px 0 0; padding: 14px 14px 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom)); box-sizing: border-box; }
.sh-t { font-size: 15px; font-weight: 800; color: $text-title; }
.sh-s { font-size: 12px; color: $text-second; margin-top: 4px; line-height: 1.6; }
.sh-s .b { color: $text-title; font-weight: 600; }
.fld-lb { font-size: 13px; font-weight: 700; color: $text-title; margin: 10px 0 4px; }
.fld-hint { font-weight: 400; color: $text-second; font-size: 12px; }
.ta { width: 100%; background: #f5f6f8; border-radius: 8px; padding: 8px 10px; font-size: 13px; color: $text-body; line-height: 1.6; min-height: 60px; box-sizing: border-box; }
.ta-ph { color: $text-placeholder; }
.sh-green { background: #e8f8f0; color: #00995a; border: 1px solid #c9f0dd; font-size: 12px; line-height: 1.65; font-weight: 600; border-radius: 8px; padding: 8px 10px; margin: 10px 0 0; }
.sheet-btns { display: flex; gap: 9px; margin-top: 10px; }
.sbtn { flex: 1; text-align: center; padding: 12px; border-radius: 22px; font-size: 15px; font-weight: 700; }
.sbtn.outline { border: 1px solid #d5dae0; color: #4b5563; background: #fff; }
.sbtn.warn { flex: 1.4; background: #ff8f1f; color: #fff; }
</style>
