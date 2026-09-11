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
    // 简单大小限制（约 5MB）
    if (data.length > 7 * 1024 * 1024) {
      throw new BizException(ErrorCode.PARAM_ERROR, '图片过大（上限 5MB）')
    }

    fs.mkdirSync(this.uploadDir, { recursive: true })
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
    fs.writeFileSync(path.join(this.uploadDir, filename), Buffer.from(data, 'base64'))

    return { url: `/uploads/${filename}` }
  }
}
