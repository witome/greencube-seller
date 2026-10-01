import { ref } from 'vue'
import { get, put } from '@/api/request'

/**
 * 共享订单草稿 —— 全仓唯一一份（2026-09-30 卡AN 建立；2026-10-01 卡AQ 改为服务端草稿）
 *
 * 背景：右下角 AI 浮动按钮（AiOrderFab）要能「按住说一句话就记进草稿」，
 * 而草稿原本是 `pages/buyer/kefu.vue` 页面内的一个 `ref` —— FAB 在别的页面上，
 * 够不到它。所以把草稿提到模块级单例：**FAB 与助手页读写的是同一份**。
 *
 * 🔒 卡AQ（2026-10-01）口径变更：**购物车与 AI 草稿合并成一份，落服务端 `cart_item`**
 *   · 手动「加入草稿」写 `POST /cart`；AI 说话写 `PUT /cart/sync`（**唯一**的整份写口）；
 *   · `/ai/parse` **保持只读**，绝不写库；
 *   · 本模块只做「服务端 cart_item → 本地镜像」，**前端永远不做合并**（合并只有服务端一处）；
 *   · 草稿页（cart.vue）每次拉到 cart 都调 `setDraftFromCart()` 同步这份镜像，
 *     这样 FAB 角标、助手页草稿卡、商品页「加入草稿」看到的都是同一份。
 *
 * 🔒 三条旧口径（大辉 2026-09-30 拍板，仍然有效）：
 *   ① 只共享**草稿**，不共享对话流 —— `messages`（对话气泡）仍留在页面内，
 *      「在外面说了话再进助手页」会出现「有草稿卡、没有对话记录」，这是**预期**的（不带历史原话）。
 *   ② ~~不落 storage~~ → **卡AQ 例外**：`ai-confirm.vue`（已上生产）的 onLoad 里有
 *      `uni.getStorageSync('aiDraft') || null` 的判空分支，空了会 toast「未找到订单草稿」并 navigateBack；
 *      `kefu.vue`（已上生产、本卡零改动）的「去结算」也是靠写这份 storage 把草稿递过去。
 *      为让两条旧路径都继续成立，**本模块在 setDraft 里统一维护这份镜像**（写镜像的只有这一处，
 *      不再散落在页面里，避免两处写法分叉）。它只是**兼容镜像**，服务端 cart_item 才是真身。
 *   ③ ~~购物车与草稿相互独立~~ → 卡AQ 起**合并**：见上。
 */

/** 当前草稿（可为 null）。结构 = 服务端 /ai/parse 返回的整份草稿：
 *  { items:[{productId,name,unit,qty,qtyText,weighType,price}], deliveryDate, deliveryDateLabel, remark, total, ... } */
export const draft = ref(null)

/**
 * 三字段（配送日期 / 送达时段 / 备注）—— **前端持有，不落服务端表**（卡AQ 拍板第 3 条）
 * 下单时才随 placeOrder 一起传给后端（后端已支持 remark；deliveryDate / timeWindow 本就是下单入参）。
 */
export const deliveryMeta = ref({ deliveryDate: '', timeWindow: 0, remark: '' })

/** 部分更新三字段（传 null / 不传的字段保持原值） */
export function setMeta(patch) {
  deliveryMeta.value = { ...deliveryMeta.value, ...(patch || {}) }
}

/** 清空三字段（清空草稿时一起清） */
export function clearMeta() {
  deliveryMeta.value = { deliveryDate: '', timeWindow: 0, remark: '' }
}

/**
 * 唯一的写库口：把「合并后的完整 items」整体替换到服务端 cart_item。
 * ⚠️ /ai/parse 只读，写只走 `PUT /cart/sync`；qty 已是「斤」，**绝不二次换算**。
 * @param {Array<{productId:number, qty:number}>} items
 * @returns {Promise<{list:Array, totalAmount:number}>} 与 GET /cart 同形状
 */
export async function syncCartDraft(items) {
  const rows = (items || [])
    .filter((it) => it && it.productId != null && Number(it.qty) > 0)
    .map((it) => ({ productId: Number(it.productId), qty: Number(it.qty) }))
  return put('/cart/sync', { items: rows })
}

/** 读服务端草稿（cart_item）；失败抛出，由调用方决定怎么提示 */
export async function fetchCartDraft() {
  return get('/cart')
}

/**
 * cart_item 列表 → 共享草稿对象（补齐 kefu.vue 草稿卡渲染要的 qtyText / deliveryDateLabel / total）
 * kefu.vue 已上生产、本卡零改动，它读的是 `draft.items[].qtyText`、`draft.deliveryDateLabel`、`draft.total`，
 * 所以这里必须把 cart_item 的形状补齐成 /ai/parse 的形状，否则助手页草稿卡会渲染成 undefined。
 */
