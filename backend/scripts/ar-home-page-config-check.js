// 卡BA-2（2026-10-01）：首页三项运营化验收测试
//   ① 配送说明横幅 → 横版滚动图片（home_banner_images：{enabled, images:[url…]}，运营后台可设数量）
//   ② 常用功能宫格 → 运营可配（home_features：[{key,label,emoji,type,page}]，数量可变）
//   ③ 首页右上角客服电话（service_hotline KV，makePhoneCall 拨打）
// 运行：node scripts/ar-home-page-config-check.js（后端 3001 已启动）
// 只动 platform_config 的 home_* key（验收前备份，验收后还原），不碰业务数据。
const fs = require('fs')
const BASE = 'http://localhost:3001/api/v1'
let passed = 0, failed = 0
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✅ ' + name) }
  else { failed++; console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')) }
}
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}
async function main() {
  console.log('='.repeat(52))
  console.log('卡BA-2 · 首页横幅滚动图/常用功能/客服电话 验收')
  console.log('='.repeat(52))
  const admin = await call('POST', '/auth/wx-login', { code: 'admin' })
  const t = admin?.data?.token
  check('admin 登录', !!t)

  // ── 0. 备份当前 home_* 配置（验收后还原）──
  const before = await call('GET', '/admin/finance/home-content', null, t)
  const backup = JSON.parse(JSON.stringify(before.data || {}))
  console.log('\n【0. 备份原始配置】')
  check('home-content GET 可用', before.code === 0 || before.data !== undefined)

  // ── 1. 保存三项新配置 ──
  console.log('\n【1. 运营后台保存配置】')
  const dto = {
    deliveryNote: { title: '验收-横幅标题', subtitle: '验收-横幅副文案' },
    notice: { enabled: true, text: '验收-公告' },
    recommendationIds: [],
    bannerImages: { enabled: true, images: ['/uploads/a.jpg', '/uploads/b.jpg', '/uploads/c.jpg'] },
    features: [
      { key: 'goods', label: '分类选购', emoji: '🥬', type: 'tab', page: '/pages/buyer/goods' },
      { key: 'recent', label: '最近购买', emoji: '🕐', type: 'tab', page: '/pages/buyer/order-list' },
    ],
    serviceHotline: '13800138000',
  }
  const save = await call('PUT', '/admin/finance/home-content', dto, t)
  check('PUT home-content 含新字段保存成功', save.code === 0, save)
  const saved = save.data || {}
  check('bannerImages 回读 images 数量=3', (saved.bannerImages?.images || []).length === 3, saved.bannerImages)
  check('bannerImages.enabled 回读 true', saved.bannerImages?.enabled === true)
  check('features 回读数量=2', (saved.features || []).length === 2, saved.features)
  check('features 字段完整（key/label/emoji/type/page）',
    saved.features?.[0] && ['key','label','emoji','type','page'].every(k => k in saved.features[0]), saved.features?.[0])
  check('serviceHotline 回读 13800138000', saved.serviceHotline === '13800138000')

  // ── 2. 采购方端 home-content 返回新数据 ──
  console.log('\n【2. 采购方端读取】')
  const buyer = await call('POST', '/auth/wx-login', { code: 'buyer_ar_' + Date.now() })
  const bt = buyer?.data?.token
  check('buyer 登录', !!bt)
  const home = await call('GET', '/buyer/home-content', null, bt)
  const h = home.data || {}
  check('GET /buyer/home-content 成功', home.code === 0, home)
  check('bannerImages 透传给采购方（3 张）', (h.bannerImages?.images || []).length === 3, h.bannerImages)
  check('features 透传给采购方（2 个）', (h.features || []).length === 2, h.features)
  check('serviceHotline 透传给采购方', h.serviceHotline === '13800138000', h.serviceHotline)

  // ── 3. 参数校验（防脏数据）──
  console.log('\n【3. 参数校验】')
  const bad1 = await call('PUT', '/admin/finance/home-content', { ...dto, bannerImages: { enabled: true, images: [42, 'x'] } }, t)
  check('bannerImages.images 非字符串数组被拒', bad1.code !== 0, bad1.code)
  const bad2 = await call('PUT', '/admin/finance/home-content', { ...dto, bannerImages: { enabled: true, images: Array.from({length: 11}, (_, i) => '/uploads/' + i + '.jpg') } }, t)
  check('bannerImages 超 10 张被拒', bad2.code !== 0, bad2.code)
  const bad3 = await call('PUT', '/admin/finance/home-content', { ...dto, serviceHotline: 'abc123' } , t)
  check('serviceHotline 非电话格式被拒', bad3.code !== 0, bad3.code)
  const bad4 = await call('PUT', '/admin/finance/home-content', { ...dto, features: [{ key: 'x', label: '', emoji: '🥬', type: 'tab', page: '/p' }] }, t)
  check('features.label 为空被拒', bad4.code !== 0, bad4.code)
  const bad5 = await call('PUT', '/admin/finance/home-content', { ...dto, features: Array.from({length: 9}, (_, i) => ({ key: 'k'+i, label: '功能'+i, emoji: '🥬', type: 'tab', page: '/p' })) }, t)
  check('features 超 8 个被拒', bad5.code !== 0, bad5.code)
  const bad6 = await call('PUT', '/admin/finance/home-content', { ...dto, features: [{ key: 'x', label: '功能', emoji: '🥬', type: '跳转', page: '/p' }] }, t)
  check('features.type 非法值被拒', bad6.code !== 0, bad6.code)

  // ── 4. 采购方角色不可写运营配置 ──
  console.log('\n【4. 权限】')
  const forbidden = await call('PUT', '/admin/finance/home-content', dto, bt)
  check('buyer 调 PUT home-content 被拒', forbidden.code !== 0, forbidden.code)

  // ── 5. 还原配置 ──
  console.log('\n【5. 还原】')
  const restoreDto = {
    deliveryNote: backup.deliveryNote || { title: '', subtitle: '' },
    notice: backup.notice || { enabled: false, text: '' },
    recommendationIds: backup.recommendationIds || [],
    bannerImages: backup.bannerImages || { enabled: false, images: [] },
    features: backup.features || [],
    serviceHotline: backup.serviceHotline || '',
  }
  const restore = await call('PUT', '/admin/finance/home-content', restoreDto, t)
  check('配置已还原', restore.code === 0, restore)
  const after = await call('GET', '/buyer/home-content', null, bt)
  check('还原后 bannerImages 与验收前一致',
    JSON.stringify((after.data?.bannerImages || {}).images || []) === JSON.stringify((backup.bannerImages || {}).images || []),
    { now: (after.data?.bannerImages || {}).images, was: (backup.bannerImages || {}).images })

  console.log('\n' + '='.repeat(52))
  console.log(`验收结果：✅ 通过 ${passed} 项 / ❌ 失败 ${failed} 项`)
  console.log('='.repeat(52))
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
