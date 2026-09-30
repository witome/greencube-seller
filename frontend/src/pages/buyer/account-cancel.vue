<template>
  <view class="cancel-page">
    <!-- 加载 / 失败 -->
    <view v-if="loading" class="cancel-empty">加载中…</view>
    <view v-else-if="loadError" class="cancel-empty cancel-retry" @tap="loadEligibility">资料加载失败，点击重试</view>

    <!-- 屏② 条件检查 -->
    <template v-else-if="step === 'check'">
      <view class="cancel-head">
        <view class="cancel-title">注销账号</view>
        <view class="cancel-sub">注销前，需要先处理完以下事项：</view>
      </view>

      <!-- ②-A 不满足：列出卡点，右侧「去处理」，底部按钮置灰 -->
      <template v-if="!canCancel">
        <view v-for="b in blockers" :key="b.type" class="cancel-block">
          <view class="cancel-block-main">
            <view class="cancel-block-t">{{ b.type === 'orders' ? '进行中的订单' : '未结清账款' }}</view>
            <view class="cancel-block-v">{{ blockValue(b) }}</view>
          </view>
          <view class="cancel-block-act" @tap="goHandle(b)">去处理 ›</view>
        </view>
        <view class="cancel-warn">有进行中订单或未结清账款时，不允许注销</view>
        <view class="cancel-btn cancel-btn-disabled">注销账号</view>
      </template>

      <!-- ②-B 满足：绿色可注销 + 三条说明 + 红色「申请注销」 -->
      <template v-else>
        <view class="cancel-okbar">当前可以注销</view>
        <view class="cancel-oklist">
          <view class="cancel-okitem"><text class="cancel-tick">✓</text>无进行中的订单</view>
          <view class="cancel-okitem"><text class="cancel-tick">✓</text>无未结清账款</view>
          <view class="cancel-okitem"><text class="cancel-tick">✓</text>同一微信号可重新注册，需重新审核，历史数据不恢复</view>
        </view>
        <view class="cancel-btn cancel-btn-danger" @tap="goConfirm">申请注销</view>
      </template>
    </template>

    <!-- 屏③ 二次确认 -->
    <template v-else-if="step === 'confirm'">
      <view class="cancel-head">
        <view class="cancel-title">确认注销账号</view>
      </view>
      <view class="cancel-dangerbar">注销为危险操作，不可恢复</view>
      <view class="cancel-effects">
        <view class="cancel-effect"><text class="cancel-dot">·</text>个人信息、收货地址将被清空，不可恢复</view>
        <view class="cancel-effect"><text class="cancel-dot">·</text>历史订单与账款依规保留，但不再关联本人</view>
        <view class="cancel-effect"><text class="cancel-dot">·</text>进行中订单、未结清账款须先处理完</view>
        <view class="cancel-effect"><text class="cancel-dot">·</text>同一微信号可重新注册，需重新审核，历史数据不恢复</view>
      </view>
      <view class="cancel-agree" @tap="agreed = !agreed">
        <view :class="['cancel-check', { 'cancel-check-on': agreed }]">{{ agreed ? '✓' : '' }}</view>
        <text class="cancel-agree-t">我已知晓以上后果</text>
      </view>
      <view class="cancel-btnrow">
        <view class="cancel-btn cancel-btn-plain" @tap="step = 'check'">再想想</view>
        <view :class="['cancel-btn', 'cancel-btn-danger', { 'cancel-btn-disabled': !agreed }]" @tap="submitCancel">
          {{ submitting ? '处理中…' : '确认注销' }}
        </view>
      </view>
    </template>

    <!-- 屏④ 注销成功 -->
    <template v-else>
      <view class="cancel-done">
        <view class="cancel-done-ico">✓</view>
        <view class="cancel-done-t">账号已注销</view>
      </view>
      <view class="cancel-oklist">
        <view class="cancel-okitem"><text class="cancel-tick">✓</text>个人信息与收货地址已删除</view>
        <view class="cancel-okitem"><text class="cancel-tick">✓</text>历史订单与账款记录已存档（不再关联本人）</view>
        <view class="cancel-okitem"><text class="cancel-tick">✓</text>账号已注销，可重新注册</view>
      </view>
      <view class="cancel-btn cancel-btn-primary" @tap="goRegister">重新注册</view>
      <view class="cancel-btn cancel-btn-plain" @tap="goBrowse">先不注册</view>
      <view class="cancel-footnote">
        浏览状态下可查看商品，价格不可见（与未注册一致）；重新注册需业务员重新核实，历史数据不恢复。
      </view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'
import { clearIdentityMemory } from '@/utils/logout'
import { guardBuyerSuspended } from '@/utils/account-guard'

/// 屏位：check（条件检查）→ confirm（二次确认）→ done（成功）
const step = ref('check')
const loading = ref(true)
const loadError = ref(false)
const eligibility = ref({ canCancel: false, blockers: [] })
const agreed = ref(false)
const submitting = ref(false)

const canCancel = computed(() => !!eligibility.value.canCancel)
const blockers = computed(() => eligibility.value.blockers || [])

const money = (n) => (n === null || n === undefined ? '0.00' : Number(n).toFixed(2))
const blockValue = (b) => (b.type === 'orders' ? `${b.count} 个` : `¥${money(b.amount)}`)

/// 卡点「去处理」：订单类跳订单列表（tabBar 页用 switchTab），账款类跳月度对账单
const goHandle = (b) => {
  if (b.type === 'orders') {
    uni.switchTab({ url: '/pages/buyer/order-list' })
  } else {
    uni.navigateTo({ url: '/pages/buyer/bill' })
  }
}

