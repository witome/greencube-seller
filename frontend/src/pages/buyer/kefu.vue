<template>
  <view class="kefu-page">
    <scroll-view class="chat-body" scroll-y :scroll-into-view="scrollTo" scroll-with-animation>
      <view class="chat-time">今天</view>
      <view class="notice">🤖 智能客服在线，直接发送想买的菜和数量，自动生成订单草稿</view>

      <!-- 欢迎气泡 -->
      <view class="bubble-row">
        <view class="bubble-av">🤖</view>
        <view class="bubble">您好，我是绿立方智能客服～<br>告诉我您要买什么，比如「土豆50斤，白菜两颗，明天早上送到」，我帮您整理成订单。</view>
      </view>

      <!-- 消息列表 -->
      <view v-for="(m, idx) in messages" :key="idx">
        <!-- 用户消息 -->
        <view v-if="m.role === 'me'" class="bubble-row me">
          <view class="bubble-av">👤</view>
          <view class="bubble">{{ m.text }}</view>
        </view>

        <!-- AI 识别结果 -->
        <view v-else-if="m.role === 'ai'" class="bubble-row">
          <view class="bubble-av">🤖</view>
          <view class="bubble">
            <template v-if="m.parse.items.length">
              收到！已为您识别出以下商品：
              <view class="ai-list">
                <view v-for="(it, i) in m.parse.items" :key="i" class="ai-item">
                  <text class="ai-item-emoji">{{ emojiOf(it.name) }}</text>
                  <text class="ai-item-name">{{ it.name }}</text>
                  <text class="ai-item-qty">{{ it.qtyText }}</text>
                  <text class="ai-item-amt">约 ¥{{ it.amount.toFixed(2) }}</text>
                </view>
                <view class="ai-item ai-item-date">📅 {{ m.parse.deliveryDateLabel }}（{{ m.parse.deliveryDate }}）送达 · 合计预估 ¥{{ m.parse.total.toFixed(2) }}</view>
                <view v-if="hasWeigh(m.parse)" class="ai-item ai-item-tip">💡 称重商品以实际称重为准，多退少补</view>
              </view>
            </template>
            <template v-else>
              抱歉，暂时没识别出可下单的商品，换个说法试试～比如「土豆10斤」
            </template>
          </view>
        </view>

        <!-- 草稿卡片 -->
        <view v-if="m.role === 'ai' && m.parse.items.length" class="bubble-row">
          <view class="bubble-av">🤖</view>
          <view class="bubble draft-bubble">
            <view class="draft-head">📋 订单草稿已生成</view>
            <view class="draft-body">共 {{ m.parse.items.length }} 项 · 预估合计 ¥{{ m.parse.total.toFixed(2) }}<br>点击下方核对商品和数量，<text class="b">可直接修改</text>后确认下单</view>
            <view class="draft-link" @tap="goConfirm(m.parse)">🔗 查看并确认订单 ›</view>
          </view>
        </view>
      </view>

      <view id="chat-bottom" style="height: 8px;"></view>
    </scroll-view>

    <!-- 输入栏 -->
    <view class="chat-input">
      <input v-model="input" placeholder="输入想买的菜品和数量…" confirm-type="send" @confirm="send" />
      <view class="send-btn" :class="{ disabled: !input.trim() || sending }" @tap="send">发送</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { buyerApi } from '@/api/modules'

const input = ref('')
const messages = ref([])
const sending = ref(false)
const scrollTo = ref('')

const emojiOf = (name) => {
  const map = [
    ['白菜', '🥬'], ['菜', '🥬'], ['土豆', '🥔'], ['肉', '🥩'], ['姜', '🫚'], ['葱', '🌿'],
    ['蛋', '🥚'], ['鸡', '🍗'], ['鱼', '🐟'], ['米', '🌾'], ['面', '🍜'],
  ]
  for (const [k, e] of map) if (name.includes(k)) return e
  return '🥬'
}

const hasWeigh = (parse) => (parse.items || []).some((it) => it.weighType === 1)

const scrollBottom = () => {
  setTimeout(() => { scrollTo.value = 'chat-bottom' }, 50)
}

const send = async () => {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  messages.value.push({ role: 'me', text })
  sending.value = true
  scrollBottom()
  try {
    const parse = await buyerApi.aiParse(text)
    messages.value.push({ role: 'ai', parse })
  } catch (e) {
    messages.value.push({ role: 'ai', parse: { items: [], total: 0 } })
  } finally {
    sending.value = false
    scrollBottom()
  }
}

const goConfirm = (parse) => {
  uni.setStorageSync('aiDraft', parse)
  uni.navigateTo({ url: '/pages/buyer/ai-confirm' })
}
</script>

<style lang="scss" scoped>
.kefu-page { display: flex; flex-direction: column; height: 100vh; background: $bg-page; }
.chat-body { flex: 1; overflow: hidden; padding: 8px 12px; box-sizing: border-box; }
.chat-time { text-align: center; font-size: 10px; color: #B8BEC6; margin: 8px 0; }
.notice { background: $brand-soft; color: $brand-deep; font-size: 12px; padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; }

.bubble-row { display: flex; gap: 8px; margin: 12px 0; align-items: flex-start; }
.bubble-row.me { flex-direction: row-reverse; }
.bubble-av { width: 34px; height: 34px; border-radius: 8px; background: $brand; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 17px; flex-shrink: 0; }
.bubble-row.me .bubble-av { background: $text-body; }
.bubble { max-width: 74%; background: #fff; border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.7; color: $text-body; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.bubble-row.me .bubble { background: #95EC69; }

.ai-list { background: $bg-soft; border-radius: 8px; margin-top: 8px; padding: 8px 10px; font-size: 12px; line-height: 2; }
.ai-item { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ai-item-emoji { font-size: 14px; }
.ai-item-name { font-weight: 600; }
.ai-item-qty { color: $text-second; }
.ai-item-amt { color: $danger; margin-left: auto; font-weight: 600; }
.ai-item-date { color: $text-second; }
.ai-item-tip { color: $text-second; font-size: 11px; }

.draft-bubble { padding: 0; overflow: hidden; width: 74%; }
.draft-head { background: $brand-soft; padding: 10px 12px; font-size: 12px; color: $brand; font-weight: 700; }
.draft-body { padding: 10px 12px; font-size: 12px; color: $text-body; line-height: 1.8; }
.draft-body .b { font-weight: 700; }
.draft-link { padding: 10px 12px; border-top: 1px solid $bg-soft; color: $info; font-weight: 700; font-size: 13px; }

.chat-input { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 8px 10px; background: $bg-soft; border-top: 1px solid $border; }
.chat-input input { flex: 1; border: none; border-radius: 8px; padding: 9px 12px; font-size: 13px; background: #fff; }
.send-btn { flex: none; background: $brand; color: #fff; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; }
.send-btn.disabled { opacity: 0.5; }
</style>
