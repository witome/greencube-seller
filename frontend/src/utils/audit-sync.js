import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { registerPoller, isPermissionError, toastOnce } from './poller-registry'

/**
 * 审核状态自动同步 —— 三角色（采购方/供应商/配送员）唯一共享实现（2026-09-19 拍板卡） *
 * 背景：采购方那份「onShow 拉一次 + 25 秒轻轮询 + 状态跃迁自动进入」先写在
 * pending-verify.vue 里；本文件把它抽成 composable，供应商/配送员复用同一份，
 * 防止「复制三份、只改一份」的老问题（前两卡各栽过一次）。
 *
 * ⚠️ 三角色的状态值含义不同（库内事实，见各 service 注释）：
 *   - 采购方 Purchaser.accountStatus：1 待审核 / 2 已激活(=通过) / 3 未通过
 *   - 供应商 Supplier.status：        0 待审核 / 1 合作中(=通过) / 2 停合作
 *   - 配送员 Courier.status：         0 待审核(申请制注册写入) / 1 正常(=通过) / 2 停用 / 9 黑名单
 *     （trialStatus 是试跑期标记，与审核无关）
 * 映射集中在此定义，任何角色调整只改这一处。
 */
export const AUDIT_PASS_STATUS = { purchaser: 2, supplier: 1, courier: 1 }
export const AUDIT_REJECT_STATUS = { purchaser: [3], supplier: [2], courier: [2, 9] }

export const ROLE_HOME = {
  purchaser: '/pages/buyer/home',
  supplier: '/subpkg-supplier/pages/home',
  courier: '/subpkg-courier/pages/home',
}

/** 审核通过后按角色进入对应首页 */
export function goRoleHome(role) {
  uni.reLaunch({ url: ROLE_HOME[role] || ROLE_HOME.purchaser })
}

/**
 * 挂载审核状态自动同步（必须在页面 setup 顶层调用，内部注册 onShow/onHide/onUnload）
 *
 * @param {Object}   opts
 * @param {Function} opts.fetchStatus  async () => 审核状态数据（接口失败由调用方内部兜底，composable 静默忽略异常）
 * @param {Function} [opts.onRefresh]  (data) => void：每次成功拉取且未跃迁时调用（更新步骤条等 UI）
 * @param {Function} opts.onApproved   (data) => void：状态达标（通过）→ 自动进入后续界面
 * @param {Function} [opts.onRejected] (data) => void：状态被拒（未通过/停用/黑名单）
 * @param {String}   opts.role         'purchaser' | 'supplier' | 'courier'
 * @param {Number}   [opts.intervalMs] 轮询间隔，默认 25000
 * @returns {{ refresh: Function, markLeaving: Function }} refresh 供外部手动刷新；markLeaving 停止轮询与跃迁
 */
export function setupAuditSync({ fetchStatus, onRefresh, onApproved, onRejected, role, intervalMs = 25000 }) {
  let timer = null
  let leaving = false // 已触发跃迁/外部叫停：后续轮询不再处理

  const stopTimer = () => {
    if (timer) { clearInterval(timer); timer = null }
  }

  const refresh = async () => {
    if (leaving) return
    try {
      const data = await fetchStatus()
      if (!data || leaving) return
      const pass = AUDIT_PASS_STATUS[role] || AUDIT_PASS_STATUS.purchaser
      const rejects = AUDIT_REJECT_STATUS[role] || AUDIT_REJECT_STATUS.purchaser
      if (data.accountStatus === pass) {
        leaving = true
        onApproved && onApproved(data)
        return
      }
      if (rejects.includes(data.accountStatus)) {
        leaving = true
        onRefresh && onRefresh(data) // 先把驳回步骤/原因刷上，再走各自驳回路径
        onRejected && onRejected(data)
        return
      }
      onRefresh && onRefresh(data)
    } catch (e) {
      // 权限类错误（2001 未登录 / 2002 当前身份无此权限 / 4001）→ 立即自停：
      // 场景是「已切到其它身份但本页面轮询还活着」，继续轮只会反复弹权限提示
      if (isPermissionError(e)) {
        leaving = true
        stopTimer()
        unregister()
        toastOnce(`audit-sync:${role}`, '身份已切换，审核状态同步已停止')
        return
      }
      // 接口不可用/无档案：保持页面静态兜底，等下一轮
    }
  }

  // 全局登记：切换身份/退出登录时由 stopAllPollers() 强制停（reLaunch 不一定触发 onHide/onUnload）
  const unregister = registerPoller(`audit-sync:${role}`, () => {
    leaving = true
    stopTimer()
  })

  // onShow 拉一次 + 轻轮询（onHide/onUnload 必须清定时器，防后台空转与重复请求）
  onShow(() => {
    leaving = false
    refresh()
    if (!timer) timer = setInterval(refresh, intervalMs)
  })
  onHide(stopTimer)
  onUnload(stopTimer)

  return {
    refresh,
    markLeaving: () => { leaving = true },
  }
}
