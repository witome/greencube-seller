import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'

/**
 * 密码哈希（拍板 1A：后台「账号+密码」登录）
 * 不引入新依赖，用 Node 内置 crypto.scrypt：
 * - 每个用户独立随机 salt（16 字节）
 * - 存储格式：scrypt$<salt-hex>$<hash-hex>（单列，user.passwordHash）
 * - 比对用 crypto.timingSafeEqual（恒定时间，防时序攻击）
 */
const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LEN = 64
const SALT_LEN = 16

/** 明文 → scrypt$<salt-hex>$<hash-hex> */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const hash = await scrypt(plain, salt, KEY_LEN)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/** 校验明文是否匹配存储的哈希；格式不符一律返回 false */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[1], 'hex')
    expected = Buffer.from(parts[2], 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  const hash = await scrypt(plain, salt, expected.length)
  return hash.length === expected.length && timingSafeEqual(hash, expected)
}
