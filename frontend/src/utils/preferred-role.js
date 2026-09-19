/**
 * 「当前身份」持久化 —— 全仓唯一共享实现（2026-09-19 拍板卡）
 *
 * 背景（真机 bug）：后端 pickRole 在真实微信登录下（code 是微信一次性临时串）无法识别
 * 用户意图 → pickDefaultRole 永远回「采购方」。用户切到供应商/配送员后一重进小程序，
 * currentRole 被打回采购方，仍停在原角色页面时报 403「当前身份无此权限」。
 *
 * 方案（大辉拍板的推荐方案）：前端本地记住用户选的身份（preferredRole），
 * 登录成功后若该身份 ∈ 后端返回 roles 且 ≠ currentRole → 调已有 POST /auth/switch-role
 * 换签 token。不改登录接口契约、不新增接口。
 *
 * 安全铁律：preferredRole 只用于「在用户已拥有的角色里挑一个」——
 * 服务端 /auth/switch-role 仍以 resolveRoles 结果为准校验所有权（不具备即拒绝），
 * 客户端伪造的身份最多被忽略，绝不可能提权。
 */
import { authApi } from '@/api/modules'

/** 用户上次主动选择的身份（无则空串） */
export function getPreferredRole() {
  return uni.getStorageSync('preferredRole') || ''
}

/** 切换身份成功后调用（store.switchRole 是唯一写入点，防多入口漂移） */
export function rememberPreferredRole(role) {
  if (role) uni.setStorageSync('preferredRole', role)
}

/** 退出登录时清除（下次登录回到后端默认身份） */
export function forgetPreferredRole() {
  uni.removeStorageSync('preferredRole')
}

/**
 * 登录成功后恢复用户上次选的身份。
 * data 为 wx-login 返回对象（token/roles/currentRole/...），本函数可能原地覆写
 * data.token / data.currentRole，调用方随后照常落 storage 即可。
 * 恢复失败（网络/校验拒绝）静默保留后端默认身份，绝不阻断登录。
 */
export async function restorePreferredRole(data) {
  if (!data || !Array.isArray(data.roles)) return data
  const preferred = getPreferredRole()
  // 仅当：用户记住过身份 + 该身份确实属于自己（服务端还会再校验一次）+ 与本次默认不同
  if (!preferred || !data.roles.includes(preferred) || preferred === data.currentRole) return data
  try {
    // ⚠️ 先把本次登录的新 token 落 storage：authApi 走 request 层从 storage 取
    // Authorization 头，此时登录流程尚未写 storage，不先落就会 401 导致恢复静默失败
    uni.setStorageSync('token', data.token)
    uni.setStorageSync('currentRole', data.currentRole)
    const sw = await authApi.switchRole(preferred) // 服务端校验所有权 + 重签 token
    data.token = sw.token
    data.currentRole = sw.currentRole || preferred
  } catch (e) {
    // 恢复失败：保留后端默认身份（例如身份被运营撤回），不影响登录本身
  }
  return data
}