export function draftFromCart(list, extra) {
  const items = (list || []).map((it) => ({
    productId: it.productId,
    cartItemId: it.cartItemId,
    name: it.name,
    unit: it.unit,
    specText: it.specText || null,
    weighType: it.weighType,
    qty: Number(it.qty),
    // ⚠️ cart 出参是 salePrice，助手页/确认页一律用 price —— 换算只在这一处
    price: Number(it.salePrice),
    amount: Math.round(Number(it.qty) * Number(it.salePrice) * 100) / 100,
    qtyText: `${Number(it.qty)}${it.unit || ''}`,
  }))
  const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
  const d = draft.value || {}
  const meta = deliveryMeta.value || {}
  const deliveryDate = (extra && extra.deliveryDate) || meta.deliveryDate || d.deliveryDate || ''
  return {
    ...d,
    ...(extra || {}),
    items,
    total,
    deliveryDate,
    deliveryDateLabel:
      (extra && extra.deliveryDateLabel) || d.deliveryDateLabel || (deliveryDate ? deliveryDate.slice(5) : '尽快'),
    remark: meta.remark || (extra && extra.remark) || d.remark || '',
    timeWindow: meta.timeWindow || d.timeWindow || 0,
  }
}

/** 整份替换草稿（只允许写服务端返回的完整草稿——前端**不做合并**，合并只有服务端一处） */
export function setDraft(d) {
  draft.value = d || null
  mirrorToStorage()
}

/** 用服务端 cart_item 列表整份替换草稿（草稿页 / AI 说话后统一走这里） */
export function setDraftFromCart(list, extra) {
  setDraft(draftFromCart(list, extra))
}

/**
 * 兼容镜像：把草稿写进 storage `aiDraft`。
 * 只为了两处**已上生产、本卡不许动**的旧路径（ai-confirm 判空分支 + kefu「去结算」），
 * 真身永远是服务端 cart_item。草稿为空时把镜像删掉，避免确认页读到一份空壳。
 */
function mirrorToStorage() {
  try {
    const d = draft.value
    if (!d || !(d.items || []).length) {
      uni.removeStorageSync('aiDraft')
      return
    }
    uni.setStorageSync('aiDraft', { ...d, items: d.items.map((it) => ({ ...it })) })
  } catch (e) {
    /* 镜像写不进去不影响主流程 */
  }
}

/** 清空草稿（助手页「清空重来」、下单成功后） */
export function clearDraft() {
  draft.value = null
  try {
    uni.removeStorageSync('aiDraft')
  } catch (e) {
    /* 忽略 */
  }
}

/**
 * 菜名 → emoji（清单行的小图标）
 * ⚠️ 与 kefu.vue / ai-confirm.vue 里那份 map 完全一致的顺序（先具体后泛化：「白菜」要在「菜」之前），
 *    放在这里是为了让草稿页（cart.vue）不必再抄一份 —— 抄两份迟早会有一处漏改。
 */
export function emojiOf(name) {
  const map = [
    ['白菜', '🥬'], ['菜', '🥬'], ['土豆', '🥔'], ['肉', '🥩'], ['姜', '🫚'], ['葱', '🌿'],
    ['蛋', '🥚'], ['鸡', '🍗'], ['鱼', '🐟'], ['米', '🌾'], ['面', '🍜'], ['茄', '🍆'],
    ['瓜', '🥒'], ['萝卜', '🥕'], ['菇', '🍄'], ['豆', '🫘'],
  ]
  const n = String(name || '')
  for (const [k, e] of map) if (n.includes(k)) return e
  return '🥬'
}

/** 草稿里的**商品种类数**（FAB 角标用；注意不是总斤数、不是总件数） */
export function itemCount() {
  const d = draft.value
  return ((d && d.items) || []).length
}

/**
 * 「有菜没上架」跨页状态（2026-09-30 卡AO）
 *
 * 要解决的问题：客户在**别的页面**按住右下角 FAB 说的菜如果还没上架，
 * 采购需求确实登记到后台了，但客户当场看不到任何提示，也不知道能开到货通知；
 * 而「🤔 我还没上架，已帮你记下」+「到货通知我」按钮只住在助手页 `kefu.vue` 的对话气泡里，
 * 对话流 `messages` 是页面本地的、不共享 —— 所以这条信息在页外就丢了。
 *
 * 这里的做法：FAB 那一次说话留下一条**跨页状态**（没对上的菜名 + 采购需求是否真的登记成功），
 * 助手页 `onLoad` 取走它、补一条与页内说话**完全同构**的 AI 气泡（现成的按钮就在那里），
 * 取走即清。**不复制订阅逻辑** —— 订阅按钮与 `uni.requestSubscribeMessage` 仍只有助手页那一份。
 *
 * ⚠️ 与草稿同样口径：**模块级单例、不落 storage**，退出小程序即清。
 * 结构：`{ texts: string[], recorded: boolean }` 或 `null`
 *   texts    = 这句里没对上商品的菜名
 *   recorded = 采购需求是否**真的登记成功**（失败就是 false，不许假装记下了）
 */
export const pendingUnmatched = ref(null)

/** 写入待处理的「有菜没上架」状态（传 null / 假值即清空） */
export function setPendingUnmatched(v) {
  pendingUnmatched.value = v || null
}

/** 清空（助手页取走后立刻调用，避免每次进助手页都重复冒同一条气泡） */
export function clearPendingUnmatched() {
  pendingUnmatched.value = null
}
