import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

/// 拍照快速上架 · 视觉识别（卡BP 2026-10-02）
/// image = 封面图经 POST /upload/image 拿到的相对地址（/uploads/xxx），
/// service 层再做白名单校验（只收本站 /uploads/ 相对路径，防外链/目录穿越）。
export class RecognizeGoodsDto {
  @IsNotEmpty({ message: '图片地址不能为空' })
  @IsString()
  @MaxLength(255, { message: '图片地址过长' })
  image: string
}
