/**
 * 浏览器端图片压缩：上传前压到 300KB 以内（返回 data URI）
 *
 * 背景（2026-09-19 拍板卡）：运营后台收款码等图片经 JSON base64 上传
 * （POST /upload/image），原图过大既浪费传输也容易顶到后端 5MB 上限。
 * 原图本就 ≤300KB 时原样返回（小二维码零画质损失）。
 *
 * canvas 重绘为 JPEG，白底铺底（防透明 PNG 转 JPEG 变黑底），
 * 质量×分辨率逐步下降直到达标。
 */

const MAX_KB = 300
const MAX_DATAURI_LEN = Math.ceil((MAX_KB * 1024 * 4) / 3) + 100

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
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * 压缩到 300KB 以内并返回 data URI
 * @param {File} file <input type="file"> 选取的文件
 * @returns {Promise<string>} data URI
 */
export async function compressFileToDataUri(file) {
  const dataUri = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  // 原图本就达标 → 原样返回
  if (file.size <= MAX_KB * 1024 || dataUri.length <= MAX_DATAURI_LEN) return dataUri

  let img
  try {
    img = await loadImg(dataUri)
  } catch (e) {
    return dataUri // 非标准图片文件兜底：原样返回，由后端校验兜底
  }
  let last = dataUri
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    for (const q of [0.8, 0.6, 0.45]) {
      last = drawToDataUri(img, scale, q)
      if (last.length <= MAX_DATAURI_LEN) return last
    }
  }
  return last
}
