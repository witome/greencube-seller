import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BizException, ErrorCode } from '../../common/constants/error-codes'
import { AuditService } from '../audit/audit.service'
import { CreateUnitDto } from './dto/create-unit.dto'
import { UpdateUnitDto } from './dto/update-unit.dto'

/// 重名文案（原型「＋新增单位」弹窗拍板：红字「该单位已存在」）
export const UNIT_DUPLICATE_MSG = '该单位已存在，请换一个'

/// name 唯一键撞车（P2002）→ 业务码 1001。
/// 抽成导出函数是为了让自测脚本能拿**真实 P2002** 证明它生效（正常路径查重已经拦了，到不了这儿）。
export function unitDuplicateError(e: unknown): BizException | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new BizException(ErrorCode.PARAM_ERROR, UNIT_DUPLICATE_MSG)
  }
  return null
}

@Injectable()
export class MeasureUnitService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ────────────────────────────────────────
  // GET /units —— 供应商端单位 chip + 后台商品表单下拉
  // 只返回启用中，按 sort asc, id asc
  // ────────────────────────────────────────
  async listEnabled() {
    const rows = await this.prisma.measureUnit.findMany({
      where: { status: 1 },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    })
    return rows.map((r) => ({ id: Number(r.id), name: r.name, sort: r.sort }))
  }

  // ────────────────────────────────────────
  // GET /admin/units —— 后台「商品管理 / 计量单位」页
  // 全部（含停用），带 status 与 statusText
  // ────────────────────────────────────────
  async listAll() {
    const rows = await this.prisma.measureUnit.findMany({
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    })
    return rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      sort: r.sort,
      status: r.status,
      statusText: r.status === 1 ? '启用' : '停用',
    }))
  }

  // ────────────────────────────────────────
  // POST /admin/units —— 新增单位
  // ────────────────────────────────────────
  async create(operatorId: bigint, dto: CreateUnitDto) {
    const name = String(dto.name ?? '').trim()
    if (!name) throw new BizException(ErrorCode.PARAM_ERROR, '单位名称不能为空')

    // 重名（**含已停用的同名**）→ 1001。先查后写是给人看的友好提示，
    // 库层 name 唯一键是兜底（并发下第二次 create 撞 P2002 → 同一句文案）
    await this.assertNameFree(name)

    const sort = dto.sort !== undefined ? dto.sort : await this.nextSort()
    const status = dto.status !== undefined ? dto.status : 1

    let row
    try {
      row = await this.prisma.measureUnit.create({ data: { name, sort, status } })
    } catch (e) {
      const biz = unitDuplicateError(e)
      if (biz) throw biz
      throw e
    }

    await this.audit.log({
      operatorId,
      action: 'MEASURE_UNIT_CREATE',
      entity: 'measure_unit',
      entityId: Number(row.id),
      before: null,
      after: { name, sort, status },
    })

    return { id: Number(row.id), name: row.name, sort: row.sort, status: row.status }
  }

  // ────────────────────────────────────────
  // PATCH /admin/units/:id —— 改名 / 排序 / 启停
  // ⚠️ 没有 DELETE（口径：单位用过就停用、不真删；删了老商品与历史订单会显示空白）
  // ────────────────────────────────────────
  async update(id: number, operatorId: bigint, dto: UpdateUnitDto) {
    const unit = await this.prisma.measureUnit.findUnique({ where: { id: BigInt(id) } })
    if (!unit) throw new BizException(ErrorCode.NOT_FOUND, '该单位不存在')

    const data: any = {}
    if (dto.name !== undefined) {
      const name = String(dto.name).trim()
      if (!name) throw new BizException(ErrorCode.PARAM_ERROR, '单位名称不能为空')
      if (name !== unit.name) await this.assertNameFree(name, unit.id)
      data.name = name
    }
    if (dto.sort !== undefined) data.sort = dto.sort
    if (dto.status !== undefined) data.status = dto.status

    if (Object.keys(data).length === 0) {
      return { id: Number(unit.id), name: unit.name, sort: unit.sort, status: unit.status }
    }

    let row
    try {
      row = await this.prisma.measureUnit.update({ where: { id: unit.id }, data })
    } catch (e) {
      const biz = unitDuplicateError(e)
      if (biz) throw biz
      throw e
    }

    await this.audit.log({
      operatorId,
      action: 'MEASURE_UNIT_UPDATE',
      entity: 'measure_unit',
      entityId: Number(row.id),
      before: { name: unit.name, sort: unit.sort, status: unit.status },
      after: { name: row.name, sort: row.sort, status: row.status },
    })

    return { id: Number(row.id), name: row.name, sort: row.sort, status: row.status }
  }

  // ── 内部 ────────────────────────────────
  /// 重名检查：默认全表查（含停用行）；传 excludeId 时排除自身（改名用）
  private async assertNameFree(name: string, excludeId?: bigint) {
    const hit = await this.prisma.measureUnit.findFirst({
      where: {
        name,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    })
    if (hit) throw new BizException(ErrorCode.PARAM_ERROR, UNIT_DUPLICATE_MSG)
  }

  /// 追加到末尾：当前最大 sort + 1（空表时得 1）
  private async nextSort(): Promise<number> {
    const max = await this.prisma.measureUnit.aggregate({ _max: { sort: true } })
    return (max._max.sort ?? 0) + 1
  }
}
