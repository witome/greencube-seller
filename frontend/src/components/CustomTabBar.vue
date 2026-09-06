<template>
  <view class="ctb">
    <view
      v-for="t in tabs"
      :key="t.path"
      class="ctb-item"
      @tap="go(t.path)"
    >
      <view class="ctb-ico">{{ t.icon }}</view>
      <view class="ctb-label" :class="{ on: t.path === active }">{{ t.label }}</view>
    </view>
  </view>
</template>

<script setup>
// 自定义底部导航（供应商/配送员分包页使用，替代采购方原生 tabBar）
const props = defineProps({
  tabs: { type: Array, required: true },
  active: { type: String, default: '' },
})

const go = (path) => {
  if (path === props.active) return
  uni.reLaunch({ url: path })
}
</script>

<style lang="scss" scoped>
.ctb {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 50px;
  background: #fff;
  border-top: 1px solid #ebedf0;
  display: flex;
  z-index: 999;
}
.ctb-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.ctb-ico {
  font-size: 18px;
  line-height: 1;
}
.ctb-label {
  font-size: 11px;
  color: #8a9099;
}
.ctb-label.on {
  color: $brand;
  font-weight: 600;
}
</style>
