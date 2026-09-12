<template>
  <view class="pv-page">
    <!-- 顶部：状态主视觉 -->
    <view class="pv-hero">
      <view class="pv-icon">{{ cfg.icon }}</view>
      <view class="pv-title">{{ cfg.title }}</view>
      <view class="pv-sub">{{ cfg.sub }}</view>
    </view>

    <!-- 审核进度步骤条（真实数据：GET /buyer/pending 的 steps；接口不可用时回退静态三步） -->
    <view class="pv-card">
      <view class="pv-card-title">📝 审核进度</view>
      <view v-if="rejectInfo" class="pv-reject">⚠️ {{ rejectInfo }}</view>
      <view class="pv-steps">
        <template v-for="(s, i) in steps" :key="s.key">
          <view v-if="i > 0" class="pv-line" :class="{ done: s.status === 'done' || steps[i-1].status === 'done' && s.status === 'done' }"></view>
          <view class="pv-step" :class="s.status === 'rejected' ? '' : s.status">
            <view class="pv-dot">{{ s.status === 'done' ? '✓' : s.status === 'active' ? '·' : s.status === 'rejected' ? '✕' : '' }}</view>
            <view class="pv-step-lbl">
              <text class="pv-step-name">{{ s.label }}</text>
              <text class="pv-step-time">{{ stepTime(s) }}</text>
            </view>
          </view>
        </template>
      </view>
    </view>

    <!-- 审核期间提示 -->
    <view class="pv-card">
      <view class="pv-tips">
        <view class="pv-tips-line">💡 <text class="b">审核期间您可以：</text></view>
        <view class="pv-tips-item">{{ cfg.canDo }}</view>
        <view class="pv-tips-line mt">❌ <text class="b">暂不可用：</text>{{ cfg.cannotDo }}</view>
      </view>
    </view>

    <!-- 操作按钮（2026-09-11 拍板 A：移除「📎 补充资料」假按钮，驳回走申诉通道；主按钮占全宽） -->
    <view class="pv-btns">
      <view class="pv-btn primary" @tap="previewGoods">{{ cfg.previewLabel }}</view>
    </view>

    <!-- 底部：催办 / 客服 -->
    <view class="pv-footer" :class="{ 'pv-footer-overdue': overdue }">
      <template v-if="overdue">
        <text class="pv-overdue-badge">⏰ 已超过 24 小时</text>
      </template>
      <text>已超过 24 小时？</text>
      <!-- 2026-09-12 催办修复：原 <text @tap> 在 uni-h5 vue3 编译为 onClick、运行时无消费（点击恒无效），
           改 <view @tap>（onTap touch 委托，全仓 view 模式已验证可用）；inline 化保持行内视觉 -->
      <view class="pv-link pv-link-view" @tap="urge">催办</view>
      <text> · 联系客服 400-XXX-XXXX</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { buyerApi } from '@/api/modules'

// 分角色文案：注册身份不同，审核中页面内容不同
const roleConfig = {
  purchaser: {
    icon: '🏪',
    title: '餐馆账号审核中',
    sub: '运营将在 24 小时内通过电话或上门方式核实您的餐馆真实情况，请保持手机畅通',
    canDo: '完善餐馆资料（我的 → 餐馆资料可改店名/地址等）、查看菜品分类和价格',
    cannotDo: '下单、加入购物车、付款',
    activeText: '通过后即可下单',
    previewLabel: '🥬 商品预览',
  },
  supplier: {
    icon: '🥕',
    title: '档口账号审核中',
    sub: '运营将在 24 小时内核实您的档口经营情况，请保持手机畅通',
    canDo: '完善档口资料、查看平台供货需求',
    cannotDo: '接单供货、商品上架',
    activeText: '通过后即可接单供货',
    previewLabel: '📦 供货预览',
  },
  courier: {
    icon: '🚚',
    title: '配送员账号审核中',
    sub: '运营将在 24 小时内核实您的配送资质，请保持手机畅通',
    canDo: '完善配送资料（证件变更请联系运营补录）',
    cannotDo: '接单配送',
    activeText: '通过后即可接单配送',
    previewLabel: '🗺️ 线路预览',
  },
}

const cfg = computed(() => {
  const role = uni.getStorageSync('registeredRole') || 'purchaser'
  return roleConfig[role] || roleConfig.purchaser
})

