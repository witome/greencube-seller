import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/**
 * 从 req.user 提取字段（由 RolesGuard 解析 JWT 后填充）
 * 用法：
 *   @CurrentUser('userId') userId: bigint
 *   @CurrentUser() user: any          // 整个 payload
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest()
    const user = req.user
    return field ? user?.[field] : user
  },
)
