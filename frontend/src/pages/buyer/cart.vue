<template>
  <view class="page cart-page">
    <!-- 卡AQ：顶部标题条（原型 S1）—— 页内标题「订单草稿」+ 右上「清空」 -->
    <view class="pg-head">
      <text class="pg-title">订单草稿</text>
      <view class="pg-clear" @tap="clearAll">清空</view>
    </view>

    <!-- ══════════════════════════════════════════════════════════
         卡AT（2026-10-01）：单栏滚动区 —— 公告 → 对话流 → 可编辑草稿卡 → 空态引导卡
         （原「上 45% 对话 / 下 55% 清单」两个分区取消；下单入口搬进草稿卡，「确认订单」页退场）
         ══════════════════════════════════════════════════════════ -->
    <scroll-view class="col-zone" scroll-y :scroll-into-view="colScrollTo" scroll-with-animation>
      <view class="col-inner">
        <!-- ① 公告气泡（原助手页 kefu.vue 的 4 条，文案逐字照抄） -->
        <view class="notice">
          <view class="notice-line">🤖 智能下单助手在线，发送想买的菜和数量即可整理订单草稿</view>
          <view class="notice-line">💬 可以一句一句来（「土豆5斤」→「再加5斤土豆」），草稿会一直累加；要改说「土豆改成20斤」</view>
          <view class="notice-line">🎤 按住左下角话筒说话也行</view>
          <view class="notice-line">💬 也可把本页转发给同事或采购群，对方点一下就能下单</view>
        </view>

        <!-- ② 欢迎气泡 -->
        <view class="brow">
          <view class="bav">🤖</view>
          <view class="bubble ai">
            <view class="bb-line">您好，我是辉崧鲜配智能下单助手～</view>
            <view class="bb-line">告诉我您要买什么，比如「土豆50斤，白菜两颗，明天早上送到」，我帮您整理成订单。</view>
            <view class="bb-line">后面还想加菜，直接接着说就行。</view>
          </view>
        </view>

        <!-- ③ 对话流：用户 / 系统 / AI 三种气泡（AI 气泡含 changes / needClarify / 到货通知） -->
        <view v-for="(m, idx) in messages" :key="idx">
          <view v-if="m.role === 'me'" class="brow me">
            <view class="bubble me">{{ m.text }}</view>
            <view class="bav me">👤</view>
          </view>

          <view v-else-if="m.role === 'sys'" class="sys-tip">{{ m.text }}</view>

          <view v-else class="brow">
            <view class="bav">🤖</view>
            <view class="bubble ai">
              <!-- 整句直接给（如「没听清，可以再说一遍或改用打字」） -->
              <template v-if="m.text">
                <view class="bb-line">{{ m.text }}</view>
              </template>
              <!-- 需要反问（口径：不确定就反问，草稿不动） -->
              <template v-else-if="m.needClarify">
                <view class="bb-line">❓ {{ m.needClarify }}</view>
                <view class="ai-hint">草稿先没动，直接回我是哪个就行</view>
              </template>
              <!-- 请求异常 -->
              <template v-else-if="m.error">
                <view class="bb-line">抱歉，刚才没听清（网络或服务异常）。草稿没变，可以再说一遍～</view>
              </template>
              <!-- 本次有变化 -->
              <template v-else-if="(m.changes || []).length">
                <view class="bb-line">收到！本次改动：</view>
                <view class="chg">
                  <view v-for="(c, i) in m.changes" :key="i" class="chg-item">
                    <text class="chg-ic">{{ changeIcon(c) }}</text>
                    <text class="chg-tx">{{ c.text }}</text>
                  </view>
                  <view v-if="(m.unmatched || []).length" class="chg-tip">🤔 没认出来的：{{ m.unmatched.join('、') }}</view>
                </view>
              </template>
              <!-- 没变化 -->
              <template v-else>
                <view v-if="(m.unmatched || []).length" class="bb-line">这几样我还没对上商品：{{ m.unmatched.join('、') }}，换个说法试试～</view>
                <view v-else class="bb-line">好的，记下了（这一句清单没有变化）</view>
              </template>

              <!-- ④ 说了没上架的菜：采购需求登记 +「到货通知我」
                   只在服务端**真的登记成功**（demandRecorded）时才出现（不做「假装记下」）；
                   按钮显隐还取决于服务端有没有配到货通知模板（demandTmplId，模板 id 绝不写死）。 -->
              <view v-if="m.demandRecorded" class="demand-note">
                <view class="demand-note-t">🤔 我还没上架，已帮你记下，到货通知你 📩</view>
                <view
                  v-if="demandTmplId"
                  class="demand-note-btn"
                  :class="{ done: m.notifySubscribed }"
                  @tap="onSubscribeDemand(m)"
                >{{ m.notifySubscribed ? '✅ 已开启到货通知' : '到货通知我' }}</view>
              </view>
            </view>
          </view>
        </view>

        <!-- ⑤ 可编辑草稿卡（卡AR 那一版搬过来；下单入口「确认下单」在本卡搬进这里） -->
        <view v-if="cart.length" class="dcard">
          <view class="dcard-hd">
            <text class="dc-hd-t">📋 当前订单草稿（{{ cart.length }} 项）</text>
            <text class="dc-clr" @tap="clearAll">清空重来</text>
          </view>

          <view class="dcard-bd">
            <view v-for="it in cart" :key="it.cartItemId" class="drow">
              <text class="dr-em">{{ emojiOf(it.name) }}</text>
              <view class="dr-main">
                <view class="dr-name">{{ it.name }}</view>
                <view class="dr-price">¥{{ money(it.salePrice) }}/{{ it.unit }}</view>
              </view>
              <view class="stp">
                <view class="stp-btn stp-minus" @tap="changeQty(it, -1)">−</view>
                <text class="stp-n">{{ it.qty }}</text>
                <view class="stp-btn stp-plus" @tap="changeQty(it, 1)">＋</view>
              </view>
              <text class="dr-sub">¥{{ money(it.subtotal) }}</text>
              <view class="dr-del" @tap="remove(it)">✕</view>
            </view>

            <!-- ⑥ 送达 + 预估合计 ／ ⑦ 称重提示 -->
            <view class="dc-line">📅 {{ dateLabel }}（{{ meta.deliveryDate }}）送达 · 预估合计 ¥{{ totalAmount }}</view>
            <view v-if="hasWeigh" class="dc-tip">💡 称重商品以实际称重为准，多退少补</view>

            <!-- ⑧ 配送日期 / 送达时段 / 收货地址 / ＋ 添加商品 -->
            <view class="dc-fld">
              <view class="fl-row">
                <text class="fl-k">配送日期</text>
                <view class="chips">
                  <view v-for="d in dateOptions" :key="d.value" :class="['chip', { on: meta.deliveryDate === d.value }]" @tap="pickDate(d.value)">{{ d.label }}</view>
                </view>
              </view>
              <view class="fl-row">
                <text class="fl-k">送达时段</text>
                <view class="chips">
                  <view v-for="w in winOptions" :key="w.value" :class="['chip', { on: meta.timeWindow === w.value }]" @tap="pickWindow(w.value)">{{ w.label }}</view>
                </view>
              </view>
              <view class="fl-row">
                <text class="fl-k">收货地址</text>
                <view class="fl-v">{{ address || '未设置收货地址' }}</view>
              </view>
              <view class="add-btn" @tap="openPicker">＋ 添加商品</view>
            </view>

            <!-- ⑨ 共 N 项 · 预估合计 + 确认下单（下单动作就在本页，不再跳「确认订单」页）
                 卡AX（2026-10-01 · 修正卡）：结算条**恢复成一行** —— 合计块在**左**、「确认下单」按钮
                 在**同一行里水平居中**（按钮中心 ≈ 屏幕中线 x=195），**不是靠右**、**也不单独成行**。
                 （卡AW 做成了「居中式两段」＝合计块居中 + 按钮单独成行居中，大辉 2026-10-01 当面更正为本形态。）

                 ⚠️ **硬冲突与解法**：左对齐的合计文字与居中按钮会撞在一起（原一行式「共 N 项 · 预估合计」
                 左起 x=23、宽约 115 → 右边界 ≈138；居中按钮 x∈[128,262] → 重叠约 10px）。
                 解法：把合计块**压窄成两行短行**（文案一字未改，只是拆行）——
                   第一行 `共 N 项` ／ 第二行 `预估 ¥xx.xx`（金额保持主色 + 加粗）
                 使其**最右边界 ≤ 130**，从而与按钮左边界（128）之间留出 ≥8px 间隙。
                 两行仍是原来那四个信息（`共 N 项` / `预估合计` / 金额 / 按钮），一个没少。

                 ⚠️ **故意偏离原型 S1**：原型是「合计两行在左 + 按钮**靠右**」的小胶囊；
                 本卡按**大辉 2026-10-01 当面指示**改成「合计在左 + 按钮**居中**」。
                 按钮宽度沿用卡AW（按文案自适应，左右内边距 40px，**不占满整行**），
                 实测几何数字与悬浮球 x∈[318,374] 的避让结论见文末 FAB 注释。 -->
            <view class="dc-foot">
              <view class="dc-tt">
                <text class="dc-tt-a">共 {{ cart.length }} 项</text>
                <text class="dc-tt-b">预估 ¥{{ totalAmount }}</text>
              </view>
              <view class="dc-go" :class="{ dis: !cart.length || submitting }" @tap="submitOrder">确认下单</view>
            </view>
          </view>
        </view>

        <!-- ⑩ 空态引导卡（原型 S2）：位置在对话流下方 -->
        <view v-else class="dempty">
          <view class="de-ic">🧺</view>
          <view class="de-t1">还没有商品</view>
          <view class="de-t2">说一句「土豆50斤」，或点下面去商品页挑</view>
          <view class="de-go" @tap="goShop">去逛商品</view>
        </view>

        <view id="cart-col-bottom" style="height: 8px;"></view>
      </view>
    </scroll-view>

    <!-- ⑪ 吸底输入栏：🎤 按住说话 + 输入框 + 发送 -->
    <view class="dinput">
      <view
        v-if="voiceReady"
        class="mic"
        :class="{ on: voiceRecording, off: sending }"
        @touchstart="onMicStart"
        @touchend="onMicStop"
        @touchcancel="onMicStop"
      >{{ voiceRecording ? '🎤 聆听中…' : '🎤 按住说话' }}</view>
      <input class="dipt" v-model="inputText" placeholder="输入想买的菜品和数量…" confirm-type="send" @confirm="onSendTap" />
      <view class="send" :class="{ disabled: !inputText.trim() || sending }" @tap="onSendTap">发送</view>
    </view>

    <BuyerTabBar active="/pages/buyer/cart" />
    <!-- 卡AW（2026-10-01）：offset **210 → 136**（降回贴着吸底输入栏的低位）。
         为什么现在能降：卡AU 抬到 210，是因为当时「确认下单」是**靠右**的小胶囊（x∈[273,367]），
         与悬浮球 x∈[318,374] 横向重叠 49px（≈按钮一半），只能靠把球往上顶来避让。
         本卡按大辉当面指示把按钮改成**居中 + 按文案自适应宽度**（左右内边距 40px、不占满整行）后，
         ⚠️ 卡AX（2026-10-01 · 修正卡）复核：结算条改回**一行式**（合计在左两行短行 + 按钮同一行居中），
         **按钮宽度 / 位置一个字节没动**，仍是 x∈[128, 262]、134×33.5 → 本注释全部结论继续成立，
         offset 保持 136（四种草稿数据实测：合计块右边界最大 118.81 ≤ 130，与按钮左边界 128 留 ≥9.19px）。
         → **FAB x∈[318,374] 与按钮 x 范围不重叠**（两者中间还空 56px），
         于是「不能压住按钮」这条约束在 x 方向就自动成立了，球可以降回贴着吸底输入栏的低位。
         量法（模拟器 390×844，env(safe-area-inset-bottom)=34；页面视口 = 100vh 实测 753px；
              `automation_element_action --action offset/size` 实测）：
           · FAB：right:16 / 56×56 → **x ∈ [318, 374]**；bottom = offset + 安全区
             → **y ∈ [663-offset, 719-offset]**（offset=136 时 = [527, 583]）；
           · 吸底输入栏 `.dinput`：bottom = calc(64px + 安全区) → 底边 y = 753 − 98 = 655，
             **实测 y ∈ [595.61, 655]**（卡AU 实测；本卡复核值见自测报告）→ 顶边 y = 595.61；
           · 取 offset 使 FAB **底边 ≤ 输入栏顶边 − 12**：719 − offset ≤ 595.61 − 12 → offset ≥ 135.4
             → **取 136**（落在 130~140 区间、且是「不遮住吸底输入栏」的最小档；
               实测与输入栏顶边留 ≈12.6px；再低就会压住输入框 / 发送）。
         已知边界（量过的，非缺陷）：球浮在滚动区之上，y 带上若正好压着某条草稿行的 ✕ / ＋，
         那一行会被压住 —— 这是悬浮球压滚动内容的固有行为（offset 越大球越高、越容易压到行，
         与卡AU 记的「球落在『＋ 添加商品』右侧空白」同类），滚一下即可，本卡不处理。
         ⚠️ 只改本页传入的 offset —— 悬浮球的单击 / 按住说话 / 角标 / 其它页面用法一行未动。 -->
    <AiOrderFab :offset="136" />

    <!-- ⑫ 「＋ 添加商品」页内选品弹层（原在 ai-confirm.vue：切页会丢草稿，必须保持页内弹层形态）
         弹层内加减全部走服务端草稿（POST /cart、PUT /cart/:id、DELETE /cart/:id），不加本地临时态 -->
    <view v-if="pickerOpen" class="pk-mask" @tap="closePicker">
      <view class="pk-sheet" @tap.stop>
        <view class="pk-head">
          <text class="pk-title">添加商品</text>
          <view class="pk-close" @tap="closePicker">✕</view>
        </view>

        <view class="pk-search">
          <input class="pk-input" v-model="pkKeyword" placeholder="搜索商品" confirm-type="search" @confirm="loadPkGoods" />
          <view class="pk-search-btn" @tap="loadPkGoods">搜索</view>
        </view>

        <view class="pk-body">
          <scroll-view scroll-y class="pk-cate">
            <view :class="['pk-cate-item', { on: pkCate === 0 }]" @tap="switchPkCate(0)">全部</view>
            <view v-for="c in categories" :key="c.id" :class="['pk-cate-item', { on: pkCate === c.id }]" @tap="switchPkCate(c.id)">{{ c.name }}</view>
          </scroll-view>

          <scroll-view scroll-y class="pk-list">
            <view v-for="g in pickerGoods" :key="g.id" class="pk-row">
              <view class="pk-info">
                <view class="pk-name">{{ g.name }}</view>
                <view class="pk-spec">{{ g.specText || (g.weighType === 1 ? '称重' : '固定规格') }}</view>
                <view class="pk-price">¥{{ money(g.salePrice) }}/{{ g.unit }}</view>
              </view>
              <view v-if="qtyOf(g.id)" class="pk-stepper">
                <view class="st-btn" @tap="decProduct(g)">−</view>
                <text class="pk-qty">{{ qtyOf(g.id) }}</text>
                <view class="st-btn" @tap="addProduct(g)">＋</view>
              </view>
              <view v-else class="pk-add" @tap="addProduct(g)">＋</view>
            </view>
            <view v-if="pkLoading" class="empty-tip">加载中…</view>
            <view v-else-if="!pickerGoods.length" class="empty-tip">暂无商品</view>
          </scroll-view>
        </view>

        <view class="pk-foot">
          <text class="pk-foot-txt">已选 {{ cart.length }} 项 · 预估 ¥{{ totalAmount }}</text>
          <view class="pbtn primary" @tap="closePicker">完成</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onShareAppMessage } from '@dcloudio/uni-app'