const loadEligibility = async () => {
  loading.value = true
  loadError.value = false
  try {
    eligibility.value = await buyerApi.getCancelEligibility()
  } catch (e) {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const goConfirm = () => {
  agreed.value = false
  step.value = 'confirm'
}

const submitCancel = async () => {
  if (!agreed.value || submitting.value) return
  submitting.value = true
  try {
    await buyerApi.cancelAccount()
    step.value = 'done'
  } catch (e) {
    // request 层已 toast 具体原因。被门槛拒绝时回到检查态并刷新卡点（页面可能停在旧数据上）
    await loadEligibility()
    step.value = 'check'
  } finally {
    submitting.value = false
  }
}

/// 注销成功后的两个出口：都复用 utils/logout.js 的清身份记忆（与退出登录同一份，不另写）
/// ⚠️ 不清 token —— 注销只作用于采购方身份，账号本身还在：
///    「重新注册」要带着登录态去注册页（/buyer/register 需要 token），
///    「先不注册」回浏览态也需要登录态（未注册看价口径依赖 accountStatus=null 的已登录用户）。
const goRegister = () => {
  clearIdentityMemory()
  uni.reLaunch({ url: '/pages/buyer/register' })
}
const goBrowse = () => {
  clearIdentityMemory()
  uni.reLaunch({ url: '/pages/buyer/home' })
}

onShow(async () => {
  // 停用态(5)由既有守卫拦到停用提示页 —— 本页不该出现注销入口
  if (await guardBuyerSuspended()) return
  // 已注销 / 停在确认页：不重拉资格接口（档案已解绑，再拉会 404；确认页要保住勾选态）
  if (step.value === 'done' || step.value === 'confirm') return
  await loadEligibility()
})
</script>

<style lang="scss" scoped>
.cancel-page {
  min-height: 100vh; background: $bg-page; padding: 14px 12px 40px; box-sizing: border-box;
}
.cancel-empty { text-align: center; color: $text-placeholder; font-size: 13px; padding: 60px 0; }
.cancel-retry { color: $info; }

/* ── 页头 ── */
.cancel-head { margin-bottom: 12px; }
.cancel-title { font-size: 18px; font-weight: 800; color: $text-title; }
.cancel-sub { font-size: 12px; color: $text-second; margin-top: 4px; }

/* ── 卡点项（屏②-A）── */
.cancel-block {
  display: flex; align-items: center; background: #fff; border-radius: 12px;
  padding: 14px; margin-bottom: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.cancel-block-main { flex: 1; min-width: 0; }
.cancel-block-t { font-size: 14px; font-weight: 600; color: $text-title; }
.cancel-block-v { font-size: 13px; color: #FF8F1F; font-weight: 700; margin-top: 3px; }
.cancel-block-act { font-size: 13px; color: $brand; font-weight: 600; white-space: nowrap; }
.cancel-warn { font-size: 12px; color: #FA5151; margin: 2px 4px 14px; }

/* ── 可注销（屏②-B）── */
.cancel-okbar {
  background: #E6F9F0; border: 1px solid #C9F0DD; color: #00B96B;
  border-radius: 10px; padding: 12px 14px; font-size: 14px; font-weight: 700; margin-bottom: 10px;
}
.cancel-oklist {
  background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.cancel-okitem { font-size: 13px; color: $text-second; line-height: 1.6; display: flex; gap: 6px; }
.cancel-tick { color: #00B96B; font-weight: 800; }

/* ── 确认页（屏③）── */
.cancel-dangerbar {
  background: #FFF0F0; border: 1px solid #FFD6D6; color: #FA5151;
  border-radius: 10px; padding: 12px 14px; font-size: 13px; font-weight: 700; margin-bottom: 10px;
}
.cancel-effects {
  background: #fff; border-radius: 12px; padding: 14px; margin-bottom: 12px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.cancel-effect { font-size: 13px; color: $text-title; line-height: 1.8; display: flex; gap: 6px; }
.cancel-dot { color: #FA5151; font-weight: 800; }
.cancel-agree { display: flex; align-items: center; gap: 8px; padding: 6px 2px 16px; }
.cancel-check {
  width: 18px; height: 18px; border-radius: 4px; border: 1px solid #C2C8D0; background: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 12px; color: #fff;
}
.cancel-check-on { background: $brand; border-color: $brand; }
.cancel-agree-t { font-size: 13px; color: $text-title; }

/* ── 按钮 ── */
.cancel-btn {
  text-align: center; border-radius: 10px; padding: 13px; font-size: 15px; font-weight: 700;
  background: #fff; color: $text-second; box-shadow: 0 1px 4px rgba(0,0,0,.04); margin-bottom: 10px;
}
.cancel-btn-danger { background: #FA5151; color: #fff; }
.cancel-btn-primary { background: $brand; color: #fff; }
.cancel-btn-plain { background: #fff; color: $text-second; }
.cancel-btn-disabled { background: #E3E6EA; color: #fff; box-shadow: none; }
.cancel-btnrow { display: flex; gap: 10px; margin-top: 6px; }
.cancel-btnrow .cancel-btn { flex: 1; margin-bottom: 0; }

/* ── 成功页（屏④）── */
.cancel-done { text-align: center; padding: 24px 0 16px; }
.cancel-done-ico {
  width: 56px; height: 56px; border-radius: 50%; background: #E6F9F0; color: #00B96B;
  font-size: 30px; font-weight: 800; margin: 0 auto 12px;
  display: flex; align-items: center; justify-content: center;
}
.cancel-done-t { font-size: 18px; font-weight: 800; color: $text-title; }
.cancel-footnote { font-size: 11px; color: $text-placeholder; line-height: 1.6; margin-top: 12px; }
</style>
