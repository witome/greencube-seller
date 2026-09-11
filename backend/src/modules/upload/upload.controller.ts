import { Controller, Post, Body } from '@nestjs/common'
import { UploadService } from './upload.service'
import { UploadImageDto } from './dto/upload-image.dto'
import { Roles, Role } from '../../common/decorators/roles.decorator'

/// 通用图片上传
@Controller('upload')
export class UploadController {
  constructor(private readonly service: UploadService) {}

  @Post('image')
  @Roles(Role.PURCHASER, Role.SUPPLIER, Role.COURIER, Role.ADMIN, Role.BUSINESS_AGENT)
  async uploadImage(@Body() dto: UploadImageDto) {
    return this.service.uploadImage(dto.base64)
  }
}