import { buyerApi, authApi, demandApi } from '@/api/modules'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'
import { guardBuyerSuspended } from '@/utils/account-guard'
import { createVoiceHold } from '@/utils/voice-record'
import { sendUtterance } from '@/utils/ai-order'
import {
  setDraftFromCart,
  deliveryMeta,
  setMeta,
  clearMeta,
  emojiOf,
  syncCartDraft,
  clearDraft,
  pendingUnmatched,
  clearPendingUnmatched,
} from '@/utils/ai-draft'
import BuyerTabBar from '@/components/BuyerTabBar.vue'
import AiOrderFab from '@/components/AiOrderFab.vue'

const cart = ref([])

/** 金额一律渲染服务端给的数（salePrice / subtotal），前端不算价 */
const money = (v) => (Number(v) || 0).toFixed(2)

const totalAmount = computed(() => cart.value.reduce((s, i) => s + Number(i.subtotal || 0), 0).toFixed(2))
const hasWeigh = computed(() => cart.value.some((it) => it.weighType === 1))

const load = async () => {
  const data = await buyerApi.getCart()
  cart.value = data.list || []
}

const changeQty = async (it, delta) => {
  const qty = Number(it.qty) + delta
  if (qty <= 0) { await remove(it); return }
  await buyerApi.updateCart(it.cartItemId, qty)
  await load()
  uni.$emit('cart-badge-refresh')
}

