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

    const nextStatus = dto.result === 1 ? AccountStatus.ACTIVE : AccountStatus.REJECTED

    // 事务（2026-09-19 卡B 涉权限收口）：核实记录 + 采购方账号状态 要么都成、要么都不成，
    // 杜绝「核实记录已写、账号状态没改」的准入脏数据。写核实记录沿用原决策：全部留存。
    await this.prisma.$transaction([
      this.prisma.verificationLog.create({
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
      }),
      this.prisma.purchaser.update({
        where: { id: p.id },
        data: {
          accountStatus: nextStatus,
          verifiedBy: operatorId,
          verifiedAt: new Date(),
          rejectReasonCode: dto.result === 2 ? dto.reasonCode : null,
          rejectReasonText: dto.result === 2 ? dto.reasonText : null,
        },
      }),
    ])

    // 铁律 3：审核属关键操作，全量写审计（2026-09-10 补，修复单缺陷 4）
    await this.audit.log({
      operatorId,
      action: 'REVIEW_BUYER',
      entity: 'buyer',
      entityId: id,
      before: { accountStatus: p.accountStatus, shopName: p.shopName },
      after: { accountStatus: nextStatus, result: dto.result, reasonCode: dto.reasonCode ?? null },
    })

    return { purchaserId: Number(p.id), accountStatus: nextStatus, verificationId: 0 }
  }

  // ────────────────────────────────────────
  // 申诉复核（通过 → active / 驳回 → 终态冻结 60 天）
  // 决策 6（2026-09-19）：同时给 appeal_record 打处理留痕（status=1 + handled_by/handled_at）
  // ────────────────────────────────────────
  async reviewAppeal(id: number, operatorId: bigint, dto: AppealReviewDto) {
    const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(id) } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    const nextStatus = dto.approved ? AccountStatus.ACTIVE : AccountStatus.REJECTED_FINAL
    const now = new Date()

    // 事务：采购方状态 + 申诉记录处理留痕 要么都成、要么都不成
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaser.update({
        where: { id: p.id },
        data: { accountStatus: nextStatus, verifiedBy: operatorId, verifiedAt: now },
      })

      // 该采购方最近一条「待处理」申诉置为已处理（本次复核即对它的处理）
      const pendingAppeal = await tx.appealRecord.findFirst({
        where: { purchaserId: p.id, status: 0 },
        orderBy: { createdAt: 'desc' },
      })
      if (pendingAppeal) {
        await tx.appealRecord.update({
          where: { id: pendingAppeal.id },
          data: { status: 1, handledBy: operatorId, handledAt: now },
        })
      }
    })

    // 铁律 3：申诉复核属关键操作，全量写审计（2026-09-10 补，修复单缺陷 4）
    // ⚠️ 审计 payload 保持原样不动：申诉处理留痕落在 appeal_record 的 handled_by/handled_at 上
    await this.audit.log({
      operatorId,
      action: 'REVIEW_BUYER_APPEAL',
      entity: 'buyer',
      entityId: id,
      before: { accountStatus: p.accountStatus, shopName: p.shopName },
      after: { accountStatus: nextStatus, approved: dto.approved },
    })

    return { purchaserId: Number(p.id), accountStatus: nextStatus }
  }

  // ────────────────────────────────────────
  // 申诉记录列表（运营/业务员；决策 6 · 2026-09-19 拍板）
  // 只读接口，不写审计（与 pendingBuyers / verifyDetail 等同口径）。
  // 按状态 + 时间倒序，带申诉正文与附件，供运营后台查看与处理
  // 筛选（均可选）：status；startDate/endDate（2026-09-21 新增，按 created_at 的 UTC 日期、左闭右闭）
  //           —— 都不传 = 不筛（全部），查询条件与改动前逐字一致
  // 权限：@Roles(ADMIN, BUSINESS_AGENT) —— 业务员是运营子账号，申诉属采购方审核范畴
  // ────────────────────────────────────────
  async appeals(query: { status?: string; page?: string; pageSize?: string; startDate?: string; endDate?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(query.pageSize || '20')))

    const where: any = {}
    if (query.status !== undefined && query.status !== '') where.status = parseInt(query.status)

    // 提交日期区间（2026-09-21 大辉改口径：由「前端当前页过滤」改为**服务端**筛，
    // 这样筛选结果才覆盖全部数据、不受分页限制）。
    // - 只接受 `YYYY-MM-DD`；非法格式一律**忽略**（= 不筛），避免脏参数造成 500
    // - 口径与改前的客户端过滤**逐字一致**：按 created_at 的 UTC 日期比较、左闭右闭。
    //   实现为 createdAt >= startDate T00:00:00Z 且 createdAt < (endDate+1天) T00:00:00Z
    // - startDate / endDate 都不传时，where 里**不会出现 createdAt 键**，
    //   查询条件与改前完全相同（行为 = 全部）
    const dayRe = /^\d{4}-\d{2}-\d{2}$/
    const startDate = typeof query.startDate === 'string' && dayRe.test(query.startDate) ? query.startDate : ''
    const endDate = typeof query.endDate === 'string' && dayRe.test(query.endDate) ? query.endDate : ''
    if (startDate || endDate) {
      const range: any = {}
      if (startDate) range.gte = new Date(`${startDate}T00:00:00.000Z`)
      if (endDate) range.lt = new Date(new Date(`${endDate}T00:00:00.000Z`).getTime() + 86400000)
      where.createdAt = range
    }

    const [total, rows] = await Promise.all([
      this.prisma.appealRecord.count({ where }),
      this.prisma.appealRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { purchaser: true },
      }),
    ])

    return {
      total,
      list: rows.map((r) => ({
        appealId: Number(r.id),
        purchaserId: Number(r.purchaserId),
        userId: Number(r.userId),
        shopName: r.purchaser?.shopName ?? null,
        contact: r.purchaser?.contact ?? null,
        phone: r.purchaser?.phone ?? null,
        accountStatus: r.purchaser?.accountStatus ?? null,
        // 申诉正文 + 附件（决策 6 的核心：运营必须看得到）
        text: r.text,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        // 提交时刻的驳回原因快照
        reasonCode: r.reasonCode != null ? Number(r.reasonCode) : null,
        rejectReason: r.rejectReason,
        status: r.status,
        statusText: r.status === 1 ? '已处理' : '待处理',
        createdAt: r.createdAt.toISOString(),
        handledBy: r.handledBy != null ? Number(r.handledBy) : null,
        handledAt: r.handledAt ? r.handledAt.toISOString() : null,
      })),
    }
  }

  // ────────────────────────────────────────
  // 分配业务员（MVP：暂存为 verifiedBy 字段，作为负责人）
  // ────────────────────────────────────────
  async assignAgent(id: number, dto: AssignDto, operatorId: bigint) {
    const p = await this.prisma.purchaser.findUnique({ where: { id: BigInt(id) } })
    if (!p) throw new BizException(ErrorCode.NOT_FOUND, '采购方不存在')

    const beforeAgentId = p.verifiedBy ? Number(p.verifiedBy) : null
    await this.prisma.purchaser.update({
      where: { id: p.id },
      data: { verifiedBy: BigInt(dto.agentId) },
    })

    // 铁律 3：分配业务员改写负责人归属，属权限类关键操作，全量写审计
    // （2026-09-11 补，闭合审计复核缺口 G3）
    await this.audit.log({
      operatorId,
      action: 'ASSIGN_BUYER_AGENT',
      entity: 'buyer',
      entityId: id,
      before: { agentId: beforeAgentId },
      after: { agentId: dto.agentId },
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

  async createCategory(dto: CategoryDto, operatorId: bigint) {
    const cat = await this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId ? BigInt(dto.parentId) : null, sort: dto.sort ?? 0 },
    })
    // 铁律 3：分类是商品/供货关系的挂载点，改动写审计（2026-09-11 补，闭合审计复核缺口 G4~G6）
    await this.audit.log({
      operatorId,
      action: 'CATEGORY_CREATE',
      entity: 'category',
      entityId: Number(cat.id),
      after: { name: cat.name, parentId: cat.parentId ? Number(cat.parentId) : null, sort: cat.sort },
    })
    return { categoryId: Number(cat.id), name: cat.name }
  }

  async updateCategory(id: number, dto: CategoryDto, operatorId: bigint) {
    const before = await this.prisma.category.findUnique({ where: { id: BigInt(id) } })
    const cat = await this.prisma.category.update({
      where: { id: BigInt(id) },
      data: { name: dto.name, sort: dto.sort ?? 0 },
    })
    // 铁律 3：分类是商品/供货关系的挂载点，改动写审计（2026-09-11 补，闭合审计复核缺口 G4~G6）
    await this.audit.log({
      operatorId,
      action: 'CATEGORY_UPDATE',
      entity: 'category',
      entityId: id,
      before: before ? { name: before.name, sort: before.sort } : null,
      after: { name: cat.name, sort: cat.sort },
    })
    return { categoryId: Number(cat.id), name: cat.name }
  }

  async deleteCategory(id: number, operatorId: bigint) {
    const cat = await this.prisma.category.findUnique({ where: { id: BigInt(id) } })
    const productCount = await this.prisma.product.count({ where: { categoryId: BigInt(id) } })
    if (productCount > 0) throw new BizException(ErrorCode.PARAM_ERROR, '该分类下有商品，无法删除')
    // 事务（2026-09-19 卡B 涉权限收口）：解绑授权 + 删分类 要么都成、要么都不成，
    // 杜绝「授权已解绑、分类还在」的半删状态
    await this.prisma.$transaction([
      this.prisma.supplierCategory.deleteMany({ where: { categoryId: BigInt(id) } }),
      this.prisma.category.delete({ where: { id: BigInt(id) } }),
    ])
    // 铁律 3：删除分类属结构性变更，写审计（2026-09-11 补，闭合审计复核缺口 G4~G6）
    await this.audit.log({
      operatorId,
      action: 'CATEGORY_DELETE',
      entity: 'category',
      entityId: id,
      before: cat ? { name: cat.name, parentId: cat.parentId ? Number(cat.parentId) : null, sort: cat.sort } : null,
      after: { deleted: true },
    })
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

  async setSupplierCategories(id: number, dto: SupplierCategoriesDto, operatorId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: BigInt(id) } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '供应商不存在')

    const beforeRows = await this.prisma.supplierCategory.findMany({
      where: { supplierId: BigInt(id) },
      select: { categoryId: true },
    })

    // 前置校验（2026-09-19 卡B）：分类 id 唯一 + 存在性校验。
    // supplier_category 有 @@unique([supplierId, categoryId])，重复 id 会在 createMany 撞 P2002 → 裸 5001；
    // 不存在的 id 会撞 FK P2003 → 裸 5001。两者都必须先查再写，落到业务码，避免事务内抛裸错整体回滚。
    if (new Set(dto.categoryIds).size !== dto.categoryIds.length) {
      throw new BizException(ErrorCode.PARAM_ERROR, '分类 id 存在重复')
    }
    if (dto.categoryIds.length) {
      const found = await this.prisma.category.count({
        where: { id: { in: dto.categoryIds.map((cid) => BigInt(cid)) } },
      })
      if (found !== dto.categoryIds.length) {
        throw new BizException(ErrorCode.PARAM_ERROR, '存在无效的分类 id')
      }
    }

    // 事务（2026-09-19 卡B 涉权限收口）：先清后建 要么都成、要么都不成。
    // 原实现 deleteMany 与 createMany 分离，createMany 失败会把供应商授权清空（越权/失权脏数据）
    await this.prisma.$transaction([
      this.prisma.supplierCategory.deleteMany({ where: { supplierId: BigInt(id) } }),
      ...(dto.categoryIds.length
        ? [
            this.prisma.supplierCategory.createMany({
              data: dto.categoryIds.map((cid) => ({ supplierId: BigInt(id), categoryId: BigInt(cid) })),
            }),
          ]
        : []),
    ])

    // 铁律 3：分类授权决定供应商可见/可发布范围，属权限类关键操作，全量写审计
    // （2026-09-11 补，闭合审计复核缺口 G2）
    await this.audit.log({
      operatorId,
      action: 'SET_SUPPLIER_CATEGORIES',
      entity: 'supplier',
      entityId: id,
      before: { categoryIds: beforeRows.map((r) => Number(r.categoryId)).sort((a, b) => a - b) },
      after: { categoryIds: [...dto.categoryIds].sort((a, b) => a - b) },
    })

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

    // 手机号唯一前置校验 + 事务（2026-09-12 #22：撞号原抛 P2002→裸 5001 且 purchaser 已更新成半更新；修法同自助接口）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: p.userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    await this.prisma.$transaction([
      this.prisma.purchaser.update({ where: { id: BigInt(id) }, data }),
      ...(dto.phone !== undefined ? [this.prisma.user.update({ where: { id: p.userId }, data: { phone: dto.phone } })] : []),
    ])
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

    // 手机号唯一前置校验 + 事务（2026-09-12 #22：修法同 updateBuyer / 自助接口）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: s.userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    await this.prisma.$transaction([
      this.prisma.supplier.update({ where: { id: BigInt(id) }, data }),
      ...(dto.phone !== undefined ? [this.prisma.user.update({ where: { id: s.userId }, data: { phone: dto.phone } })] : []),
    ])
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

    const ud: any = {}
    if (dto.name !== undefined) ud.name = dto.name
    if (dto.phone !== undefined) ud.phone = dto.phone

    // 手机号唯一前置校验 + 事务（2026-09-12 #24：撞号原抛 P2002→裸 5001 且 courier 已更新成半更新；修法同 #22 updateBuyer/updateSupplier）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: c.userId } } })
      if (phoneOwner) throw new BizException(ErrorCode.PHONE_ALREADY_USED, '该手机号已被其他账号使用')
    }

    await this.prisma.$transaction([
      this.prisma.courier.update({ where: { id: BigInt(id) }, data }),
      ...(Object.keys(ud).length ? [this.prisma.user.update({ where: { id: c.userId }, data: ud })] : []),
    ])
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
