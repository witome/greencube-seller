import { IsString, IsNotEmpty, MaxLength } from 'class-validator'

/// 图片上传（base64，前端拍照后统一转 base64 上传）
export class UploadImageDto {
  @IsNotEmpty({ message: '图片数据不能为空' })
  @IsString()
  base64: string
}
