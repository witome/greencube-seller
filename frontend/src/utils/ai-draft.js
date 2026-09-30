import { ref } from 'vue'

/**
 * 共享订单草稿 —— 全仓唯一一份（2026-09-30 卡AN）
 *
 * 背景：右下角 AI 浮动按钮（AiOrderFab）要能「按住说一句话就记进草稿」，
 * 而草稿原本是 `pages/buyer/kefu.vue` 页面内的一个 `ref` —— FAB 在别的页面上，
 * 够不到它。所以把草稿提到模块级单例：**FAB 与助手页读写的是同一份**。
 *
 * 🔒 三条口径（大辉 2026-09-30 拍板）：
 *   ① 只共享**草稿**，不共享对话流 —— `messages`（对话气泡）仍留在 kefu.vue 页面内，
 *      所以「在外面说了话再进助手页」会出现「有草稿卡、没有对话记录」，这是**预期**的
 *      （口径：不带历史原话）。同理，退出小程序再进来就是一张新草稿。
 *   ② **不落 storage** —— 模块级单例活在小程序进程里；不写 `uni.setStorageSync`。
 *      （确认页那份 `aiDraft` storage 是给 ai-confirm 读的，是另一条线，别混。）
 *   ③ **购物车与草稿相互独立** —— 这里既不会被购物车写，也不会写进购物车。
 *      购物车有它自己的服务端购物车（cart_item），两边永不同步。
 */

/** 当前草稿（可为 null）。结构 = 服务端 /ai/parse 返回的整份草稿：
 *  { items:[{productId,name,unit,qty,qtyText,weighType,price}], deliveryDate, deliveryDateLabel, remark, total, ... } */
export const draft = ref(null)

/** 整份替换草稿（只允许写服务端返回的完整草稿——前端**不做合并**，合并只有服务端一处） */
export function setDraft(d) {
  draft.value = d || null
}

/** 清空草稿（助手页「清空重来」、下单成功后） */
export function clearDraft() {
  draft.value = null
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
