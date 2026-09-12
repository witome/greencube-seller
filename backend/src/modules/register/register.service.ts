import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { RegisterSupplierDto, RegisterCourierDto } from './dto/register.dto'

/// 审核状态：0 待审核 / 1 通过（供应商：合作中；配送员：正常）/ 2 停用
export const ReviewStatus = { PENDING: 0, APPROVED: 1, DISABLED: 2, BLACKLIST: 9 } as const

@Injectable()
export class RegisterService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 供应商注册（外部申请 → 待审核，运营后台审核）
  // ────────────────────────────────────────
  async registerSupplier(userId: bigint, dto: RegisterSupplierDto) {
    const exist = await this.prisma.supplier.findUnique({ where: { userId } })
    if (exist) throw new BizException(ErrorCode.PARAM_ERROR, '该账号已提交过供应商注册')

    // 手机号唯一前置校验（2026-09-12 #24：必须在建任何记录之前拦下，撞号不留半成品；修法同 #22 模式）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    // 事务：supplier 主表 + user 手机号同步 + 经营品类要么都成、要么整体回滚（杜绝主表已建、user 未更新的半成品）
    const supplier = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: {
          userId,
          stallName: dto.stallName,
          address: dto.address ?? null,
          status: ReviewStatus.PENDING,
          qualification: { contact: dto.contact, phone: dto.phone, businessLicenseNo: dto.businessLicenseNo ?? null },
        },
      })

      // 同步手机号到 user（运营后台供应商列表展示 user.phone，避免号码不一致）
      await tx.user.update({
        where: { id: userId },
        data: { phone: dto.phone },
      })

      // 经营品类（授权分类）
      if (dto.categoryIds?.length) {
        await tx.supplierCategory.createMany({
          data: dto.categoryIds.map((cid) => ({ supplierId: created.id, categoryId: BigInt(cid) })),
        })
      }

      return created
    })

    await this.audit.log({
      operatorId: userId,
      action: 'REGISTER_SUPPLIER',
      entity: 'supplier',
      entityId: supplier.id,
      after: { stallName: dto.stallName, status: ReviewStatus.PENDING },
    })

    return { supplierId: Number(supplier.id), status: supplier.status, statusText: '待审核' }
  }

  // ────────────────────────────────────────
  // 配送员注册（外部申请 → 待审核，运营后台审核）
  // ────────────────────────────────────────
  async registerCourier(userId: bigint, dto: RegisterCourierDto) {
    const exist = await this.prisma.courier.findUnique({ where: { userId } })
    if (exist) throw new BizException(ErrorCode.PARAM_ERROR, '该账号已提交过配送员注册')

    // 身份证唯一：防重复申请 / 黑名单
    const dup = await this.prisma.courier.findUnique({ where: { idCardNo: dto.idCardNo } })
    if (dup) throw new BizException(ErrorCode.PARAM_ERROR, '该身份证号已注册')

    // 手机号唯一前置校验（2026-09-12 #24：必须在建任何记录之前拦下，撞号不留半成品；修法同 #22 模式）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    // 事务：courier 主表 + user 手机号/姓名同步要么都成、要么整体回滚（杜绝主表已建、user 未更新的半成品）
    const courier = await this.prisma.$transaction(async (tx) => {
      const created = await tx.courier.create({
        data: {
          userId,
          source: 2, // 2 外部申请（审核制）
          idCardNo: dto.idCardNo,
          healthCertExpiry: dto.healthCertExpiry ? new Date(dto.healthCertExpiry) : null,
          vehicleType: dto.vehicleType ?? 1,
          ownVehicle: dto.ownVehicle ?? 0,
          hasDriverLicense: dto.hasDriverLicense ?? 0,
          licenseType: dto.licenseType ?? null,
          status: ReviewStatus.PENDING, // 待审核，审核通过后方可接单
        },
      })

      // 同步手机号、姓名到 user（运营后台配送员列表展示 user.phone/user.name，避免信息不一致）
      await tx.user.update({
        where: { id: userId },
        data: { phone: dto.phone, name: dto.name },
      })

      return created
    })

    await this.audit.log({
      operatorId: userId,
      action: 'REGISTER_COURIER',
      entity: 'courier',
      entityId: courier.id,
      after: { name: dto.name, source: 2, status: ReviewStatus.PENDING },
    })

    return { courierId: Number(courier.id), status: courier.status, statusText: '待审核' }
  }
}
