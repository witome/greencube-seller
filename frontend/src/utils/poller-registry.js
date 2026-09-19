/**
 * 全局轮询器登记表（2026-09-19 拍板卡：切身份弹「当前身份无此权限」根因修复）
 *
 * 背景：new-order-alerter（30s）与 audit-sync（25s）原先只在 onHide 停；
 * 切换身份走 uni.reLaunch（可能不触发旧页 onHide/页面实例销毁时机不定），
 * 旧页面轮询继续拿新身份 token 调旧角色接口 → 守卫拒 → 反复弹「当前身份无此权限」。
 *
 * 解法：所有轮询器启动时在这里登记自己的 stop 函数，
 * 切换身份/退出登录入口（store/user.js 的 switchRole/logout、App.vue 与
 * DevRoleSwitcher 的 dev 切换浮窗）在 reLaunch 前调用 stopAllPollers() 强制全停。
 */

/** tag -> stop()，同一页面组件重复挂载时后注册覆盖先注册 */
const pollers = new Map()

/** 轮询器启动时登记；返回注销函数（组件自带 onUnload 清理时调用） */
export function registerPoller(tag, stop) {
  pollers.set(tag, stop)
  return () => {
    if (pollers.get(tag) === stop) pollers.delete(tag)
  }
}

/** 切换身份/退出登录时强制停掉所有已登记轮询（先停再 reLaunch） */
export function stopAllPollers() {
  pollers.forEach((stop, tag) => {
    try { stop() } catch (e) { /* 单个失败不影响其它 */ }
  })
  pollers.clear()
}

/**
 * 权限类错误判定：命中即轮询自停（防「拿新身份 token 反复调旧角色接口」）。
 * - 2001 未登录 / token 失效
 * - 2002 FORBIDDEN「当前身份无此权限」（backend error-codes.ts 实际定义）
 * - 4001 拍板卡点名，一并纳入
 */
export function isPermissionError(e) {
  const code = e && (e.code ?? e.statusCode)
  return code === 2001 || code === 2002 || code === 4001
}

/** 同一提示只弹一次（轮询器自停时用；重复弹窗正是本次 bug 的用户感知） */
const toasted = new Set()
export function toastOnce(key, msg) {
  if (toasted.has(key)) return
  toasted.add(key)
  uni.showToast({ title: msg, icon: 'none' })
}
