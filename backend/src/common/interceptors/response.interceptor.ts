import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable, map } from 'rxjs'

/**
 * 统一响应包装：所有接口返回 { code, msg, data }
 * 契约见《开发配套-API接口字段契约.md》第 0 节
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // 已经是信封结构则直接透传（避免重复包装）
        if (data && typeof data === 'object' && 'code' in data) return data
        return { code: 0, msg: 'ok', data: data ?? null }
      }),
    )
  }
}