const remove = async (it) => {
  await buyerApi.removeCart(it.cartItemId)
  cart.value = cart.value.filter((i) => i.cartItemId !== it.cartItemId)
  uni.$emit('cart-badge-refresh')
}

/**
 * 卡AT（2026-10-01）：下单入口就在草稿卡里 —— 「确认确认」页已取消，
 * 点「确认下单」直接 placeOrder（source=2 = AI 代下单；**不再传 remark**，订单备注已拍板取消）
 * → 清掉四份草稿状态 → 进订单详情。
 * ⚠️ 服务端草稿清空失败**不拦跳转**（订单已成立，别让客户卡在草稿页）。
 */
const submitting = ref(false)
const submitOrder = async () => {
  if (!cart.value.length || submitting.value) return
  ensureMeta()
  submitting.value = true
  try {
    const order = await buyerApi.placeOrder({
      deliveryDate: meta.value.deliveryDate,
      timeWindow: meta.value.timeWindow,
      items: cart.value.map((i) => ({ productId: i.productId, qty: i.qty })),
      source: 2, // 2 = AI 客服代下单（普通自选下单路径不传，后端默认 1）
    })
    uni.removeStorageSync('aiDraft')
    clearDraft()
    clearMeta()
    try {
      await syncCartDraft([])
    } catch (e) {
      /* 忽略：订单已成立，回草稿页会再拉一次服务端真值 */
    }
    uni.showToast({ title: '下单成功', icon: 'success' })
    uni.$emit('cart-badge-refresh')
    uni.redirectTo({ url: `/pages/buyer/order-detail?id=${order.orderId}` })
  } catch (e) {
    /* 错误已由 request.js 统一提示 */
  } finally {
    submitting.value = false
  }
}

