/**
 * 一次性脚本：在服务器上创建/设置后台管理员（拍板 1A，2026-09-19）
 *
 * 用法（只能在服务器上执行，绝不提供网页注册入口 / 默认账号 / 通用后门）：
 *   npx ts-node scripts/create-admin.ts <账号名>
 *
 * 行为：
 * - 账号复用 user.name（不新增字段）：
 *   - 已存在同名用户 → 为其设置/更新密码（若无 admin 角色则补授，会提示）
 *   - 不存在 → 创建（roles=["admin"]，status=1，wxOpenid=cli_admin_<账号名>）
 * - 密码交互式输入（不回显），不落 shell history、不落日志
 * - 密码以 scrypt 哈希存储（见 src/common/utils/password.util.ts），库里无明文
 */
import { PrismaClient } from '@prisma/client'
import * as readline from 'readline'
import { hashPassword } from '../src/common/utils/password.util'
import { Role } from '../src/common/constants/error-codes'

const prisma = new PrismaClient()

// 非交互调用（管道/重定向输入，如自动化冒烟）：预先读入全部 stdin 按行出队；
// TTY 交互则走 readline 不回显。仅服务器人工执行时才走交互分支。
const pipeLines: string[] | null = process.stdin.isTTY
  ? null
  : (() => {
      try {
        return require('fs').readFileSync(0, 'utf8').split(/\r?\n/)
      } catch {
        return null
      }
    })()

function nextPipeLine(): string {
  return (pipeLines?.shift() ?? '').trim()
}

/** 交互式输入（密码不回显，逐字符打 *）；管道输入时直接取下一行 */
function askHidden(query: string): Promise<string> {
  if (pipeLines) return Promise.resolve(nextPipeLine())
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // 覆盖 readline 内部回显：初始提示原样输出，其余字符一律打 *
    const out = process.stdout
    ;(rl as any)._writeToOutput = function (s: string) {
      if (typeof s !== 'string') return
      if (s.startsWith(query)) out.write(s)
      else if (s === '\n' || s === '\r' || s === '\r\n') out.write('\n')
      else out.write('*')
    }
    rl.question(query, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function askPlain(query: string): Promise<string> {
  if (pipeLines) return Promise.resolve(nextPipeLine())
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(query, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  const name = process.argv[2]
  if (!name) {
    console.error('用法: npx ts-node scripts/create-admin.ts <账号名>')
    process.exit(1)
  }

  const password = await askHidden('请输入密码（≥8位，输入不回显）: ')
  if (password.length < 8) {
    console.error('❌ 密码至少 8 位，未做任何改动')
    process.exit(1)
  }
  const confirm = await askHidden('请再次输入密码确认: ')
  if (password !== confirm) {
    console.error('❌ 两次输入不一致，未做任何改动')
    process.exit(1)
  }

  const existing = await prisma.user.findMany({ where: { name }, select: { id: true, roles: true } })
  if (existing.length > 1) {
    console.error(`❌ 存在 ${existing.length} 个同名用户（id: ${existing.map((u) => u.id).join(', ')}），请先人工处理重名再执行`)
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)

  if (existing.length === 1) {
    const user = existing[0]
    const roles: string[] = Array.isArray(user.roles) ? (user.roles as string[]) : []
    let addedAdmin = false
    if (!roles.includes(Role.ADMIN)) {
      roles.push(Role.ADMIN)
      addedAdmin = true
    }
    await prisma.user.update({ where: { id: user.id }, data: { roles, passwordHash } })
    console.log(`✅ 已为现有用户 id=${user.id}（账号=${name}）设置密码${addedAdmin ? '，并补授 admin 角色' : ''}`)
  } else {
    const user = await prisma.user.create({
      data: { wxOpenid: `cli_admin_${name}`, name, roles: [Role.ADMIN], status: 1, passwordHash },
      select: { id: true },
    })
    console.log(`✅ 已创建管理员 id=${user.id}（账号=${name}）`)
  }
  console.log('ℹ️  该账号现在可用「账号+密码」登录运营后台（POST /api/v1/auth/admin-login）')
}

main()
  .catch((e) => {
    console.error('❌ 执行失败:', e?.message || e)
    process.exit(1)
  })
  .finally(() => {
    return prisma.$disconnect()
  })
