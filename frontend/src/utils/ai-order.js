import { buyerApi, demandApi } from '@/api/modules'
import { draft, setDraft } from '@/utils/ai-draft'

/**
 * 「送一句话给 AI」—— 全仓唯一共享实现（2026-09-30 卡AN）
 *
 * 两个调用方：助手页 `pages/buyer/kefu.vue`（打字/话筒）与浮动按钮 `AiOrderFab.vue`（按住说话）。
 * 抽出来的原因：两边要的**行为必须一字不差**（同一份解析、同一份草稿、同一份需求登记），
 * 否则「在助手页说」和「在外面按住说」会给出不同结果 —— 那是最难查的一类 bug。
 *
 * 🔒 铁律：
 *   ① **前端不做草稿合并** —— /ai/parse 返回的就是合并后的整份草稿，这里整份换上去；
 *   ② **不弹任何 UI** —— 不 showToast / 不 showModal / 不 showLoading。提示由调用方决定
 *      （助手页要气泡，FAB 要原地轻提示），一弹就会两处文案分叉；
 *   ③ 未收录的菜 → 走 report 接口登记采购需求，**失败一律静默**（绝不影响正常下单）；
 *   ④ 接口异常**不抛出**，返回 `error:true` 让调用方自己决定怎么提示
 *      （request.js 已经统一 toast 过错误了，这里再弹就是重复弹）。
 */

/** 当前草稿 → /ai/parse 的 ctx（**只带草稿行，不带历史原话**） */
function draftPayload() {
  const d = draft.value
  return {
    draft: ((d && d.items) || []).map((it) => ({
      productId: it.productId,
      qty: it.qty,
      unit: it.unit,
      name: it.name,
    })),
    draftDeliveryDate: (d && d.deliveryDate) || '',
    draftRemark: (d && d.remark) || '',
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
 * 把一句话送给 AI：解析 → 整份草稿换上来 → 未收录的菜登记采购需求。
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
  try {
    const parse = await buyerApi.aiParse(t, draftPayload())
    // 服务端已经把这句话合并到草稿上了 —— 整份换上来即可（前端不合并）
    setDraft(parse)
    let demandRecorded = false
    // 需要反问时草稿不动，也不登记（口径：不确定就反问）
    if (!parse.needClarify && (parse.unmatched || []).length) {
      demandRecorded = await reportDemand(parse.unmatched)
    }
    return {
      draft: parse,
      changes: parse.changes || [],
      needClarify: parse.needClarify || '',
      unmatched: parse.unmatched || [],
      demandRecorded,
    }
  } catch (e) {
    // 错误已由 request.js 统一提示；草稿保持不变
    return { draft: draft.value, changes: [], needClarify: '', unmatched: [], demandRecorded: false, error: true }
  }
}
