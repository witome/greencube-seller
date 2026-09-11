import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'

import { ResponseInterceptor } from './common/interceptors/response.interceptor'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { RolesGuard } from './common/guards/roles.guard'
import { PrismaModule } from './prisma/prisma.module'

// ── 业务模块（15 个，对应《开发配套①》API 模块划分）──
import { AuthModule } from './modules/auth/auth.module'
import { BuyerModule } from './modules/buyer/buyer.module'
import { ProductModule } from './modules/product/product.module'
import { CartModule } from './modules/cart/cart.module'
import { OrderModule } from './modules/order/order.module'
import { SupplierGoodsModule } from './modules/supplier-goods/supplier-goods.module'
import { SupplierFulfillModule } from './modules/supplier-fulfill/supplier-fulfill.module'
import { SupplierFinanceModule } from './modules/supplier-finance/supplier-finance.module'
import { CourierModule } from './modules/courier/courier.module'
import { AdminGoodsModule } from './modules/admin-goods/admin-goods.module'
import { AdminOrderModule } from './modules/admin-order/admin-order.module'
import { AdminDispatchModule } from './modules/admin-dispatch/admin-dispatch.module'
import { AdminFinanceModule } from './modules/admin-finance/admin-finance.module'
import { AdminPaymentModule } from './modules/admin-payment/admin-payment.module'
import { AdminUserModule } from './modules/admin-user/admin-user.module'
import { AuditModule } from './modules/audit/audit.module'
import { AdminPricingModule } from './modules/admin-pricing/admin-pricing.module'
import { AdminReportsModule } from './modules/admin-reports/admin-reports.module'
import { RegisterModule } from './modules/register/register.module'
import { AiModule } from './modules/ai/ai.module'
import { UploadModule } from './modules/upload/upload.module'
import { PaymentModule } from './modules/payment/payment.module'

@Module({
  imports: [
    // 全局 Prisma（所有模块可直接注入 PrismaService）
    PrismaModule,

    // RolesGuard 依赖 JwtService，需全局注册
    JwtModule.register({
      secret: process.env.JWT_SECRET!,
      signOptions: { expiresIn: process.env.JWT_EXPIRES || '7d' },
    }),

    AuthModule,
    BuyerModule,
    ProductModule,
    CartModule,
    OrderModule,
    SupplierGoodsModule,
    SupplierFulfillModule,
    SupplierFinanceModule,
    CourierModule,
    AdminGoodsModule,
    AdminOrderModule,
    AdminDispatchModule,
    AdminFinanceModule,
    AdminPaymentModule,
    AdminUserModule,
    AuditModule,
    AdminPricingModule,
    AdminReportsModule,
    RegisterModule,
    AiModule,
    UploadModule,
    PaymentModule,
  ],
  providers: [
    // 全局统一响应包装
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // 全局异常过滤（含 BizException → { code, msg }）
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // 全局角色守卫（JWT 解析出 currentRole 后比对 @Roles 装饰器）
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
