import { SetMetadata } from '@nestjs/common'
import { Role } from '../constants/error-codes'

/**
 * 接口级角色守卫标记
 * 用法：@Roles(Role.PURCHASER) 或 @Roles(Role.ADMIN, Role.BUSINESS_AGENT)
 *
 * ⚠️ 权限铁律（见主计划 2.2）：
 * 1. 配送员不碰钱 —— courier 模块的接口永不返回金额字段
 * 2. 供应商不见销售价 —— product 模块对 supplier 角色不返回 salePrice
 * 3. 业务员(business_agent) 仅限采购方审核，看不到订单/金额/结算
 */
export const ROLES_KEY = 'roles'
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles)

/** 便捷导出 */
export { Role }
