import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { BizException, ErrorCode, ErrorMessage } from '../constants/error-codes'

/**
 * 全局异常过滤：统一输出 { code, msg, data: null }
 * - BizException → 业务错误码
 * - HttpException → 复用 HTTP 状态码
 * - 其他 → 5001
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse()

    let code: number
    let msg: string
    let httpStatus = HttpStatus.OK

    if (exception instanceof BizException) {
      code = exception.code
      msg = exception.message
    } else if (exception instanceof HttpException) {
      const resp = exception.getResponse() as any
      const status = exception.getStatus()
      code = status === 401 ? ErrorCode.UNAUTHORIZED : status === 403 ? ErrorCode.FORBIDDEN : ErrorCode.PARAM_ERROR
      msg = typeof resp === 'string' ? resp : (resp?.message ?? exception.message)
      httpStatus = status
    } else {
      code = ErrorCode.INTERNAL_ERROR
      msg = ErrorMessage[ErrorCode.INTERNAL_ERROR]
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR
      console.error('[Unhandled]', exception)
    }

    res.status(httpStatus).json({ code, msg, data: null })
  }
}
