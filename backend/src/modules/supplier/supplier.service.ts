import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { UpdateSupplierProfileDto } from './dto/update-profile.dto'

const SUPPLIER_STATUS_TEXT: Record<number, string> = { 0: '待审核', 1: '合作中', 2: '已停合作' }

/** 手机号撞号统一业务码（user.phone 唯一约束；不返回裸 5001，2026-09-12 卡） */
const PHONE_USED = 3009

@Injectable()
export class SupplierService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // 店铺资料自助读写（2026-09-11 深夜卡第二部分）
  // 只按 token 的 userId 取自己的 supplier 档案——代码里没有任何 targetId/id 参数
  // 字段落点照运营侧 updateSupplier（唯一权威）：
  //   stallName / address → Supplier 列；contact / phone → qualification JSON；phone 同步 user 表
  // ────────────────────────────────────────
  async getSelfProfile(userId: bigint) {
    const s = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!s) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const qual = (s.qualification as any) || {}
    return {
      supplierId: Number(s.id),
      stallName: s.stallName,
      address: s.address,
      // 联系人/电话与运营侧同源（qualification JSON）
      contact: qual.contact ?? null,
      phone: qual.phone ?? null,
      status: s.status,
      statusText: SUPPLIER_STATUS_TEXT[s.status] ?? '未知',
      // 资质只读展示（剥掉 contact/phone，那两项目助可改不属资质）；无任何编造值
      qualification: {
        businessLicense: qual.businessLicense ?? null,
        quarantineCert: qual.quarantineCert ?? null,
        businessLicenseExpiry: qual.businessLicenseExpiry ?? null,
        quarantineCertExpiry: qual.quarantineCertExpiry ?? null,
      },
    }
  }

  async updateSelfProfile(userId: bigint, dto: UpdateSupplierProfileDto) {
    const s = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!s) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const data: any = {}
    if (dto.stallName !== undefined) data.stallName = dto.stallName
    if (dto.address !== undefined) data.address = dto.address || null

    // contact/phone 落 qualification JSON（照运营侧口径，**保留其余资质键**不动）
    const qual = { ...((s.qualification as any) || {}) }
    if (dto.contact !== undefined) qual.contact = dto.contact
    if (dto.phone !== undefined) qual.phone = dto.phone
    if (dto.contact !== undefined || dto.phone !== undefined) data.qualification = qual

    if (Object.keys(data).length === 0) {
      throw new BizException(ErrorCode.PARAM_ERROR, '没有可更新的字段')
    }

    // 手机号唯一前置校验：user.phone 有唯一约束，撞号若不前置拦截会在事务内抛 P2002 回滚成 5001。
    // 仅非空 phone 参与撞号校验（null=清空，不查）
    if (dto.phone) {
      const phoneOwner = await this.prisma.user.findFirst({ where: { phone: dto.phone, NOT: { id: s.userId } } })
      if (phoneOwner) throw new BizException(PHONE_USED, '该手机号已被其他账号使用')
    }

    // 变更前后值（仅记录实际变更的字段；contact/phone 的 before 取自原 qualification）
    const oldQual = (s.qualification as any) || {}
    const before: any = {}
    const after: any = {}
    if (dto.stallName !== undefined) { before.stallName = s.stallName; after.stallName = dto.stallName }
    if (dto.address !== undefined) { before.address = s.address; after.address = dto.address || null }
    if (dto.contact !== undefined) { before.contact = oldQual.contact ?? null; after.contact = dto.contact }
    if (dto.phone !== undefined) { before.phone = oldQual.phone ?? null; after.phone = dto.phone }

    // 事务：supplier 更新 + user 手机号同步要么都成、要么都不成（杜绝半更新）
    await this.prisma.$transaction([
      this.prisma.supplier.update({ where: { id: s.id }, data }),
      ...(dto.phone !== undefined ? [this.prisma.user.update({ where: { id: s.userId }, data: { phone: dto.phone } })] : []),
    ])

    // 独立 action SUPPLIER_SELF_UPDATE（照 A 卡 BUYER_SELF_UPDATE 先例）：
    // 与运营侧 UPDATE_SUPPLIER 区分「自助改/运营改」，审计页按 action 过滤更直接，也不动运营侧历史口径
    await this.audit.log({
      operatorId: userId,
      action: 'SUPPLIER_SELF_UPDATE',
      entity: 'supplier',
      entityId: s.id,
      before,
      after,
    })
    return { supplierId: Number(s.id), updated: true }
  }

  // ────────────────────────────────────────
  // 审核状态查询（2026-09-19 拍板卡）：供小程序「审核中」页 onShow/轮询
  // 返回结构与 /buyer/pending 完全一致（accountStatus/submittedAt/overdue/steps/rejectInfo）
  // 状态口径：0 待审核 / 1 合作中(=通过) / 2 停合作(=未通过/停用)
  // 只按 token 的 userId 取自己的档案，只读接口不审计
  // ────────────────────────────────────────
  async pending(userId: bigint) {
    const supplier = await this.prisma.supplier.findUnique({ where: { userId } })
    if (!supplier) throw new BizException(ErrorCode.NOT_FOUND, '未找到供应商档案')

    const submittedAt = supplier.createdAt
    const overdue = Date.now() - submittedAt.getTime() > 24 * 3600 * 1000

    let steps
    if (supplier.status === 0) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实中', status: 'active', time: null },
        { key: 'active', label: '审核通过', status: 'todo', time: null },
      ]
    } else if (supplier.status === 2) {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实', status: 'done', time: null },
        { key: 'active', label: '审核通过', status: 'rejected', time: null },
      ]
    } else {
      steps = [
        { key: 'submit', label: '资料提交', status: 'done', time: submittedAt.toISOString() },
        { key: 'verify', label: '运营核实', status: 'done', time: null },
        { key: 'active', label: '审核通过', status: 'done', time: null },
      ]
    }

    return {
      accountStatus: supplier.status,
      submittedAt: submittedAt.toISOString(),
      overdue,
      steps,
      rejectInfo:
        supplier.status === 2
          ? { reason: '档口账号已停用合作，请联系运营', reasonCode: 'SUPPLIER_SUSPENDED' }
          : null,
    }
  }
}