// ══════════════════════════════════════════════════════════════
// 卡AT（2026-10-01）：助手页（kefu.vue）并入本页 —— 对话流 / 到货通知 / 分享 / 草稿卡
// 卡AQ 的三字段、清空、空态、角标刷新、停用检查等既有能力一条未丢。
// ══════════════════════════════════════════════════════════════

/** 草稿与服务端 cart_item 的镜像同步点：
 *  cart 一变（加载 / 手动 +/- / 删除 / AI 说话后重新加载）就把共享草稿换成服务端最新清单，
 *  这样右下角 FAB 角标、商品页「加入草稿」看到的都是同一份。
 *  ⚠️ 用 deep watch 而不是在每个函数末尾补一行 —— 老函数一行都不用改，也不会漏掉哪条路径。
 *  ⚠️ 只负责「镜像」，**不做合并**（合并只有服务端 /ai/parse 一处）。 */
watch(
  cart,
  (list) => {
    setDraftFromCart(list || [])
    uni.$emit('cart-badge-refresh')
  },
  { deep: true },
)

// ── 两字段：配送日期 / 送达时段（前端持有，不落服务端表；下单时才传给 placeOrder）──
const meta = deliveryMeta
const dateLabel = computed(() => (meta.value.deliveryDate ? meta.value.deliveryDate.slice(5) : '尽快'))
const dateOptions = [
  { value: dateStr(), label: `今天 ${dateStr().slice(5)}` },
  { value: tomorrowStr(), label: `明天 ${tomorrowStr().slice(5)}` },
  { value: dateStr(new Date(Date.now() + 2 * 86400000)), label: `后天 ${dateStr(new Date(Date.now() + 2 * 86400000)).slice(5)}` },
]
const winOptions = computed(() => availableTimeWindows(meta.value.deliveryDate))

/** 首次进来给两字段一个默认值（当天有可选时段用当天，否则次日；时段取最早可用） */
const ensureMeta = () => {
  if (!meta.value.deliveryDate) {
    let d = dateStr()
    if (!availableTimeWindows(d).length) d = tomorrowStr()
    setMeta({ deliveryDate: d })
  }
  const wins = winOptions.value
  if (!wins.some((w) => w.value === meta.value.timeWindow)) {
    setMeta({ timeWindow: wins.length ? wins[0].value : 2 })
  }
}

const pickDate = (v) => {
  setMeta({ deliveryDate: v })
  const wins = availableTimeWindows(v)
  if (!wins.some((w) => w.value === meta.value.timeWindow)) setMeta({ timeWindow: wins.length ? wins[0].value : 2 })
}
const pickWindow = (v) => setMeta({ timeWindow: v })

// ── 对话流（页面本地，不共享、不落库 —— 口径：不带历史原话）──
const messages = ref([])
const inputText = ref('')
const sending = ref(false)
const colScrollTo = ref('')

const scrollBottom = () => {
  setTimeout(() => { colScrollTo.value = 'cart-col-bottom' }, 60)
}

const pushMsg = (m) => {
  messages.value.push(m)
  scrollBottom()
}

const changeIcon = (c) => (c.type === 'remove' ? '➖' : c.type === 'clear' ? '🗑️' : c.type === 'set' ? '✏️' : '➕')

/**
 * 卡AU（2026-10-01）：消费「在外面（FAB 按住说）说了**没上架的菜**」留下的跨页状态 ——
 * 补一条与页内说话**完全同构**的 AI 气泡（「🤔 我还没上架，已帮你记下，到货通知你 📩」+「到货通知我」按钮）。
 * ⚠️ 取走就清（内存态），避免重复冒同一条。
 * ⚠️ onShow 与「FAB 说完话」的回调**共用这一份**（不许写两份）—— 人已经在本页时 onShow 不触发，
 *    之前只挂在 onShow 上，气泡就会等到下次切页才冒出来。
 * @returns {boolean} 是否真的补了一条气泡（调用方可据此决定要不要滚到底）
 */
