<template>
  <!-- 卡AL：采购方右下角常驻浮动入口（FAB）＝ AI 下单助手
       只作为「已存在的 /pages/buyer/kefu」的一个新入口，不承载任何对话/语音逻辑（复用现成实现） -->
  <view
    class="ai-order-fab"
    :style="{ bottom: `calc(${offset}px + env(safe-area-inset-bottom))` }"
    aria-label="AI 下单助手"
    @tap="openAssistant"
  >
    <!-- 内联 SVG（对话气泡 + 麦克风合一），不引任何图片文件 -->
    <svg class="ai-order-fab-svg" width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M7 3h14a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z" fill="#fff" />
      <path d="M9.2 21.4 6.3 26.2a.6.6 0 0 0 .84.82l6.6-5.62z" fill="#fff" />
      <rect x="11.1" y="6.6" width="5.8" height="8" rx="2.9" fill="#00B96B" />
      <path d="M9.5 12.4v.5a4.5 4.5 0 0 0 9 0v-.5" stroke="#00B96B" stroke-width="1.7" stroke-linecap="round" />
      <path d="M14 17.6v1.9" stroke="#00B96B" stroke-width="1.7" stroke-linecap="round" />
    </svg>
  </view>
</template>

<script setup>
import { computed } from 'vue'

// offset = 距屏幕底边的距离（px，不含安全区）；各页按「不压住底部栏/吸底条」的实测值传入
const props = defineProps({
  offset: { type: Number, default: 80 },
})

const offset = computed(() => props.offset)

// 入口唯一动作：跳到已经存在的智能下单助手页（不新建第二个助手页、不复刻对话逻辑）
const openAssistant = () => uni.navigateTo({ url: '/pages/buyer/kefu' })
</script>

<style lang="scss" scoped>
.ai-order-fab {
  position: fixed;
  right: 16px;
  /* bottom 由 props.offset 计算（含安全区），见 template 内联 style */
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #00B96B;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 16px rgba(0, 185, 107, 0.38);
  /* 必须低于 BuyerTabBar 的 999，不许盖住底部栏 */
  z-index: 900;
  transition: transform 0.08s ease;
}
.ai-order-fab:active {
  transform: scale(0.94);
}
.ai-order-fab-svg {
  display: block;
}
</style>
