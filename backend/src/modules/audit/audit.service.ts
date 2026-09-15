import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  // ────────────────────────────────────────
  // 审计日志查询（分页 + 按实体/操作人过滤）
  // ────────────────────────────────────────
  async list(query: { entity?: string; operatorId?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(query.page || '1'))
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20')))
    const where: any = {}
    if (query.entity) where.entity = query.entity
    if (query.operatorId) where.operatorId = BigInt(query.operatorId)

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      total,
      list: rows.map((l) => ({
        id: Number(l.id),
        operatorId: Number(l.operatorId),
        action: l.action,
        entity: l.entity,
        entityId: Number(l.entityId),
        before: l.before,
        after: l.after,
        createdAt: l.createdAt.toISOString(),
      })),
    }
  }

  // ────────────────────────────────────────
  // 写审计日志（金额/权限等关键操作统一入口）
  // tx 可选：传入交互式事务客户端时，审计随该事务一并提交/回滚（保证与业务写原子）
  // ────────────────────────────────────────
  async log(data: { operatorId: bigint; action: string; entity: string; entityId: bigint | number; before?: any; after?: any }, tx?: any) {
    const client = tx || this.prisma
    await client.auditLog.create({
      data: {
        operatorId: data.operatorId,
        action: data.action,
        entity: data.entity,
        entityId: BigInt(data.entityId),
        before: data.before ?? undefined,
        after: data.after ?? undefined,
      },
    })
  }
}