const flushPendingUnmatched = () => {
  const pu = pendingUnmatched.value
  if (!pu || !(pu.texts || []).length) return false
  pushMsg({
    role: 'ai',
    error: false,
    changes: [],
    needClarify: '',
    unmatched: pu.texts,
    demandRecorded: !!pu.recorded,
    notifySubscribed: false,
  })
  clearPendingUnmatched()
  scrollBottom()
  return true
}

/**
 * 卡AU（2026-10-01）：FAB 说完话 → 本页**重拉服务端草稿**。
 *
 * 为什么要这条通道：卡AT 把草稿卡改成渲染**本地 `cart`**（`v-for="it in cart"`）之后，
 * `cart` 只能由 `load()`（GET /cart）更新；而 FAB 是跨页组件，它写完共享草稿后既调不到本页的
 * `load()`、也没广播任何事件 → 卡片数字不动（改造前 kefu.vue 直接渲染共享 `draft`，所以能自己更新）。
 *
 * 口径：**服务端是唯一真源** —— 收到事件就重新拉一次，卡片 / 合计 / 角标一起刷新。
 * ⚠️ **不许**改成「监听共享 draft 自动合并」：那会和现有的 `watch(cart) → setDraftFromCart` 形成双向环。
 *
 * ⚠️ `visible`：页面不在前台时不拉（onHide 之后的一次事件没必要白跑一个请求，回前台 onShow 会刷新）。
 * ⚠️ 注册在 onLoad、**必须**在 onUnload 里 $off —— 否则页面反复进出会重复注册、重复拉接口。
 */
const visible = ref(false)
const onDraftSynced = async () => {
  if (!visible.value) return
  await load()
  // 说完「没上架的菜」当场就要出气泡（不用切走再切回来）
  flushPendingUnmatched()
}

/**
 * 一句话 → 写进服务端草稿（cart_item）→ 刷新清单。
 * ⚠️ 解析结果全部用服务端给的字段，前端不自己拼文案；
 * ⚠️ 「没上架的菜」绝不能报成「没听清」—— 那是两条完全不同的路。
 */
const doSend = async (text) => {
  const t = String(text == null ? '' : text).trim()
  if (!t || sending.value) return
  sending.value = true
  pushMsg({ role: 'me', text: t })
  const res = await sendUtterance(t)
  pushMsg({
    role: 'ai',
    error: !!res.error,
    changes: res.changes || [],
    needClarify: res.needClarify || '',
    unmatched: res.unmatched || [],
    demandRecorded: !!res.demandRecorded,
    notifySubscribed: false,
  })
  if (!res.error && !res.needClarify) await load()
  sending.value = false
  scrollBottom()
}

const onSendTap = () => {
  const t = inputText.value
  inputText.value = ''
  doSend(t)
}

// ── 语音：必须复用 utils/voice-record.js（全仓不许有第二份录音插件调用）──
const voice = createVoiceHold({
  onDone: (text) => doSend(text),
  onFail: (msg, m) => {
    if (m && m.kind === 'empty') pushMsg({ role: 'ai', error: false, changes: [], needClarify: '', unmatched: [], demandRecorded: false, text: `${msg}，可以再说一遍或改用打字` })
    else uni.showToast({ title: msg, icon: 'none' })
  },
})
const { ready: voiceReady, recording: voiceRecording } = voice
const onMicStart = voice.handleStart
const onMicStop = voice.handleStop
// 离页必须停录（否则后台还在录、回调回来页面已销毁）
onHide(voice.stopForLeave)
onUnload(voice.stopForLeave)

// ── 采购需求登记 + 到货通知授权（2026-09-25，从助手页原样搬来）──
// 「到货通知我」按钮要不要显示，取决于**服务端有没有配到货通知模板**（口径 8：绝不写死模板 id）。
// 拿不到配置就不显示按钮 —— 宁可不显示，也不给客户一个点了没用的按钮。
const demandTmplId = ref('')

/** 收货地址（只读一行）：authApi.getProfile() 的 purchaser.address，没有就显示「未设置收货地址」 */
const address = ref('')

// ⚠️ tabBar 页面切换回来只触发 onShow 不触发 onLoad，刷新必须放 onShow
onShow(async () => {
  visible.value = true // 卡AU：本页回到前台 → 允许「AI 草稿同步」事件触发重拉
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  ensureMeta()
  load()
  // 卡AO（2026-09-30）：在外面（FAB 按住说）说了**我还没上架的菜**时，这里补一条与页内说话
  // **完全同构**的 AI 气泡 —— 「🤔 我还没上架，已帮你记下，到货通知你 📩」+「到货通知我」按钮。
  // 卡AU：抽成 flushPendingUnmatched()，与「FAB 说完话」的回调共用同一份（人已在本页时 onShow 不触发）。
  flushPendingUnmatched()
})

onHide(() => {
  // 卡AU：离开本页后别再响应 ai-draft-synced（回前台时 onShow 会整体刷新一次，不会漏）
  visible.value = false
})
onUnload(() => {
  visible.value = false
  // ⚠️ 必须 off：页面反复进出会重复注册同一个监听 → 一次事件触发 N 遍 load()
  uni.$off('ai-draft-synced', onDraftSynced)
})

