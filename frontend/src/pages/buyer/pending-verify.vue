<template>
  <view class="pv-page">
    <!-- 顶部：状态主视觉 -->
    <view class="pv-hero">
      <view class="pv-icon">{{ cfg.icon }}</view>
      <view class="pv-title">{{ cfg.title }}</view>
      <view class="pv-sub">{{ cfg.sub }}</view>
    </view>

    <!-- 审核进度步骤条 -->
    <view class="pv-card">
      <view class="pv-card-title">📝 审核进度</view>
      <view class="pv-steps">
        <view class="pv-step done">
          <view class="pv-dot">✓</view>
          <view class="pv-step-lbl">
            <text class="pv-step-name">资料提交</text>
            <text class="pv-step-time">已提交</text>
          </view>
        </view>
        <view class="pv-line done"></view>
        <view class="pv-step active">
          <view class="pv-dot">·</view>
          <view class="pv-step-lbl">
            <text class="pv-step-name">运营核实中</text>
            <text class="pv-step-time">预计 24 小时内</text>
          </view>
        </view>
        <view class="pv-line"></view>
        <view class="pv-step">
          <view class="pv-dot"></view>
          <view class="pv-step-lbl">
            <text class="pv-step-name">账号激活</text>
            <text class="pv-step-time">{{ cfg.activeText }}</text>
          </view>
        </view>
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

    <!-- 操作按钮 -->
    <view class="pv-btns">
      <view class="pv-btn ghost" @tap="uploadMore">📎 补充资料</view>
      <view class="pv-btn primary" @tap="previewGoods">{{ cfg.previewLabel }}</view>
    </view>

    <!-- 底部：催办 / 客服 -->
    <view class="pv-footer">
      <text>已超过 24 小时？</text>
      <text class="pv-link" @tap="urge">催办</text>
      <text> · 联系客服 400-XXX-XXXX</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'

// 分角色文案：注册身份不同，审核中页面内容不同
const roleConfig = {
  purchaser: {
    icon: '🏪',
    title: '餐馆账号审核中',
    sub: '运营将在 24 小时内通过电话或上门方式核实您的餐馆真实情况，请保持手机畅通',
    canDo: '完善餐馆资料（营业执照等可随时补传）、查看菜品分类和价格',
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
    canDo: '完善配送资料（健康证等可随时补传）',
    cannotDo: '接单配送',
    activeText: '通过后即可接单配送',
    previewLabel: '🗺️ 线路预览',
  },
}

const cfg = computed(() => {
  const role = uni.getStorageSync('registeredRole') || 'purchaser'
  return roleConfig[role] || roleConfig.purchaser
})

const urge = () => {
  uni.request({
    url: '/api/buyer/urge-verify',
    method: 'POST',
    success: () => uni.showToast({ title: '已催办，运营将尽快介入', icon: 'none' }),
    fail: () => uni.showToast({ title: '已催办', icon: 'none' }),
  })
}
const uploadMore = () => uni.showToast({ title: '资料补充功能即将开放', icon: 'none' })
const previewGoods = () => {
  if (cfg.value.previewLabel.includes('商品')) {
    uni.switchTab({ url: '/pages/buyer/goods' })
  } else {
    uni.showToast({ title: '审核通过后即可查看', icon: 'none' })
  }
}
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
.pv-btn.ghost {
  background: #fff;
  color: $text-title;
  border: 1px solid #e5e7eb;
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
  color: $brand;
  font-weight: 600;
}
</style>
