<template>
  <!-- 卡AL/AM/AN：采购方右下角常驻浮动入口（FAB）＝ AI 下单助手
       · 点一下 → 切到「AI下单」tab 页 /pages/buyer/cart（卡AT：助手页已并入该页）
       · 按住 300ms → 当场说话（卡AN），松手识别，内容并进**共享草稿**，留在原页
       · 右上角角标 = 共享草稿的**商品种类数**
       ⚠️ 根节点是一层「零尺寸、不进流的定位壳」，唯一目的是**不产生层叠上下文**：
          录音浮层 z-index 必须高于底部栏（999），如果浮层挂在 FAB（z-index:900）里面，
          就会被困在 FAB 的层叠上下文里，永远盖不住底部栏。 -->
  <view class="ai-order-fab-root">
    <view
      class="ai-order-fab"
      :style="{ bottom: fabBottom }"
      aria-label="AI 下单助手"
      @touchstart="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchCancel"
      @tap="onTap"
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

      <!-- 卡AN：角标（共享草稿的商品种类数）。样式对齐 BuyerTabBar 的 .buyer-tabbar-badge。
           刻意用 view 而不是 text —— 让本产物的标签清点 100% 只有 view，一条 text 都不夹 -->
      <view v-if="badgeText" class="ai-order-fab-badge">{{ badgeText }}</view>
    </view>

    <!-- 卡AN：首次「按住说话」提示（看过一次就不再显示；H5 不显示） -->
    <view v-if="tipVisible" class="ai-order-fab-tip" :style="{ bottom: tipBottom }">按住说话，松手就记下了</view>

    <!-- 卡AN：录音浮层（复用助手页同款：全屏半透明遮罩 + 居中卡片 + 实时识别文字） -->
    <view v-if="voiceRecording" class="aifab-rec-mask">
      <view class="aifab-rec-box">
        <view class="aifab-rec-mic">🎤</view>
        <view class="aifab-rec-title">{{ recTitle }}</view>
        <view class="aifab-rec-tip">松开即识别 · 最长 30 秒</view>
      </view>
    </view>

    <!-- 卡AN：松手之后原地飘一条轻提示（不跳页，自动消失）
         卡AO：内容变长 → 2 秒放宽到 3.5 秒；「有菜没上架」的两种提示**可点**（点进助手页看详情）。
         不可点的两种（全匹配 / 真没听清）点了没有任何反应。 -->
    <view
      v-if="pillText"
      class="ai-order-fab-pill"
      :class="{ 'ai-order-fab-pill-tap': pillTappable }"
      :style="{ bottom: pillBottom }"
      @tap="onPillTap"
    >{{ pillText }}</view>
  </view>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { createVoiceHold } from '@/utils/voice-record'
import { itemCount } from '@/utils/ai-draft'
import { sendUtterance } from '@/utils/ai-order'

// offset = 距屏幕底边的距离（px，不含安全区）；各页按「不压住底部栏/吸底条」的实测值传入
const props = defineProps({
  offset: { type: Number, default: 80 },
})

const fabBottom = computed(() => `calc(${props.offset}px + env(safe-area-inset-bottom))`)
const tipBottom = computed(() => `calc(${props.offset + 16}px + env(safe-area-inset-bottom))`)
const pillBottom = computed(() => `calc(${props.offset + 64}px + env(safe-area-inset-bottom))`)

// ── 角标：共享草稿的商品种类数 ─────────────────────────────
// 直接 computed 到共享草稿上 → 进页面 / 从助手页返回 / 说完一句话，都会**自动**重算，
// 不需要任何页面事件去手动刷新（少一个漏刷的点）。
const badgeCount = computed(() => itemCount())
const badgeText = computed(() => (badgeCount.value <= 0 ? '' : badgeCount.value > 99 ? '99+' : String(badgeCount.value)))

// ── 原地轻提示 ─────────────────────────────────────────
// 卡AO：内容从「已记下 2 样 · …」变长到「… ｜ 🤔 秋葵5斤 我还没上架，已帮你记下」→ 2 秒读不完，放宽到 3.5 秒。
// pillTappable：只有「有菜没上架」的两种提示可点（点进助手页，那里有现成的「到货通知我」按钮）。
const PILL_MS = 3500
const pillText = ref('')
const pillTappable = ref(false)
let pillTimer = null
const hidePill = () => {
  if (pillTimer) {
    clearTimeout(pillTimer)
    pillTimer = null
  }
  pillText.value = ''
  pillTappable.value = false
}
const showPill = (t, tappable = false) => {
  pillText.value = t
  pillTappable.value = !!tappable
  if (pillTimer) clearTimeout(pillTimer)
  pillTimer = setTimeout(() => {
    pillText.value = ''
    pillTappable.value = false
    pillTimer = null
  }, PILL_MS)
}
// 提示条可点时 → 进助手页；不可点时点了**啥也不做**（不许误跳页）
const onPillTap = () => {
  if (!pillTappable.value) return
  hidePill()
  openAssistant()
}

