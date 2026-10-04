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
                <input
                  v-if="editingCartItemId === it.cartItemId"
                  class="stp-n stp-input"
                  type="number"
                  :value="qtyInput"
                  :focus="true"
                  :selection-start="0"
                  :selection-end="qtySelectionEnd"
                  confirm-type="done"
                  @input="onQtyInput"
                  @confirm="commitQtyEdit(it)"
                  @blur="commitQtyEdit(it)"
                />
                <text v-else class="stp-n" @tap="startQtyEdit(it)">{{ targetQty[it.cartItemId] != null ? targetQty[it.cartItemId] : it.qty }}</text>
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
                 卡BB（2026-10-01）：结算条保持一行，合计块在左维持两行短行；
                 按钮改为 flex 行内靠右，屏幕右距固定 80px，避开右侧 16~72px 的悬浮球带。 -->
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
    <!-- FAB offset 沿用 136；卡BB 只调整结算按钮横向位置。
         390px 屏上按钮右边界为 310px（距屏右 80px），FAB 横向带为 x∈[318,374]，两者间隔 8px、不重叠。 -->
    <AiOrderFab :offset="136" />

    <!-- ⑫ 「＋ 添加商品」页内选品弹层（原在 ai-confirm.vue：切页会丢草稿，必须保持页内弹层形态）
         卡BC（2026-10-01）：选品弹层抽出为共享组件 GoodsPicker（与订单详情「＋ 加菜」同一份实现），
         本页只留开关与回调；弹层内加减仍全部走服务端草稿（POST /cart、PUT /cart/:id、DELETE /cart/:id），
         不加本地临时态。 -->
    <GoodsPicker
      :open="pickerOpen"
      :qty-map="pkQtyMap"
      :foot-text="pkFootText"
      @close="closePicker"
      @add="addProduct"
      @dec="decProduct"
    />
  </view>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import { watch } from 'vue'
import { onLoad, onShow, onHide, onUnload, onShareAppMessage } from '@dcloudio/uni-app'
import { buyerApi, authApi, demandApi } from '@/api/modules'
import { availableTimeWindows, dateStr, tomorrowStr } from '@/utils/time-window'
import { guardBuyerSuspended } from '@/utils/account-guard'
import { createVoiceHold } from '@/utils/voice-record'
import { sendUtterance, takePendingDialogs } from '@/utils/ai-order'
import {
  setDraftFromCart,
  deliveryMeta,
  setMeta,
  clearMeta,
  emojiOf,
  syncCartDraft,
  clearDraft,
} from '@/utils/ai-draft'
import BuyerTabBar from '@/components/BuyerTabBar.vue'
import AiOrderFab from '@/components/AiOrderFab.vue'
import GoodsPicker from '@/components/GoodsPicker.vue'

const cart = ref([])

/** 金额一律渲染服务端给的数（salePrice / subtotal），前端不算价 */
const money = (v) => (Number(v) || 0).toFixed(2)

const totalAmount = ref('0.00')
const hasWeigh = computed(() => cart.value.some((it) => it.weighType === 1))

const load = async () => {
  const data = await buyerApi.getCart()
  cart.value = data.list || []
  // 合计只认 GET /cart 的后端返回值，不在前端重算
  totalAmount.value = money(data.totalAmount)
  syncTargetsAfterLoad()
}

const editingCartItemId = ref(null)
const qtyInput = ref('')
const qtySelectionEnd = ref(0)
const qtyCommitting = ref(false)

const finishQtyEdit = () => {
  editingCartItemId.value = null
  qtyInput.value = ''
  qtySelectionEnd.value = 0
}

const startQtyEdit = (it) => {
  if (qtyCommitting.value) return
  const current = String(it.qty)
  qtyInput.value = current
  qtySelectionEnd.value = current.length
  // 单一 id 控制编辑态，同一时刻只会渲染一个输入框
  editingCartItemId.value = it.cartItemId
}

const onQtyInput = (e) => {
  qtyInput.value = e.detail.value
  qtySelectionEnd.value = String(e.detail.value).length
}

