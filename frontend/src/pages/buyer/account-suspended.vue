<!--
  采购方·账号已停用提示页（卡AA 2026-09-30）
  采购方被运营停用（accountStatus=5）后进入小程序的落地页：
  只有提示文案，无申诉按钮、无任何其它操作入口（大辉拍板口径）。
  进入方式：各采购方页面 onShow 经 utils/account-guard.js 统一判定后 reLaunch 到此页。
  布局风格参考 verify-rejected.vue（hero 大图标 + 卡片），但无表单、无按钮。
-->
<template>
  <view class="container">
    <view class="hero">
      <text class="big-emoji">🚫</text>
      <text class="title">账号已停用</text>
      <text class="sub">你的账号已被平台停用，如有疑问请联系平台客服</text>
    </view>
  </view>
</template>

<script setup>
// 刻意空白：本页不提供任何操作（无申诉、无返回、无跳转）。
// 用户被停用后若运营重新启用（accountStatus 2↔5 切回），重新进入小程序任一采购方页
// 即走 guard 判定通过，正常使用。
</script>

<style lang="scss" scoped>
/* 布局风格对齐 verify-rejected.vue 的 hero 段（参考其样式，文案与配色不同） */
.container {
  min-height: 100vh;
  background: $bg-page;
  padding: 16px;
  box-sizing: border-box;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56px 0 20px;
}
.big-emoji { font-size: 56px; }
.title {
  margin-top: 12px;
  font-size: 20px;
  font-weight: 700;
  color: #FA5151;
}
.sub {
  margin-top: 8px;
  font-size: 13px;
  color: $text-second;
  text-align: center;
  line-height: 1.6;
}
</style>
