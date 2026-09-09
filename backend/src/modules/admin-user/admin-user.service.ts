import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode, AccountStatus } from '../../common/constants/error-codes'
import { VerifyDto } from './dto/verify.dto'
import { AppealReviewDto } from './dto/appeal-review.dto'
import { AssignDto } from './dto/assign.dto'
import { CategoryDto } from './dto/category.dto'
import { SupplierCategoriesDto } from './dto/supplier-categories.dto'
import { UpdateBuyerDto, UpdateSupplierDto, UpdateCourierDto } from './dto/update-profile.dto'
import { AuditService } from '../audit/audit.service'

@Injectable()
export class AdminUserService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 待审核采购方队列
  // 契约《开发配套-API接口字段契约》第 9 节
  // ────────────────────────────────────────
  async pendingBuyers(query: { status?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))
    const status = query.status ? parseInt(query.status) : undefined

    // 采购方管理：默认返回全部（待审核/已驳回/已开通），传 status 则按状态筛选
    const where: any = status ? { accountStatus: status } : {}

    const [total, rows] = await Promise.all([
      this.prisma.purchaser.count({ where }),
      this.prisma.purchaser.findMany({
        where,
        orderBy: { registeredAt: 'asc' }, // 越早越靠前（超时预警优先）
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          verificationLogs: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
      }),
    ])

    const now = Date.now()
    const list = rows.map((p) => {
      const overdue = p.accountStatus === AccountStatus.PENDING && now - p.registeredAt.getTime() > 24 * 3600 * 1000
      const latestLog = p.verificationLogs[0]
      return {
        purchaserId: Number(p.id),
        shopName: p.shopName,
        contact: p.contact,
        phone: p.phone,
        address: p.address,
        registeredAt: p.registeredAt.toISOString(),
        overdue,
        agentName: p.verifiedBy ? `业务员#${p.verifiedBy}` : null, // 简化：暂存 ID
        methods: latestLog ? latestLog.method : [],
        status: p.accountStatus,
        statusText: this.statusText(p.accountStatus),
      }
    })

    return { total, list }
  }

  // ────────────────────────────────────────
  // 核实详情（含系统风险预检）
  // ────────────────────────────────────────
  async verifyDetail(id: number) {
    const p = await this.prisma.purchaser.findUnique({
      where: { id: BigInt(id) },
      include: {
        user: { select: { wxOpenid: true } },
        verificationLogs: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    // 系统风险预检
    const riskHints: string[] = []
    // ① 手机号近 30 天注册次数（防一址/一号多注册）
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const phoneCount = await this.prisma.purchaser.count({
      where: { phone: p.phone, registeredAt: { gte: thirtyDaysAgo } },
    })
    if (phoneCount > 1) riskHints.push(`该手机号近 30 天内已注册 ${phoneCount} 个账号`)
    // ② 收货地址重复
    const addrCount = await this.prisma.purchaser.count({
      where: { address: p.address, NOT: { id: p.id } },
    })
    if (addrCount > 0) riskHints.push('收货地址与其他账号重复，请核实是否同址多号')

    return {
      purchaserId: Number(p.id),
      shopName: p.shopName,
      contact: p.contact,
      phone: p.phone,
      address: p.address,
      businessLicenseNo: p.businessLicenseNo,
      licenseImg: p.businessLicenseImg,
      permitImg: p.foodPermitImg,
      deliveryWindows: p.deliveryWindows,
      registeredAt: p.registeredAt.toISOString(),
      accountStatus: p.accountStatus,
      riskHints,
      history: p.verificationLogs.map((l) => ({
        id: Number(l.id),
        operatorId: Number(l.operatorId),
        methods: l.method,
        result: l.result,
        reasonCode: l.reasonCode,
        reasonText: l.reasonText,
        remark: l.reasonText,
        durationMin: l.durationMin,
        createdAt: l.createdAt.toISOString(),
      })),
    }
  }

  // ────────────────────────────────────────
  // 提交线下核实结论（通过 → active / 驳回 → rejected 可申诉）
  // ────────────────────────────────────────
  async submitVerification(id: number, operatorId: bigint, dto: VerifyDto) {
    const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(id) } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    // 驳回必须填原因
    if (dto.result === 2 && !dto.reasonCode) {
      throw new BizException(ErrorCode.PARAM_ERROR, '驳回时必须填写驳回原因')
    }

    // 写核实记录（决策：全部留存）
    await this.prisma.verificationLog.create({
      data: {
        purchaserId: p.id,
        operatorId,
        method: dto.methods,
        result: dto.result,
        reasonCode: dto.reasonCode,
        reasonText: dto.reasonText,
        attachments: dto.attachments,
        durationMin: dto.durationMin,
        signature: dto.signature,
      },
    })

    const nextStatus = dto.result === 1 ? AccountStatus.ACTIVE : AccountStatus.REJECTED
    await this.prisma.purchaser.update({
      where: { id: p.id },
      data: {
        accountStatus: nextStatus,
        verifiedBy: operatorId,
        verifiedAt: new Date(),
        rejectReasonCode: dto.result === 2 ? dto.reasonCode : null,
        rejectReasonText: dto.result === 2 ? dto.reasonText : null,
      },
    })

    return { purchaserId: Number(p.id), accountStatus: nextStatus, verificationId: 0 }
  }

  // ────────────────────────────────────────
  // 申诉复核（通过 → active / 驳回 → 终态冻结 60 天）
  // ────────────────────────────────────────
  async reviewAppeal(id: number, operatorId: bigint, dto: AppealReviewDto) {
    const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(id) } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    const nextStatus = dto.approved ? AccountStatus.ACTIVE : AccountStatus.REJECTED_FINAL
    await this.prisma.purchaser.update({
      where: { id: p.id },
      data: { accountStatus: nextStatus, verifiedBy: operatorId, verifiedAt: new Date() },
    })

    return { purchaserId: Number(p.id), accountStatus: nextStatus }
  }

  // ────────────────────────────────────────
  // 分配业务员（MVP：暂存为 verifiedBy 字段，作为负责人）
  // ────────────────────────────────────────
  async assignAgent(id: number, dto: AssignDto) {
    const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(id) } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    await this.prisma.purchaser.update({
      where: { id: p.id },
      data: { verifiedBy: BigInt(dto.agentId) },
    })
    return { purchaserId: Number(p.id), agentId: dto.agentId }
  }

  // ────────────────────────────────────────
  // 供应商列表（管理页）
  // ────────────────────────────────────────
  async suppliers() {
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { id: 'asc' },
      include: { user: true },
    })
    return suppliers.map((s) => {
      const qual = (s.qualification as any) || {}
      return {
        supplierId: Number(s.id),
        stallName: s.stallName,
        address: s.address || null,
        contact: qual.contact || null,
        status: s.status,
        phone: s.user?.phone || qual.phone || null,
      }
    })
  }

  // ────────────────────────────────────────
  // 配送员列表（管理页，含申请制）
  // ────────────────────────────────────────
  async couriers() {
    const couriers = await this.prisma.courier.findMany({
      orderBy: { id: 'asc' },
      include: { user: true },
    })
    return couriers.map((c) => ({
      courierId: Number(c.id),
      source: c.source,
      name: c.user?.name || null,
      vehicleType: c.vehicleType,
      ownVehicle: c.ownVehicle,
      hasDriverLicense: c.hasDriverLicense,
      licenseType: c.licenseType || null,
      idCardNo: c.idCardNo || null,
      status: c.status,
      phone: c.user?.phone || null,
    }))
  }

  // ────────────────────────────────────────
  // 分类管理（运营增删改一级分类）
  // ────────────────────────────────────────
  async listCategories() {
    const all = await this.prisma.category.findMany({ orderBy: { sort: 'asc' } })
    const roots = all.filter((c) => !c.parentId)
    return roots.map((p) => ({
      id: Number(p.id),
      name: p.name,
      sort: p.sort,
      children: all
        .filter((c) => c.parentId === p.id)
        .map((c) => ({ id: Number(c.id), name: c.name, sort: c.sort })),
    }))
  }

  async createCategory(dto: CategoryDto) {
    const cat = await this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId ? BigInt(dto.parentId) : null, sort: dto.sort ?? 0 },
    })
    return { categoryId: Number(cat.id), name: cat.name }
  }

  async updateCategory(id: number, dto: CategoryDto) {
    const cat = await this.prisma.category.update({
      where: { id: BigInt(id) },
      data: { name: dto.name, sort: dto.sort ?? 0 },
    })
    return { categoryId: Number(cat.id), name: cat.name }
  }

  async deleteCategory(id: number) {
    const productCount = await this.prisma.product.count({ where: { categoryId: BigInt(id) } })
    if (productCount > 0) throw new BizException(ErrorCode.PARAM_ERROR, '该分类下有商品，无法删除')
    await this.prisma.supplierCategory.deleteMany({ where: { categoryId: BigInt(id) } })
    await this.prisma.category.delete({ where: { id: BigInt(id) } })
    return { deleted: true }
  }

  // ────────────────────────────────────────
  // 供应商分类授权
  // ────────────────────────────────────────
  async getSupplierCategories(id: number) {
    const rows = await this.prisma.supplierCategory.findMany({
      where: { supplierId: BigInt(id) },
      include: { category: true },
    })
    return rows.map((r) => ({ categoryId: Number(r.categoryId), name: r.category.name }))
  }

  async setSupplierCategories(id: number, dto: SupplierCategoriesDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: BigInt(id) } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '供应商不存在')

    await this.prisma.supplierCategory.deleteMany({ where: { supplierId: BigInt(id) } })
    if (dto.categoryIds.length) {
      await this.prisma.supplierCategory.createMany({
        data: dto.categoryIds.map((cid) => ({ supplierId: BigInt(id), categoryId: BigInt(cid) })),
      })
    }
    return { supplierId: Number(id), categoryIds: dto.categoryIds }
  }

  // ────────────────────────────────────────
  // 供应商审核（0 待审核 / 1 合作中 / 2 停合作）
  // ────────────────────────────────────────
  async updateSupplierStatus(id: number, status: number, operatorId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: BigInt(id) } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '供应商不存在')
    if (![0, 1, 2].includes(status)) throw new BizException(ErrorCode.PARAM_ERROR, '状态值不合法')

    const before = { status: supplier.status }
    await this.prisma.supplier.update({ where: { id: BigInt(id) }, data: { status } })
    await this.audit.log({
      operatorId,
      action: 'REVIEW_SUPPLIER',
      entity: 'supplier',
      entityId: id,
      before,
      after: { status },
    })
    return { supplierId: id, status }
  }

  // ────────────────────────────────────────
  // 配送员审核（0 待审核 / 1 正常 / 2 停用 / 9 黑名单）
  // ────────────────────────────────────────
  async updateCourierStatus(id: number, status: number, operatorId: bigint) {
    const courier = await this.prisma.courier.findUnique({ where: { id: BigInt(id) } })
    if (!courier) throw new BizException(ErrorCode.NOT_FOUND, '配送员不存在')
    if (![0, 1, 2, 9].includes(status)) throw new BizException(ErrorCode.PARAM_ERROR, '状态值不合法')

    const before = { status: courier.status }
    await this.prisma.courier.update({ where: { id: BigInt(id) }, data: { status } })
    await this.audit.log({
      operatorId,
      action: 'REVIEW_COURIER',
      entity: 'courier',
      entityId: id,
      before,
      after: { status },
    })
    return { courierId: id, status }
  }

  // ────────────────────────────────────────
  // 编辑采购方信息（运营后台）
  // ────────────────────────────────────────
  async updateBuyer(id: number, operatorId: bigint, dto: UpdateBuyerDto) {
    const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(id) } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    const data: any = {}
    if (dto.shopName !== undefined) data.shopName = dto.shopName
    if (dto.contact !== undefined) data.contact = dto.contact
    if (dto.phone !== undefined) data.phone = dto.phone
    if (dto.address !== undefined) data.address = dto.address
    if (dto.businessLicenseNo !== undefined) data.businessLicenseNo = dto.businessLicenseNo || null
    if (dto.deliveryWindows !== undefined) data.deliveryWindows = dto.deliveryWindows

    await this.prisma.purchaser.update({ where: { id: BigInt(id) }, data })
    if (dto.phone !== undefined) {
      await this.prisma.user.update({ where: { id: p.userId }, data: { phone: dto.phone } })
    }
    await this.audit.log({
      operatorId,
      action: 'UPDATE_BUYER',
      entity: 'purchaser',
      entityId: id,
      after: data,
    })
    return { purchaserId: id, updated: true }
  }

  // ────────────────────────────────────────
  // 编辑供应商信息（运营后台）
  // ────────────────────────────────────────
  async updateSupplier(id: number, operatorId: bigint, dto: UpdateSupplierDto) {
    const s = await this.prisma.supplier.findUnique({ where: { id: BigInt(id) } })
    if (!s) throw new BizException(ErrorCode.NOT_FOUND, '供应商不存在')

    const data: any = {}
    if (dto.stallName !== undefined) data.stallName = dto.stallName
    if (dto.address !== undefined) data.address = dto.address || null

    const qual = (s.qualification as any) || {}
    if (dto.contact !== undefined) qual.contact = dto.contact
    if (dto.phone !== undefined) qual.phone = dto.phone
    if (dto.contact !== undefined || dto.phone !== undefined) data.qualification = qual

    await this.prisma.supplier.update({ where: { id: BigInt(id) }, data })
    if (dto.phone !== undefined) {
      await this.prisma.user.update({ where: { id: s.userId }, data: { phone: dto.phone } })
    }
    await this.audit.log({
      operatorId,
      action: 'UPDATE_SUPPLIER',
      entity: 'supplier',
      entityId: id,
      after: data,
    })
    return { supplierId: id, updated: true }
  }

  // ────────────────────────────────────────
  // 编辑配送员信息（运营后台）
  // ────────────────────────────────────────
  async updateCourier(id: number, operatorId: bigint, dto: UpdateCourierDto) {
    const c = await this.prisma.courier.findUnique({ where: { id: BigInt(id) } })
    if (!c) throw new BizException(ErrorCode.NOT_FOUND, '配送员不存在')

    const data: any = {}
    if (dto.idCardNo !== undefined) data.idCardNo = dto.idCardNo || null
    if (dto.vehicleType !== undefined) data.vehicleType = dto.vehicleType
    if (dto.ownVehicle !== undefined) data.ownVehicle = dto.ownVehicle
    if (dto.hasDriverLicense !== undefined) data.hasDriverLicense = dto.hasDriverLicense
    if (dto.licenseType !== undefined) data.licenseType = dto.licenseType || null
    if (dto.healthCertExpiry !== undefined) data.healthCertExpiry = dto.healthCertExpiry ? new Date(dto.healthCertExpiry) : null

    await this.prisma.courier.update({ where: { id: BigInt(id) }, data })
    if (dto.name !== undefined || dto.phone !== undefined) {
      const ud: any = {}
      if (dto.name !== undefined) ud.name = dto.name
      if (dto.phone !== undefined) ud.phone = dto.phone
      await this.prisma.user.update({ where: { id: c.userId }, data: ud })
    }
    await this.audit.log({
      operatorId,
      action: 'UPDATE_COURIER',
      entity: 'courier',
      entityId: id,
      after: { ...data, name: dto.name, phone: dto.phone },
    })
    return { courierId: id, updated: true }
  }

  private statusText(status: number): string {
    const map: Record<number, string> = {
      [AccountStatus.PENDING]: '待审核',
      [AccountStatus.ACTIVE]: '正常',
      [AccountStatus.REJECTED]: '已驳回（可申诉）',
      [AccountStatus.REJECTED_FINAL]: '终态驳回',
      [AccountStatus.SUSPENDED]: '运营停用',
    }
    return map[status] ?? '未知'
  }
}