// ── 语音（**必须**复用 utils/voice-record.js 的 createVoiceHold：全仓不许有第二份插件调用）──
// 权限兜底（fingerDown）、幂等 stop、安全超时、离页停录全在那边实现，这里一行都不要重写。
const voice = createVoiceHold({
  // 松手识别成功 → 送进共享实现（解析 + 落共享草稿 + 未收录的菜静默登记采购需求 + 记下「有菜没上架」跨页状态）
  // 卡AO（2026-09-30）：提示分四种情况，**绝不把「没这个菜」误报成「没听清」**——
  //   ① 全匹配   ：🎤 已记下 N 样 · 土豆20斤 西红柿10斤
  //   ② 混合     ：🎤 已记下 N 样 · 土豆20斤 ｜ 🤔 秋葵5斤 我还没上架，已帮你记下     ← 可点
  //   ③ 全没上架 ：🤔 秋葵5斤 我还没上架，已帮你记下 · 点我看详情                     ← 可点
  //   ④ 真没听清 ：没听清，请再说一遍
  // ②③ 可点进助手页（订阅/到货通知的按钮只有那边一份，本卡**不复制订阅逻辑**）。
  // 登记没成功（demandRecorded=false）时去掉「已帮你记下」——口径：不做假装记下。
  onDone: async (text) => {
    const res = await sendUtterance(text)
    if (res.error) {
      // 接口失败：草稿保持不变（错误 toast 由 request.js 统一弹，这里不重复弹）
      return
    }
    const items = (res.draft && res.draft.items) || []
    const unmatched = res.unmatched || []
    // 最多列 3 个，超出加 …
    const brief = (arr, sep) => {
      const s = arr.slice(0, 3).join(sep)
      return arr.length > 3 ? `${s}…` : s
    }
    const got = brief(items.map((it) => (it.qtyText ? `${it.name}${it.qtyText}` : it.name)), ' ')
    const miss = brief(unmatched, '、')
    const noted = res.demandRecorded ? '，已帮你记下' : ''
    if (items.length && !unmatched.length) {
      // ① 全匹配（照旧）
      showPill(`🎤 已记下 ${items.length} 样 · ${got}`)
      return
    }
    if (items.length && unmatched.length) {
      // ② 混合：两者的信息都要给到
      showPill(`🎤 已记下 ${items.length} 样 · ${got} ｜ 🤔 ${miss} 我还没上架${noted}`, true)
      return
    }
    if (unmatched.length) {
      // ③ 全没上架：听清了，只是这个菜我还没上架 —— 绝不报「没听清」
      showPill(`🤔 ${miss} 我还没上架${noted} · 点我看详情`, true)
      return
    }
    // ④ 真没听清（既没记下东西，也没有没上架的菜）
    showPill('没听清，请再说一遍')
  },
  // 没听清 → 原地轻提示（与助手页同文案）；识别错误/超时 → toast
  onFail: (msg, meta) => {
    if (meta && meta.kind === 'empty') showPill(msg)
    else uni.showToast({ title: msg, icon: 'none' })
  },
})
// 解构出 ref，才能在小程序模板里被自动解包（`voice.recording` 这种取法拿到的是 ref 对象，恒真）
const { ready: voiceReady, recording: voiceRecording, partial: voicePartial } = voice
const recTitle = computed(() => voicePartial.value || '正在听您说话…')

// ── 手势：短按 = 点击进助手页；按住满 300ms = 说话 ──────────
const HOLD_MS = 300
let pressTimer = null
let talking = false // 是否已进入说话模式（长按成功）
let suppressTap = false // 长按那次的收尾 tap 必须吞掉（@tap 在 touchend 之后触发）

