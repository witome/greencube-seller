/**
 * 拍照留证上传工具（2026-09-19 决策⑦：售后申请 / 配送员上报接真实拍照）
 *
 * ⚠️ 压缩**一律复用 utils/image-compress**（本地压到 300KB 内再传），本文件不重复实现压缩。
 * 本文件只做两件事：
 *   1. pickPhotos()  —— 包一层 uni.chooseImage，让用户拍照/选图（可多张）
 *   2. uploadPhoto() —— 压缩 → POST /upload/image → 返回可访问 URL
 *
 * 口径：上传成功后**只保留 URL（/uploads/xxx）**；base64 仅存在于内存，绝不入库、不进表单。
 * 后端 JSON body 上限 5MB，压到 300KB 后每张 base64 约 400KB，远低于上限；
 * 万一压缩失效（低版本基础库）仍超限，后端会返回「图片过大，请压缩后上传」业务错误。
 */
import { post } from '@/api/request'
import { compressToBase64 } from '@/utils/image-compress'

/** 单次最多张数（与页面缩略图网格容量一致） */
export const MAX_PHOTOS = 9

/** 剩余可选张数（已上传若干张时只让再选差额，避免超出上限） */
export const remainCount = (current, max = MAX_PHOTOS) => Math.max(0, max - (current || 0).length)

/**
 * 拍照 / 选图，返回本地临时路径数组（尚未上传）
 * 用户取消时 reject({ cancelled: true })，调用方应静默忽略
 */
export function pickPhotos({ count = MAX_PHOTOS } = {}) {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count,
      sizeType: ['compressed'],
      // 相机 + 相册：现场能拍，也能补选已拍好的照片（H5 端为文件选择）
      sourceType: ['camera', 'album'],
      success: (res) => resolve(res.tempFilePaths || []),
      fail: (err) => reject({ cancelled: true, err }),
    })
  })
}

/**
 * 单张：本地压缩（≤300KB）→ 上传 → 返回 URL
 * 失败时 reject 的对象带 msg（业务错误由 request 层已 toast，同文案 3 秒去重）
 */
export async function uploadPhoto(path) {
  const base64 = await compressToBase64(path)
  const res = await post('/upload/image', { base64 })
  const url = res && res.url
  if (!url) throw { msg: '上传返回异常，请重试' }
  return url
}