// 催办：走统一 request 封装（后端 POST /buyer/urge-verify → { urged, nextFollowHours }）
// 成功才提示已催办（附真实跟进时长）；失败如实提示——不允许任何「失败弹成功」分支
const urge = async () => {
  try {
    const r = await buyerApi.urgeVerify()
    const h = r?.nextFollowHours
    uni.showToast({ title: h ? `已催办，运营将在 ${h} 小时内跟进` : '已催办，运营将尽快介入', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: '催办失败，请稍后重试', icon: 'none' })
  }
}
const previewGoods = () => {
  if (cfg.value.previewLabel.includes('商品')) {
    uni.switchTab({ url: '/pages/buyer/goods' })
  } else {
    uni.showToast({ title: '审核通过后即可查看', icon: 'none' })
  }
}

// ── D1：审核进度真实化（GET /buyer/pending：accountStatus/submittedAt/overdue/steps/rejectInfo）──
// 仅采购方注册流程有此接口；supplier/courier 注册调用会 404，此时保持静态文案兜底
const steps = ref([
  { key: 'submit', label: '资料提交', status: 'done', time: null },
  { key: 'verify', label: '运营核实中', status: 'active', time: null },
  { key: 'active', label: '账号激活', status: 'todo', time: null },
])
const overdue = ref(false)
const rejectInfo = ref('')
const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const stepTime = (s) => {
  if (s.status === 'done') return s.time ? `${fmtTime(s.time)} 已完成` : '已完成'
  if (s.status === 'active') return '进行中，预计 24 小时内'
  if (s.status === 'rejected') return '未通过，见上方说明'
  return '待前序完成'
}
onMounted(async () => {
  try {
    const data = await buyerApi.getPending()
    if (data && Array.isArray(data.steps) && data.steps.length) {
      steps.value = data.steps
      overdue.value = !!data.overdue
      rejectInfo.value = data.rejectInfo || ''
    }
  } catch (e) {
    // 非 purchase 档案 / 接口不可用：保持静态文案兜底
  }
})
</script>

<style lang="scss" scoped>
.pv-page {
  min-height: 100vh;
  background: $bg-page;
  padding-bottom: 40px;
}
.pv-hero {
  background: linear-gradient(180deg, #e6f9f0 0%, $bg-page 100%);
  padding: 48px 24px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pv-icon {
  width: 80px;
  height: 80px;
  border-radius: 24px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 44px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}
.pv-title {
  margin-top: 18px;
  font-size: 20px;
  font-weight: 700;
  color: $text-title;
}
.pv-sub {
  margin-top: 10px;
  font-size: 13px;
  color: $text-second;
  text-align: center;
  line-height: 1.6;
}
.pv-card {
  background: #fff;
  border-radius: 12px;
  margin: 12px 16px;
  padding: 16px;
}
.pv-card-title {
  font-size: 15px;
  font-weight: 700;
  color: $text-title;
  margin-bottom: 16px;
}
.pv-steps {
  display: flex;
  align-items: flex-start;
}
.pv-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 80px;
}
.pv-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #e5e7eb;
  color: #fff;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pv-step.done .pv-dot {
  background: $brand;
}
.pv-step.active .pv-dot {
  background: #ff8f1f;
  color: #fff;
  font-weight: 700;
}
.pv-step-lbl {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.pv-step-name {
  font-size: 12px;
  color: $text-title;
  font-weight: 600;
}
.pv-step-time {
  font-size: 10px;
  color: $text-placeholder;
}
.pv-line {
  flex: 1;
  height: 2px;
  background: #e5e7eb;
  margin-top: 10px;
}
.pv-line.done {
  background: $brand;
}
.pv-tips {
  font-size: 13px;
  color: $text-second;
  line-height: 1.7;
}
.pv-tips-line .b {
  font-weight: 700;
  color: $text-title;
}
.pv-tips-item {
  padding-left: 16px;
}
.pv-tips .mt {
  margin-top: 10px;
}
.pv-btns {
  display: flex;
  gap: 12px;
  padding: 0 16px;
  margin-top: 20px;
}
.pv-btn {
  flex: 1;
  text-align: center;
  padding: 12px 0;
  border-radius: 22px;
  font-size: 14px;
  font-weight: 600;
}
.pv-btn.primary {
  background: $brand;
  color: #fff;
}
.pv-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  color: $text-placeholder;
}
.pv-link {
  display: inline; /* view 行内化，保持与前后 text 同行 */
  color: $brand;
  font-weight: 600;
}
.pv-footer-overdue .pv-overdue-badge {
  display: block;
  margin-bottom: 6px;
  color: #fa5151;
  font-weight: 700;
  font-size: 13px;
}
</style>
