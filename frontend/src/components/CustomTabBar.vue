<template>
  <view class="ctb" :style="padBottom ? { paddingBottom: padBottom + 'px' } : {}">
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
import { ref, onMounted } from 'vue'
import { getSafeBottomPx } from '@/utils/safe-area'

// 自定义底部导航（供应商/配送员分包页使用，替代采购方原生 tabBar）
const props = defineProps({
  tabs: { type: Array, required: true },
  active: { type: String, default: '' },
})

// 卡BF（2026-10-02）：底部安全区适配。只有 JS 兜底值 > 0 才赋值，
// 等于 0 时保持空串，让 CSS 的 env() 兜底生效（避免把 iOS 上正确的 env 值覆盖成 0）。
const padBottom = ref('')
onMounted(() => {
  const jsPx = getSafeBottomPx()
  if (jsPx > 0) padBottom.value = jsPx
  // #ifdef H5
  applySafeVar(jsPx)
  // #endif
})

// #ifdef H5
// 卡BF：把最终安全区值写入 CSS 变量 --ctb-safe-final，供使用页 .page 的
// padding-bottom: calc(70px + var(--ctb-safe-final, 0px)) 消费——
// 老安卓「env() 返回 0 但系统栏占位」时页面留白也要跟上，否则最后一张卡被挡。
// 取 env 探测值与 JS 兜底值的较大者：env 正常的设备（如 iOS）结果与 env 一致，无回归。
function envBottomPx() {
  try {
    if (!window.CSS || !CSS.supports || !CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)')) return 0
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;'
    document.body.appendChild(probe)
    probe.style.paddingBottom = 'env(safe-area-inset-bottom)'
    let px = parseFloat(getComputedStyle(probe).paddingBottom) || 0
    if (!px) {
      probe.style.paddingBottom = 'constant(safe-area-inset-bottom)'
      px = parseFloat(getComputedStyle(probe).paddingBottom) || 0
    }
    probe.remove()
    return Math.round(px)
  } catch (e) {
    return 0
  }
}
function applySafeVar(jsPx) {
  try {
    const px = Math.max(envBottomPx(), jsPx || 0)
    if (px > 0) document.documentElement.style.setProperty('--ctb-safe-final', px + 'px')
  } catch (e) {}
}
// #endif

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
  z-index: 999;
  display: flex;
  background: #fff;
  border-top: 1px solid #ebedf0;
  /* 卡BF：content-box 下 1px border 计入总高（实测 50px→51px，违反零视觉变化约束），
     49 + 1border = 50，与原 border-box 版逐像素一致 */
  height: 49px;
  /* ⚠️ 必须写：uni-app 默认 border-box（uni-h5 基础样式 line 20102），不写会被 padding 挤扁图标 */
  box-sizing: content-box;
  padding-bottom: constant(safe-area-inset-bottom); /* 老 iOS */
  padding-bottom: env(safe-area-inset-bottom); /* 新 iOS + 安卓 */
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
