<template>
  <!-- 卡AL：采购方右下角常驻浮动入口（FAB）＝ AI 下单助手
       只作为「已存在的 /pages/buyer/kefu」的一个新入口，不承载任何对话/语音逻辑（复用现成实现） -->
  <view
    class="ai-order-fab"
    :style="{ bottom: `calc(${offset}px + env(safe-area-inset-bottom))` }"
    aria-label="AI 下单助手"
    @tap="openAssistant"
  >
    <!-- 卡AM：图标由内联 svg 改为「纯 CSS 画」。
         原因：小程序 WXML 不支持 svg / path / rect 这些标签，编译产物里它们被降级成
         wx:if 条件节点（条件全 undefined）→ 真机上图标整体不渲染，只剩一个空的绿圆。
         现在全部用真实 view 元素拼装，不使用 ::before / ::after 伪元素，不引图片/字体/base64。
         结构：白气泡 + 白小尾巴 + 绿麦头 + 绿 U 形麦架 + 绿麦杆；颜色只用 #FFFFFF / #00B96B。 -->
    <view class="ai-order-fab-icon">
      <!-- 气泡主体：白色圆角矩形（26×21，圆角 7px） -->
      <view class="ai-order-fab-bubble"></view>
      <!-- 气泡小尾巴：右下角白色三角（border 拼，不用 rotate） -->
      <view class="ai-order-fab-tail"></view>
      <!-- 麦克风 · 麦头：6×10 绿色圆角条 -->
      <view class="ai-order-fab-mic-head"></view>
      <!-- 麦克风 · 麦架：绿色 U 形弧（左右下三边 border + 圆角） -->
      <view class="ai-order-fab-mic-arc"></view>
      <!-- 麦克风 · 麦杆：2×3 绿色小竖条 -->
      <view class="ai-order-fab-mic-stem"></view>
    </view>
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

/* ===== 卡AM：图标本体（28×28 画布，纯 CSS，无伪元素） ===== */
.ai-order-fab-icon {
  position: relative;
  width: 28px;
  height: 28px;
}
/* 气泡主体：白色圆角矩形 */
.ai-order-fab-bubble {
  position: absolute;
  left: 1px;
  top: 1px;
  width: 26px;
  height: 21px;
  border-radius: 7px;
  background: #FFFFFF;
}
/* 气泡小尾巴：右下角白色三角（零宽高 + border-top 拼出，不用 rotate） */
.ai-order-fab-tail {
  position: absolute;
  left: 16px;
  top: 21px;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #FFFFFF;
}
/* 麦头：绿色圆角条 */
.ai-order-fab-mic-head {
  position: absolute;
  left: 11px;
  top: 5px;
  width: 6px;
  height: 10px;
  border-radius: 3px;
  background: #00B96B;
}
/* 麦架：U 形弧（只留左/右/下三边，底部两角给大圆角） */
.ai-order-fab-mic-arc {
  position: absolute;
  left: 8px;
  top: 12px;
  width: 12px;
  height: 7px;
  box-sizing: border-box;
  border-left: 1.5px solid #00B96B;
  border-right: 1.5px solid #00B96B;
  border-bottom: 1.5px solid #00B96B;
  border-radius: 0 0 7px 7px;
}
/* 麦杆：绿色小竖条 */
.ai-order-fab-mic-stem {
  position: absolute;
  left: 13px;
  top: 17px;
  width: 2px;
  height: 3px;
  border-radius: 1px;
  background: #00B96B;
}
</style>