onLoad(async () => {
  // 卡AU：注册「FAB 说完话」的刷新监听（onUnload 里配对 $off，见上）
  uni.$on('ai-draft-synced', onDraftSynced)
  try {
    const cfg = await demandApi.subscribeConfig()
    demandTmplId.value = cfg && cfg.configured ? cfg.templateId || '' : ''
  } catch (e) {
    demandTmplId.value = ''
  }
  try {
    const profile = await authApi.getProfile()
    address.value = (profile && profile.purchaser && profile.purchaser.address) || ''
  } catch (e) {
    address.value = ''
  }
})

/** 点「到货通知我」→ 拉起微信订阅授权 → 把结果报给服务端落额度 */
const onSubscribeDemand = (msg) => {
  const tmpl = demandTmplId.value
  if (!tmpl) return
  // H5 / 非微信环境没有这个 API → 给一句人话提示，别留「点了没反应」的假按钮
  if (typeof uni.requestSubscribeMessage !== 'function') {
    uni.showToast({ title: '请在微信小程序里开启到货通知', icon: 'none' })
    return
  }
  uni.requestSubscribeMessage({
    tmplIds: [tmpl],
    success: async (res) => {
      const accepted = []
      const rejected = []
      Object.keys(res || {}).forEach((k) => {
        if (k === 'errMsg') return
        if (res[k] === 'accept') accepted.push(k)
        else rejected.push(k)
      })
      msg.notifySubscribed = accepted.includes(tmpl)
      // ⚠️ 服务端**只能**靠这次上报知道能不能发（授权只发生在客户端）
      try {
        await demandApi.subscribe({ templateId: tmpl, accepted, rejected })
      } catch (e) {
        /* 上报失败不打断客户：下次补授权还能把额度加上 */
      }
      uni.showToast({
        title: msg.notifySubscribed ? '已开启，到货就通知你' : '好的，需要时可在「我的需求」里再开',
        icon: 'none',
      })
    },
    fail: () => uni.showToast({ title: '开启失败，稍后可在「我的需求」里再试', icon: 'none' }),
  })
}

// ── 清空（顶部「清空」与卡头「清空重来」同一个弹窗）：只清草稿，对话历史保留 ──
const clearAll = async () => {
  if (!cart.value.length) return
  uni.showModal({
    title: '清空草稿',
    content: '会把这份草稿里的商品全部清空，对话历史保留。确定吗？',
    confirmText: '清空',
    success: async (r) => {
      if (!r.confirm) return
      try {
        // 整体替换成空数组 —— 与 AI 说话同一个写口（/cart/sync），不另开清空接口
        await syncCartDraft([])
        clearMeta()
        clearDraft()
        await load()
        uni.showToast({ title: '草稿已清空', icon: 'none' })
      } catch (e) {
        /* 错误已由 request.js 统一提示 */
      }
    },
  })
}

const goShop = () => {
  uni.switchTab({ url: '/pages/buyer/goods' })
}

// ── 添加商品弹层（从 ai-confirm.vue 原样搬来；改动落服务端草稿，不加本地临时态）──
const pickerOpen = ref(false)
const categories = ref([])
const pickerGoods = ref([])
const pkCate = ref(0)
const pkKeyword = ref('')
const pkLoading = ref(false)

const qtyOf = (id) => {
  const hit = cart.value.find((it) => it.productId === id)
  return hit ? Number(hit.qty) : 0
}

const addProduct = async (g) => {
  try {
    await buyerApi.addToCart({ productId: Number(g.id), qty: 1 })
    await load()
  } catch (e) {
    /* 错误已由 request.js 统一提示 */
  }
}

const decProduct = async (g) => {
  const hit = cart.value.find((it) => it.productId === g.id)
  if (!hit) return
  try {
    if (Number(hit.qty) <= 1) await buyerApi.removeCart(hit.cartItemId)
    else await buyerApi.updateCart(hit.cartItemId, Number(hit.qty) - 1)
    await load()
  } catch (e) {
    /* 错误已由 request.js 统一提示 */
  }
}

const loadPkGoods = async () => {
  pkLoading.value = true
  // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成字符串 "undefined"，导致后端误当搜索词
  const params = { page: 1, pageSize: 50 }
  if (pkCate.value) params.categoryId = pkCate.value
  if (pkKeyword.value) params.keyword = pkKeyword.value
  try {
    const data = await buyerApi.getGoods(params)
    pickerGoods.value = data.list || []
  } catch (e) {
    pickerGoods.value = []
  }
  pkLoading.value = false
}

const switchPkCate = (id) => { pkCate.value = id; loadPkGoods() }

const openPicker = async () => {
  pickerOpen.value = true
  if (!categories.value.length) {
    try { categories.value = await buyerApi.getCategories() } catch (e) { categories.value = [] }
  }
  if (!pickerGoods.value.length) loadPkGoods()
}

const closePicker = () => { pickerOpen.value = false }

// ── 转发分享（公告里那句「也可把本页转发给同事或采购群」要在合并后的本页成立）──
onShareAppMessage(() => ({
  title: '说一句话就能下单 · 辉崧鲜配',
  path: '/pages/buyer/cart',
}))
</script>

<style lang="scss" scoped>
.cart-page {
  padding: 0;
  padding-bottom: calc(124px + env(safe-area-inset-bottom));
  box-sizing: border-box;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: $bg-page;
}

/* ── 顶部标题条 ── */
.pg-head {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; background: #fff; border-bottom: 1px solid $border;
}
.pg-title { font-size: 15px; font-weight: 600; color: $text-title; }
.pg-clear { font-size: 13px; color: $text-second; padding: 2px 4px; border-radius: 6px; }

/* ── 单栏滚动区（对话流在上 · 草稿卡在下）── */
.col-zone { flex: 1 1 0; min-height: 0; background: $bg-page; box-sizing: border-box; }
.col-inner { padding: 10px 12px 12px; }