const commitQtyEdit = async (it) => {
  if (editingCartItemId.value !== it.cartItemId || qtyCommitting.value) return
  const raw = String(qtyInput.value == null ? '' : qtyInput.value).trim()
  const qty = Number(raw)
  qtyCommitting.value = true
  // confirm 后输入框立即退出，随后到达的 blur 不会重复提交
  finishQtyEdit()
  try {
    if (!raw || !Number.isFinite(qty) || qty < 0) return
    if (qty === 0) {
      await remove(it)
      uni.showToast({ title: '商品已删除', icon: 'none' })
      return
    }
    if (qty === Number(it.qty)) return
    // PUT /cart/:id 是覆盖语义；禁止用 POST 导致数量累加
    await buyerApi.updateCart(it.cartItemId, qty)
    await load()
    uni.$emit('cart-badge-refresh')
  } finally {
    qtyCommitting.value = false
  }
}

// ── 卡CD（2026-10-04）：步进器防连点 —— 本地目标数量 + 每行串行补发 ──
// 旧实现连点 3 次「＋」都读到同一个旧 it.qty → 目标值相同 → 实际只 +1。
// 现在：点击立刻更新本地目标值（界面即时 +1 不闪回）；同一行同时只放一个 PUT 在飞，
// 在飞期间的点击只攒目标值；在飞返回并 load() 后若服务端 ≠ 目标值就补发（最多 3 次，
// 全失败则回滚本地值到服务端真值，提示由 request 层统一 toast）。金额/合计仍只认服务端。
const targetQty = reactive({}) // cartItemId -> 本地目标数量
const rowBusy = {} // cartItemId -> true（该行 PUT 在飞）

// 卡CD-2（2026-10-04）：本地目标值只是「服务端还没确认的那个意图」的临时占位。
// 每次 load() 拿到服务端真值后收口：在飞的行（用户正在点的）保留目标值，绝不能丢；
// 其余行的目标值全部作废 —— 显示与下次 +N 的基准都回到服务端真值。
// 这正是「AI 助手改量 / 另一台设备改量」能正确反映到界面与后续操作的关键。
const syncTargetsAfterLoad = () => {
  Object.keys(targetQty).forEach((id) => {
    if (rowBusy[id]) return // 该行 PUT 在飞，不动
    delete targetQty[id]
  })
}

const changeQty = async (it, delta) => {
  finishQtyEdit()
  const id = it.cartItemId
  const base = targetQty[id] != null ? Number(targetQty[id]) : Number(it.qty)
  const next = base + delta
  if (next <= 0) {
    // 减到 0 仍走既有 remove 路径；若该行 PUT 在飞，先记下目标 0，飞完由 flushRow 收尾
    if (rowBusy[id]) { targetQty[id] = 0; return }
    delete targetQty[id]
    await remove(it)
    return
  }
  targetQty[id] = next
  flushRow(id)
}

// 同一行串行补发：PUT → load() → 服务端值 ≠ 本地目标值就再来一轮（最多 3 次）
const flushRow = async (id) => {
  if (rowBusy[id]) return
  rowBusy[id] = true
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const target = targetQty[id]
      if (target == null) break // 目标已被清（行已删）
      const row = cart.value.find((r) => r.cartItemId === id)
      if (!row) break // 行已不在草稿里
      if (target <= 0) {
        delete targetQty[id]
        await remove({ cartItemId: id })
        break
      }
      // 卡CD-2：服务端已追上目标 → 本地目标值使命完成，立刻作废（收敛即清），
      // 否则它会继续骗显示、并当下次 +N 的基准去覆盖服务端新真值
      if (Number(row.qty) === target) { delete targetQty[id]; break }
      try {
        // PUT /cart/:id 是覆盖语义，直接覆盖为本地目标值
        await buyerApi.updateCart(id, target)
      } catch (e) {
        if (attempt === 2) delete targetQty[id] // 重试耗尽：回滚到服务端真值（it.qty 兜底显示）
        continue
      }
      await load()
      uni.$emit('cart-badge-refresh')
    }
  } finally {
    delete rowBusy[id]
  }
}

