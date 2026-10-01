<template>
  <!-- 卡AT（2026-10-01）：本页退场为「转发页」—— 没有任何界面，进页即切走。
       页面上不留任何可见元素（也不留 loading 文案）：switchTab 在 onLoad 里同步发起，
       用户看到的就是合并后的「AI下单」页，不会闪一下空白页。 -->
  <view class="kefu-forward"></view>
</template>

<script setup>
import { onLoad } from '@dcloudio/uni-app'

/**
 * 卡AT（2026-10-01）：「智能下单助手」页与「订单草稿」tab 页合并 —— **唯一页面 = pages/buyer/cart**。
 *
 * 本页**退场但保留路由**：历史分享出去的小程序卡片、以及尚未更新的老入口
 * （运营后台配置、聊天记录里的链接）仍然指向 `/pages/buyer/kefu`，
 * 直接删文件会让这些入口点开白屏。所以这里只做一件事：进页立刻 `switchTab` 到合并后的那一页。
 *
 * ⚠️ 页内旧的对话流 / 草稿卡 / 到货通知 / 语音 / 分享实现**已全部删除** ——
 *    它们都搬进了 `pages/buyer/cart.vue`（语音仍复用 `utils/voice-record.js`、
 *    解析仍复用 `utils/ai-order.js` 的 `sendUtterance`），全仓不许有第二份实现。
 */
onLoad(() => {
  uni.switchTab({ url: '/pages/buyer/cart' })
})
</script>

<style lang="scss" scoped>
.kefu-forward { width: 0; height: 0; overflow: hidden; }
</style>