/* ── 公告气泡（原助手页 4 条）── */
.notice {
  background: $brand-soft; color: $brand-deep; font-size: 10px; line-height: 1.45;
  padding: 6px 9px; border-radius: 8px; margin-bottom: 7px;
}
.notice-line { display: block; }

/* ── 对话气泡 ── */
.brow { display: flex; margin-bottom: 6px; align-items: flex-start; gap: 6px; }
.brow.me { justify-content: flex-end; }
.bav {
  width: 26px; height: 26px; border-radius: 7px; background: $brand; color: #fff; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center; font-size: 13px;
}
.bav.me { background: $text-body; }
.bubble {
  max-width: 80%; padding: 7px 10px; border-radius: 12px; font-size: 12px; line-height: 1.6;
  background: #fff; color: $text-title; border: 1px solid $border; border-top-left-radius: 4px;
}
.bubble.me { background: $brand; color: #fff; border: 1px solid $brand; border-top-right-radius: 4px; border-top-left-radius: 12px; }
.bubble.ai { background: #fff; }
.bb-line { display: block; }
.ai-hint { display: block; margin-top: 4px; font-size: 11px; color: $text-second; }

/* 本次改动 */
.chg { display: block; margin-top: 5px; background: $bg-page; border-radius: 7px; padding: 5px 7px; }
.chg-item { display: flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1.6; }
.chg-tx { color: $brand-deep; font-weight: 700; }
.chg-tip { font-size: 11px; color: $text-second; line-height: 1.6; }

/* 没上架的菜 → 「到货通知我」 */
.demand-note { margin-top: 7px; padding-top: 6px; border-top: 1px dashed $border; }
.demand-note-t { font-size: 11.5px; color: $brand-deep; line-height: 1.55; }
.demand-note-btn {
  display: inline-block; margin-top: 7px; background: $brand; color: #fff;
  font-size: 11.5px; font-weight: 700; padding: 6px 13px; border-radius: 16px;
}
.demand-note-btn.done { background: $bg-page; color: $text-second; }

.sys-tip { text-align: center; font-size: 11px; color: $text-second; margin: 10px 0; }

/* ── 可编辑草稿卡 ── */
.dcard { background: #fff; border-radius: 12px; overflow: hidden; margin-top: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, .06); }
.dcard-hd {
  background: $brand-soft; padding: 8px 11px; font-size: 12px; color: $brand; font-weight: 700;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.dc-clr { color: $text-second; font-weight: 400; text-decoration: underline; font-size: 11.5px; }
.dcard-bd { padding: 5px 11px 7px; }

.drow { display: flex; align-items: center; gap: 7px; padding: 5px 0; border-bottom: 1px solid #F5F6F8; }
.drow:last-of-type { border-bottom: none; }
.dr-em { font-size: 19px; width: 22px; flex: 0 0 auto; text-align: center; line-height: 1; }
.dr-main { flex: 1; min-width: 0; }
.dr-name { font-size: 13px; font-weight: 600; color: $text-title; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-price { font-size: 10.5px; color: $text-second; margin-top: 2px; }
.dr-sub { font-size: 12.5px; font-weight: 700; color: $danger; width: 58px; text-align: right; flex: 0 0 auto; }
.dr-del { font-size: 13px; color: $text-placeholder; flex: 0 0 auto; padding: 2px; line-height: 1; }
.stp { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.stp-btn {
  width: 22px; height: 22px; border-radius: 50%; background: $bg-soft; color: $text-title;
  font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.stp-n { font-size: 12.5px; font-weight: 700; min-width: 22px; text-align: center; color: $text-title; }

.dc-line { display: block; font-size: 11px; color: $text-title; font-weight: 600; line-height: 1.6; padding: 3px 0 0; }
.dc-tip { display: block; font-size: 10.5px; color: $text-second; line-height: 1.5; padding: 1px 0 0; }

.dc-fld { padding: 6px 0 2px; border-top: 1px dashed #F0F1F3; margin-top: 5px; }
.fl-row { display: flex; align-items: flex-start; gap: 8px; padding: 4px 0; }
.fl-k { font-size: 11.5px; color: $text-second; width: 52px; flex: 0 0 auto; padding-top: 2px; }
.fl-v { flex: 1; min-width: 0; font-size: 11.5px; color: $text-placeholder; padding-top: 3px; }
.chips { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  padding: 3px 8px; border-radius: 14px; border: 1.5px solid $border-strong;
  font-size: 10.5px; color: $text-body; background: #fff;
}
.chip.on { background: $brand-soft; border-color: $brand; color: $brand; font-weight: 700; }

.add-btn {
  margin-top: 7px; text-align: center; padding: 8px 0; border-radius: 10px;
  border: 1.5px solid $brand; color: $brand; font-size: 12.5px; font-weight: 700; background: #fff;
}

/* 卡内结算条（卡AX 2026-10-01 · 修正卡：**一行式** —— 合计块在左、按钮在同一行里居中）
   形态：`display:flex; align-items:center`（一行，不再 column）；
     · 合计块 `.dc-tt` 在**左**（flex 起始位），压成两行短行 → 右边界 ≤ 130；
     · 按钮 `.dc-go` 用 `position:absolute; left:50%; transform:translate(-50%,-50%)`
       **绝对居中于本行**：本行 x∈[23,367]（`.col-inner` 左右内边距各 12、`.dcard-bd` 各 11，
       左右对称）→ 行中心 = 195 = 390 宽屏的屏幕中线，与按钮文案宽度无关。
     · 按钮**按文案自适应宽度**（左右内边距 40px，**不占满整行**，实测 134×33.5），
       右边界 262 → 与悬浮球那一列 x∈[318,374] 中间还空 56px，不重叠。 */
.dc-foot {
  margin-top: 8px; border-top: 1px solid #F0F1F3; padding-top: 8px;
  position: relative; display: flex; align-items: center; min-height: 36px;
}
.dc-tt { flex: 0 0 auto; text-align: left; }
.dc-tt-a { display: block; font-size: 12px; color: $text-second; line-height: 1.45; white-space: nowrap; }
/* ⚠️ 卡AX 实测调过字号：金额行 16px → **14px**。
   为什么必须缩：两行短行方案在**最长情况**（`预估 ¥110.24`）下 16px 实测宽度 99.75px
   → 右边界 122.75，而居中按钮左边界恒为 128 → **只余 5.25px 间隙，达不到本卡「≥8px」硬指标**。
   本卡口径允许「字号按需缩（不低于 12px）」（见卡AX 第一节），故取 14px：
   右边界降到 ≈110.3 → 间隙 ≈17.7px；且 4 位数金额（`预估 ¥1138.64`）仍余 ≈9px，
   对生鲜配送的真实订单总额区间留足余量。**文案一个字未改**，金额仍是主色 + 加粗。 */
.dc-tt-b { display: block; color: $danger; font-size: 14px; font-weight: 800; line-height: 1.3; margin-top: 2px; white-space: nowrap; }
.dc-go {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  background: $brand; color: #fff; border-radius: 22px;
  padding: 10px 40px; font-size: 13.5px; font-weight: 700; line-height: 1; white-space: nowrap;
}
.dc-go.dis { background: $bg-soft; color: $text-placeholder; }

/* ── 空态引导卡（原型 S2）── */
.dempty { margin: 18px 0 0; background: #fff; border-radius: 14px; padding: 26px 18px; text-align: center; }
.de-ic { font-size: 38px; line-height: 1; }
.de-t1 { font-size: 15px; font-weight: 700; margin-top: 10px; }
.de-t2 { font-size: 11.5px; color: $text-second; line-height: 1.7; margin-top: 8px; }
.de-go {
  margin: 14px auto 0; width: 150px; padding: 10px 0; border-radius: 22px;
  background: $brand; color: #fff; font-size: 13.5px; font-weight: 700; text-align: center;
}

/* ── 吸底输入栏 ── */
.dinput {
  position: fixed; left: 0; right: 0; bottom: calc(64px + env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: 8px; padding: 8px 12px 10px;
  background: #fff; border-top: 1px solid $border; box-shadow: 0 -3px 10px rgba(0, 0, 0, .06); z-index: 20;
}
.mic {
  flex: 0 0 auto; height: 34px; padding: 0 11px; border-radius: 17px; background: $brand;
  color: #fff; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px;
}
.mic.on { background: $brand-deep; }
.mic.off { opacity: .45; }
.dipt {
  flex: 1; min-width: 0; background: $bg-page; border-radius: 18px;
  padding: 9px 12px; font-size: 12.5px; color: $text-title;
}
.send {
  flex: 0 0 auto; height: 34px; padding: 0 14px; border-radius: 17px; background: $brand;
  color: #fff; font-size: 12.5px; font-weight: 700; display: flex; align-items: center;
}
.send.disabled { opacity: .5; }

/* ── 「＋ 添加商品」页内弹层（原 ai-confirm.vue 那一版）
      z-index 必须高于自定义 tabBar（999），否则底部「完成」条会被压住 ── */
.pk-mask {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; background: rgba(0, 0, 0, .45);
  z-index: 1000; display: flex; align-items: flex-end;
}
.pk-sheet {
  width: 100%; height: 76vh; background: #fff; border-radius: 14px 14px 0 0;
  display: flex; flex-direction: column; overflow: hidden;
}
.pk-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid #F5F6F8; flex: 0 0 auto; }
.pk-title { font-size: 15px; font-weight: 700; color: $text-title; }
.pk-close { display: inline; color: $text-placeholder; font-size: 16px; padding: 0 4px; }
.pk-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; flex: 0 0 auto; }
.pk-input { flex: 1; background: $bg-page; border-radius: 16px; padding: 7px 13px; font-size: 12.5px; }
.pk-search-btn { display: inline; font-size: 13px; color: $brand; font-weight: 600; flex-shrink: 0; }
.pk-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
.pk-cate { width: 82px; background: #F7F8FA; height: 100%; flex-shrink: 0; }
.pk-cate-item { padding: 12px 6px; font-size: 12px; color: $text-second; text-align: center; }
.pk-cate-item.on { background: #fff; color: $brand; font-weight: 700; }
.pk-list { flex: 1; min-width: 0; height: 100%; padding: 4px 12px; box-sizing: border-box; }
.pk-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #F5F6F8; }
.pk-info { flex: 1; min-width: 0; }
.pk-name { font-size: 13px; font-weight: 600; color: $text-title; }
.pk-spec { font-size: 10px; color: $text-second; margin-top: 2px; overflow: hidden; white-space: nowrap; }
.pk-price { font-size: 12px; color: $danger; font-weight: 700; margin-top: 2px; }
.pk-stepper { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.st-btn {
  width: 24px; height: 24px; border-radius: 50%; border: 1px solid $border-strong; background: #fff;
  font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; color: $text-body;
}
.pk-qty { min-width: 20px; text-align: center; font-size: 12.5px; font-weight: 700; color: $text-title; }
.pk-add {
  width: 26px; height: 26px; border-radius: 50%; background: $brand; color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
}
.pk-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid $border; flex: 0 0 auto; }
.pk-foot-txt { flex: 1; font-size: 12px; color: $text-second; }
.pbtn { flex: none; border-radius: 10px; padding: 9px 20px; text-align: center; font-size: 13.5px; font-weight: 700; }
.pbtn.primary { background: $brand; color: #fff; }
.empty-tip { text-align: center; color: $text-placeholder; padding: 24px 0; font-size: 13px; }
</style>
