import { buyerApi, demandApi } from '@/api/modules'
import {
  draft,
  setDraftFromCart,
  setMeta,
  deliveryMeta,
  syncCartDraft,
  fetchCartDraft,
  setPendingUnmatched,
} from '@/utils/ai-draft'

/**
 * 「送一句话给 AI」—— 全仓唯一共享实现（2026-09-30 卡AN 建立；2026-10-01 卡AQ 改走服务端草稿）
 *
 * 两个调用方：AI 下单页 `cart.vue`（打字/话筒，卡AT 起助手页已并入它）与浮动按钮 `AiOrderFab.vue`（按住说话）。
 * 抽出来的原因：两边要的**行为必须一字不差**（同一份解析、同一份草稿、同一份需求登记），
 * 否则「在助手页说」和「在外面按住说」会给出不同结果 —— 那是最难查的一类 bug。
 *
 * 🔒 铁律：
 *   ① **前端不做草稿合并** —— /ai/parse 返回的就是合并后的整份草稿，这里整份换上去；
 *   ② `/ai/parse` 只读 —— 写服务端草稿只走 `PUT /cart/sync`（卡AQ 新增），且**只在本文件这一处调**；
 *   ③ **不弹任何 UI** —— 不 showToast / 不 showModal / 不 showLoading。提示由调用方决定
 *      （助手页要气泡，FAB 要原地轻提示），一弹就会两处文案分叉；
 *   ④ 未收录的菜 → 走 report 接口登记采购需求，**失败一律静默**（绝不影响正常下单）；
 *   ⑤ 接口异常**不抛出**，返回 `error:true` 让调用方自己决定怎么提示
 *      （request.js 已经统一 toast 过错误了，这里再弹就是重复弹）。
 *
 * 卡AQ 流程：读 cart_item → /ai/parse（只读，带上当前草稿）→ PUT /cart/sync 整体落库 → 更新本地镜像。
 */

/** 当前草稿 → /ai/parse 的 ctx（**只带草稿行，不带历史原话**） */
function draftPayload(items) {
  const meta = deliveryMeta.value || {}
  return {
    draft: (items || []).map((it) => ({
      productId: it.productId,
      qty: it.qty,
      unit: it.unit,
      name: it.name,
    })),
    draftDeliveryDate: meta.deliveryDate || (draft.value && draft.value.deliveryDate) || '',
    draftRemark: meta.remark || (draft.value && draft.value.remark) || '',
  }
}

/**
 * 说话前的「当前草稿」＝服务端 cart_item。
 * ⚠️ 必须**现读服务端**而不是直接用本地镜像：客户可能刚在商品页手动「加入草稿」（走 POST /cart），
 *    或在草稿页手动 +/- 改过数量（走 PUT /cart/:id）—— 这些都不会更新本地镜像，
 *    用镜像当 ctx 会让服务端在**旧草稿**上合并，把手动加的东西冲掉。
 *    读不到才退回本地镜像（宁可用旧的，也不要因为一次网络抖动就丢草稿）。
 * @returns {Promise<Array<{productId:number, qty:number, unit:string, name:string}>>}
 */
async function currentDraftItems() {
  try {
    const data = await fetchCartDraft()
    return (data.list || []).map((it) => ({
      productId: it.productId,
      qty: Number(it.qty),
      unit: it.unit,
      name: it.name,
    }))
  } catch (e) {
    return ((draft.value && draft.value.items) || []).map((it) => ({
      productId: it.productId,
      qty: Number(it.qty),
      unit: it.unit,
      name: it.name,
    }))
  }
}

/** 上报「没认出来的菜」→ 后台「采购需求」；返回是否**真的登记成功**（失败一律静默） */
async function reportDemand(unmatched) {
  try {
    // ⚠️ 只上报**被识别成菜名的那一段**（unmatched 每项就是菜名），
    //    绝不把客户整句原话塞上去 —— 原话里常带电话/地址，会被后台导出成 CSV 发出去
    await demandApi.report(unmatched.map((t) => ({ rawText: t })), 1)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 把一句话送给 AI：读草稿 → 解析（只读）→ 整体写回 cart_item → 未收录的菜登记采购需求。
 * @param {string} text 客户说/打的这一句
 * @returns {Promise<{draft:object|null, changes:Array, needClarify:string, unmatched:string[],
 *                    demandRecorded:boolean, error?:boolean}>}
 *   error=true 时草稿**保持不变**，调用方自行提示。
 */
export async function sendUtterance(text) {
  const t = String(text == null ? '' : text).trim()
  // 空句直接返回当前草稿（与助手页「空文本不发请求」一致）
  if (!t) {
    return { draft: draft.value, changes: [], needClarify: '', unmatched: [], demandRecorded: false }
  }

  const before = await currentDraftItems()

  try {
    const parse = await buyerApi.aiParse(t, draftPayload(before))

    // 日期 / 备注：服务端可能从这句话里读出来 —— 落到前端三字段（不落服务端表）
    if (parse.deliveryDate) setMeta({ deliveryDate: parse.deliveryDate })
    if (parse.remark) setMeta({ remark: parse.remark })

    // ⚠️ 需要反问 → 草稿**一定不动**：不写库、本地镜像也不换（口径：不确定就反问，不许猜）
    if (parse.needClarify) {
      const unmatched = parse.unmatched || []
      if (!unmatched.length) setPendingUnmatched(null)
      return {
        draft: draft.value,
        changes: [],
        needClarify: parse.needClarify,
        unmatched,
        demandRecorded: false,
      }
    }

    // 写库：**唯一**一处 —— 整体替换 cart_item（qty 已是「斤」，不二次换算）
    const synced = await syncCartDraft(parse.items || [])
    // 以服务端返回为准整份换上来（前端不合并）
    setDraftFromCart(synced.list || [], parse)

    let demandRecorded = false
    if ((parse.unmatched || []).length) {
      demandRecorded = await reportDemand(parse.unmatched)
    }

    // 卡AO（2026-09-30）：把「有菜没上架」这件事记进**跨页状态** —— 页外（FAB 按住说）说完话后，
    // 助手页 onLoad 会把它补成一条与页内说话同构的「已帮你记下」气泡（订阅按钮仍只有助手页那一份）。
    //   · 非空 → 留下（recorded 如实反映登记结果，失败就是 false，不做假装记下）
    //   · 空 → 清掉上一次的
    const unmatched = parse.unmatched || []
    if (unmatched.length) {
      setPendingUnmatched({ texts: unmatched, recorded: demandRecorded })
    } else {
      setPendingUnmatched(null)
    }

    return {
      draft: draft.value,
      changes: parse.changes || [],
      needClarify: '',
      unmatched,
      demandRecorded,
    }
  } catch (e) {
    // 错误已由 request.js 统一提示；草稿保持不变
    return { draft: draft.value, changes: [], needClarify: '', unmatched: [], demandRecorded: false, error: true }
  }
}
