// 底部安全区高度（px）。JS 兜底：部分安卓机型 env() 返回 0，但系统栏确实占位。
export function getSafeBottomPx() {
  // #ifdef H5
  // 仅用于自动化验收与调试：?safeBottom=34 直接指定像素值
  try {
    const q = new URLSearchParams(location.search).get('safeBottom')
    if (q !== null && q !== '' && !isNaN(+q)) return Math.max(0, Math.round(+q))
  } catch (e) {}
  // #endif
  try {
    const s = uni.getSystemInfoSync()
    const sh = s.screenHeight || 0
    const sb = (s.safeArea && s.safeArea.bottom) || sh
    return Math.max(0, Math.round(sh - sb))
  } catch (e) {
    return 0
  }
}
