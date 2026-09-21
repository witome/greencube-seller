// 卡T 证据采集脚本（只读，仅打本机后端 3001）
// 用法: node _capture.mjs before|after
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://127.0.0.1:3001/api/v1'
const DATE = '2026-09-21'
const label = process.argv[2] || 'before'
const dir = path.dirname(fileURLToPath(import.meta.url))

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return { raw: t } } }

const login = await j(await fetch(`${BASE}/auth/wx-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'admin' }) }))
if (login.code !== 0) { console.error('登录失败', JSON.stringify(login)); process.exit(1) }
const H = { Authorization: `Bearer ${login.data.token}` }

const dr = await j(await fetch(`${BASE}/admin/finance/daily-reconciliation?date=${DATE}`, { headers: H }))
const pending = await j(await fetch(`${BASE}/admin/order/pending`, { headers: H }))
const delivered = await j(await fetch(`${BASE}/admin/order/delivered`, { headers: H }))

const out = { label, date: DATE, capturedAt: new Date().toISOString(), summary: dr.data?.summary ?? null, drRaw: dr.data ?? dr, pending: pending.data ?? pending, delivered: delivered.data ?? delivered }
fs.writeFileSync(path.join(dir, `_api-${label}.json`), JSON.stringify(out, null, 2), 'utf8')

const s = out.summary || {}
const L = []
L.push(`# 卡T 接口基线 (${label}) 日期=${DATE}`)
L.push(`采集时间: ${out.capturedAt}`)
L.push('')
L.push('## 每日对账 summary（五个数字 + 计数）')
for (const k of ['receivable', 'received', 'unpaid', 'supplierPayable', 'grossProfit', 'orderCount', 'wechatPaidCount', 'codPaidCount', 'codUnpaidCount']) L.push(`${k} = ${s[k]}`)
L.push('')
L.push(`## 未收款清单 unpaidList 行数 = ${(out.drRaw?.unpaidList || []).length}`)
L.push('')
L.push('## 履约页 待处理单（status 10/30）金额字段')
for (const o of (Array.isArray(out.pending) ? out.pending : [])) L.push(`#${o.orderId} amountOrdered=${o.amountOrdered} deliveryFee=${o.deliveryFee ?? '(未返回)'} amountFinal=${o.amountFinal ?? '(未返回)'}`)
L.push('')
L.push('## 履约页 已送达单 金额字段（取 2026-09-21 及种子单）')
for (const o of (Array.isArray(out.delivered) ? out.delivered : []).filter((x) => x.deliveryDate === DATE)) L.push(`#${o.orderId} amountOrdered=${o.amountOrdered} deliveryFee=${o.deliveryFee ?? '(未返回)'} amountFinal=${o.amountFinal ?? '(未返回)'} payMethod=${o.payMethod} photos=${o.payProof?.photos?.length ?? 0} claim=${o.buyerPaidClaimAt ?? '-'}`)
fs.writeFileSync(path.join(dir, `_api-${label}.txt`), L.join('\n'), 'utf8')
console.log(L.join('\n'))
