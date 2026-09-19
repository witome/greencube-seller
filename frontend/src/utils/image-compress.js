/**
 * 图片压缩工具：上传前统一压到 300KB 以内（返回 data URI，直接给 uploadApi.uploadImage）
 *
 * 背景（2026-09-19 拍板卡）：手机照片 1-3MB，即便后端 JSON body 已放宽到 5MB，
 * 大图传输与存储也浪费，且容易顶到上限——故所有上传入口先在本地压缩。
 *
 * - MP-WEIXIN：uni.compressImage 质量递减（80→55→30），仍超限再降分辨率
 * - H5/浏览器：canvas 重绘为 JPEG（白底，防透明 PNG 转 JPEG 变黑底），
 *   质量×分辨率逐步下降直到达标；原图本就 ≤300KB 时原样返回（保住二维码画质）
 */

const MAX_KB = 300
// data URI 长度上限：base64 相对原始字节膨胀 4/3，再留一点头部余量
const MAX_DATAURI_LEN = Math.ceil((MAX_KB * 1024 * 4) / 3) + 100

/** 本地文件转 base64 data URI（小程序端 readFile；H5 端 chooseImage 返回 blob/data URL 原样即可） */
function fileUriToBase64(path) {
  return new Promise((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (r) => resolve(`data:image/jpeg;base64,${r.data}`),
      fail: reject,
    })
    // #endif
    // #ifndef MP-WEIXIN
    resolve(path)
    // #endif
  })
}

// ── MP-WEIXIN ──
function compressOnceWx(src, quality, compressedWidth) {
  return new Promise((resolve, reject) => {
    uni.compressImage({
      src,
      quality,
      ...(compressedWidth ? { compressedWidth } : {}),
      success: resolve,
      fail: reject,
    })
  })
}

function getFileSizeWx(filePath) {
  return new Promise((resolve) => {
    uni.getFileInfo({
      filePath,
      success: (r) => resolve(r.size || 0),
      fail: () => resolve(0),
    })
  })
}

async function compressMp(path) {
  let quality = 80
  let width = 0 // 0 = 不降分辨率
  let current = path
  for (let i = 0; i < 4; i++) {
    try {
      const r = await compressOnceWx(current, quality, width || undefined)
      current = r.tempFilePath
      const size = await getFileSizeWx(current)
      if (size && size <= MAX_KB * 1024) return current
      quality = Math.max(20, quality - 25)
      if (i >= 1) width = 1080 // 两轮质量压缩仍超限 → 降分辨率兜底
    } catch (e) {
      break // compressImage 不可用（低版本基础库）→ 用原图直传，后端 5MB 校验兜底
    }
  }
  return current
}

// ── H5 / 浏览器 ──
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawToDataUri(img, scale, quality) {
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff' // 透明底先铺白（PNG 二维码/截图转 JPEG 不变黑底）
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function compressH5(path) {
  // 原图本就达标 → 原样返回（小二维码零损失）
  if (/^data:image\//i.test(path)) {
    if (path.length <= MAX_DATAURI_LEN) return path
  } else {
    try {
      const blob = await (await fetch(path)).blob()
      if (blob.size <= MAX_KB * 1024) return await blobToDataUri(blob)
    } catch (e) { /* blob 获取失败则走压缩流程 */ }
  }
  let img
  try {
    img = await loadImg(path)
  } catch (e) {
    return path // 加载失败兜底：原样交由上传链路处理
  }
  let last = ''
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    for (const q of [0.8, 0.6, 0.45]) {
      last = drawToDataUri(img, scale, q)
      if (last.length <= MAX_DATAURI_LEN) return last
    }
  }
  return last
}

/**
 * 压缩到 300KB 以内并返回 data URI
 * @param {string} path chooseImage 返回的临时路径 / blob URL / data URI
 */
export async function compressToBase64(path) {
  // #ifdef MP-WEIXIN
  const p = await compressMp(path)
  return fileUriToBase64(p)
  // #endif
  // #ifndef MP-WEIXIN
  return compressH5(path)
  // #endif
}
