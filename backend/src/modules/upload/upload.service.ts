import { Injectable } from '@nestjs/common'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import * as fs from 'fs'
import * as path from 'path'

/// 图片上传：base64 → 本地 uploads/ 目录，返回可访问 URL 路径
@Injectable()
export class UploadService {
  // backend/uploads 目录（dist 运行时为 backend/dist/../uploads）
  private uploadDir = path.join(__dirname, '..', '..', '..', 'uploads')

  async uploadImage(base64: string): Promise<{ url: string }> {
    if (!base64) throw new BizException(ErrorCode.PARAM_ERROR, '图片数据为空')

    // 解析 data URI（data:image/png;base64,xxx）或纯 base64
    let ext = 'jpg'
    let data = base64
    const match = base64.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i)
    if (match) {
      ext = match[1].toLowerCase().replace('jpeg', 'jpg')
      data = match[2]
    }
    // 大小限制：单张图片 ≤5MB（与 main.ts 的 JSON body 5MB 上限对齐）。
    // 5MB 原始字节对应的 base64 字符长约 6.99MB；实际经 HTTP 上传时 body-parser 的
    // 5MB 上限会更早拦下（异常由全局过滤器转成「图片过大」业务错误），此处为兜底防御。
    const maxBase64Len = Math.ceil((5 * 1024 * 1024) / 3) * 4
    if (data.length > maxBase64Len) {
      throw new BizException(ErrorCode.PARAM_ERROR, '图片过大，请压缩后上传（单张不超过 5MB）')
    }

    fs.mkdirSync(this.uploadDir, { recursive: true })
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    fs.writeFileSync(path.join(this.uploadDir, filename), Buffer.from(data, 'base64'))

    return { url: `/uploads/${filename}` }
  }
}