const remove = async (it) => {
  finishQtyEdit()
  await buyerApi.removeCart(it.cartItemId)
  await load()
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
 * 卡BB（2026-10-01）：对话气泡的唯一渲染入口。
 * sendUtterance() 无论由页内输入/话筒还是跨页 FAB 调用，都会留下同一形状的一次性条目；
 * 此处逐条补成「用户 + AI」两条气泡并取走即清，保证同一轮只出现一次。
 * 「没上架」也只由这里产出，不再另走 pendingUnmatched / flushPendingUnmatched，避免重复 AI 气泡。
 * @returns {number} 本次消费的对话轮数
 */
const drainPendingDialog = () => {
  const entries = takePendingDialogs()
  entries.forEach((entry) => {
    pushMsg({ role: 'me', text: entry.userText })
    pushMsg({
      role: 'ai',
      error: !!entry.error,
      changes: entry.changes || [],
      needClarify: entry.needClarify || '',
      unmatched: entry.unmatched || [],
      demandRecorded: !!entry.demandRecorded,
      notifySubscribed: false,
    })
  })
  return entries.length
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
  // 人在本页用 FAB 说完时，事件回调当场补齐这一轮「用户 + AI」气泡
  drainPendingDialog()
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
  const res = await sendUtterance(t)
  // 页内打字/话筒也只走 sendUtterance 队列；禁止再直接 push 第二套气泡
  drainPendingDialog()
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
const loadAddress = async () => {
  try {
    const profile = await buyerApi.getProfile()
    address.value = (profile && profile.address) || ''
  } catch (e) {
    address.value = ''
  }
}

// ⚠️ tabBar 页面切换回来只触发 onShow 不触发 onLoad，草稿与地址刷新都必须放 onShow
onShow(async () => {
  visible.value = true // 卡AU：本页回到前台 → 允许「AI 草稿同步」事件触发重拉
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  ensureMeta()
  load()
  await loadAddress()
  // 卡BB：回页时消费跨页 FAB 留下的完整对话；取走即清，第二次 onShow 不会重复。
  drainPendingDialog()
})

onHide(() => {
  // 卡AU：离开本页后别再响应 ai-draft-synced（回前台时 onShow 会整体刷新一次，不会漏）
  visible.value = false
})
onUnload(() => {
  visible.value = false
  // ⚠️ 必须 off：页面反复进出会重复注册同一个监听 → 一次事件触发 N 遍 load()
  uni.$off('ai-draft-synced', onDraftSynced)
  // 卡CD-2：targetQty/rowBusy 都是内存态，离页清空，防下次进页面拿到上一轮残留
  Object.keys(targetQty).forEach((id) => delete targetQty[id])
  Object.keys(rowBusy).forEach((id) => delete rowBusy[id])
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

// ── 添加商品弹层（卡BC 2026-10-01：选品逻辑抽出为共享组件 GoodsPicker，
//     本页只保留开关、已选数量映射与「写服务端草稿」的回调）──
const pickerOpen = ref(false)

/** 传给 GoodsPicker 的已选数量映射 { [productId]: qty }（小程序端 props 走序列化，只能传普通对象） */
const pkQtyMap = computed(() => {
  const m = {}
  cart.value.forEach((it) => { m[it.productId] = Number(it.qty) || 0 })
  return m
})
/** 弹层底部文案：与抽出前完全一致（金额用服务端返回的 totalAmount，前端不算价） */
const pkFootText = computed(() => '已选 ' + cart.value.length + ' 项 · 预估 ¥' + totalAmount.value)

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

// 分类 / 商品列表 / 搜索 / 切分类的加载逻辑已搬进 GoodsPicker 内部（打开时按需拉一次）
const openPicker = () => { pickerOpen.value = true }
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
.stp-input {
  width: 42px; min-width: 42px; height: 22px; padding: 0 3px; box-sizing: border-box;
  border: 1px solid $brand; border-radius: 5px; background: #fff; line-height: 22px;
}

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

/* 卡内结算条（卡BB 2026-10-01）：一行式，合计块在左，按钮行内靠右。
   `.col-inner` 与 `.dcard-bd` 右内边距合计 23px，按钮再留 57px 右外边距，
   所以按钮右边界距屏幕右侧恒为 23 + 57 = 80px。 */
.dc-foot {
  margin-top: 8px; border-top: 1px solid #F0F1F3; padding-top: 8px;
  display: flex; align-items: center; min-height: 36px;
}
.dc-tt { flex: 0 0 auto; text-align: left; }
.dc-tt-a { display: block; font-size: 12px; color: $text-second; line-height: 1.45; white-space: nowrap; }
.dc-tt-b { display: block; color: $danger; font-size: 14px; font-weight: 800; line-height: 1.3; margin-top: 2px; white-space: nowrap; }
.dc-go {
  flex: 0 0 auto; margin-left: auto; margin-right: 57px;
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

/* 卡BC（2026-10-01）：「＋ 添加商品」弹层的 .pk-* 样式已随组件搬进
   components/GoodsPicker.vue（scoped 只作用于组件内部，父级样式管不到子元素），此处不再保留。 */
</style>