const clearPress = () => {
  if (pressTimer) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

const onTouchStart = () => {
  // 每次新触摸先复位：上一次长按收尾的 tap 若没来（微信长按后通常不派发 tap），
  // 这个标志不能一直挂着，否则会吞掉下一次正常的短按
  suppressTap = false
  clearPress()
  // H5 端没有 WechatSI 插件 → voiceReady=false → 只保留「点一下跳助手页」，
  // 不显示录音浮层、不显示按住提示（自动降级，不报错、不白屏）
  if (!voiceReady.value) return
  if (voiceRecording.value) return
  pressTimer = setTimeout(() => {
    pressTimer = null
    talking = true
    suppressTap = true
    hideTip()
    voice.handleStart()
  }, HOLD_MS)
}

// 按住期间防页面误滚（仅吞事件，逻辑在 voice-record 内部）
const onTouchMove = () => {
  voice.handleMove()
}

const onTouchEnd = () => {
  clearPress()
  // 未满 300ms（= 点击）→ 什么都不做，交给 @tap 跳助手页
  // （既不在这里跳也不加 .prevent，理由见下面 openAssistant 段注释）
  if (!talking) return
  talking = false
  voice.handleStop() // 松手即结束识别（不做上滑取消，与助手页保持一致）
}

const onTouchCancel = () => {
  clearPress()
  if (!talking) return
  talking = false
  voice.handleStop()
}

const onTap = () => {
  if (suppressTap) {
    suppressTap = false
    return
  }
  openAssistant()
}

// ── 首次「按住说话」提示 ───────────────────────────────
const TIP_KEY = 'aiFabHoldTipSeen'
const tipVisible = ref(false)
let tipTimer = null
const hideTip = () => {
  if (tipTimer) {
    clearTimeout(tipTimer)
    tipTimer = null
  }
  tipVisible.value = false
}
const maybeShowTip = () => {
  // H5 端没有按住功能 → 不显示（也会把 flag 留给真机用）
  if (!voiceReady.value) return
  try {
    if (uni.getStorageSync(TIP_KEY)) return
  } catch (e) {
    return
  }
  tipVisible.value = true
  try {
    uni.setStorageSync(TIP_KEY, 1) // 看过一次就不再显示
  } catch (e) {
    /* 忽略：写不进就当次次都提示，不影响功能 */
  }
  tipTimer = setTimeout(() => {
    tipVisible.value = false
    tipTimer = null
  }, 4000)
}

onMounted(maybeShowTip)

onUnmounted(() => {
  // 别留悬挂定时器；正在录就停掉（voice-record 内部已处理幂等与回调丢弃）
  clearPress()
  if (pillTimer) clearTimeout(pillTimer)
  if (tipTimer) clearTimeout(tipTimer)
  talking = false
  voice.stopForLeave()
})

// 入口唯一动作：切到合并后的「AI下单」tab 页（不新建第二个助手页、不复刻对话逻辑）
// 卡AT（2026-10-01）：助手页 kefu（现为转发页）已并入 tab 页 `pages/buyer/cart`，
// 单击从 navigateTo 改 switchTab —— 老路径那条转发页仍然保留（老分享卡片不白屏），
// 但正常入口一律直接落 tab 页。
const openAssistant = () => uni.switchTab({ url: '/pages/buyer/cart' })
</script>

<style lang="scss" scoped>
/* 零尺寸定位壳：只是为了让浮层跳出 FAB 的层叠上下文（详见 template 顶部注释）。
   刻意不给 z-index —— 一旦设了就会自建层叠上下文，浮层又盖不住底部栏。
   position:fixed + width/height:0 → 完全脱离文档流，对 5 个页面的布局零影响。 */
.ai-order-fab-root {
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
}

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

/* ===== 卡AN：角标（卡片草稿商品种类数）=====
   尺寸/圆角/字号/padding 与 BuyerTabBar 的 .buyer-tabbar-badge 逐项对齐：
   16px 高、圆角 8px、padding 0 4px、字号 10px、红底 #FA5151 + 白字 */
.ai-order-fab-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  background: #FA5151;
  color: #fff;
  font-size: 10px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* ===== 卡AN：首次「按住说话」提示气泡（贴在 FAB 左侧）===== */
.ai-order-fab-tip {
  position: fixed;
  right: 80px;
  max-width: 180px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  font-size: 12px;
  line-height: 1.5;
  padding: 7px 10px;
  border-radius: 8px;
  z-index: 901;
}

/* ===== 卡AN：松手后的原地轻提示（FAB 正上方，卡AO 起 3.5 秒自动消失）===== */
.ai-order-fab-pill {
  position: fixed;
  right: 16px;
  max-width: 300px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 12px;
  line-height: 1.6;
  padding: 8px 12px;
  border-radius: 10px;
  z-index: 901;
}
/* 卡AO：「有菜没上架」的提示可点（点进助手页看详情）—— 下划线 + 更亮的底色是「这里能点」的视觉交代 */
.ai-order-fab-pill-tap {
  background: rgba(0, 185, 107, 0.92);
  text-decoration: underline;
}

/* ===== 卡AN：录音浮层（与助手页 kefu.vue 的 .rec-mask / .rec-box 同款）=====
   z-index 必须盖住底部栏（999） */
.aifab-rec-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1010;
}
.aifab-rec-box {
  width: 240px;
  background: #fff;
  border-radius: 14px;
  padding: 22px 18px;
  text-align: center;
}
.aifab-rec-mic {
  font-size: 40px;
  line-height: 1;
}
.aifab-rec-title {
  margin-top: 12px;
  font-size: 14px;
  color: $text-body;
  font-weight: 600;
  min-height: 20px;
}
.aifab-rec-tip {
  margin-top: 8px;
  font-size: 11px;
  color: $text-second;
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
