# 绿立方 · 运营管理后台（admin-web）

B2B 生鲜配送平台的运营侧 Web 管理后台。桌面布局，供平台运营/老板在电脑浏览器使用，复用后端已实现的 admin 接口。

## 技术栈

- Vue 3 + Vite
- Element Plus（后台组件库）
- Vue Router + Axios

## 启动

```bash
cd "C:\Users\Administrator\Documents\绿立方开发\admin-web"
npm install            # 首次（已装依赖可跳过）
npm run dev            # http://localhost:5190
```

> 后端需在 3001 端口运行（vite 已配置 proxy，前端请求 /api 自动代理到后端）。
> ⚠️ 注意：本工程 Vite 只绑 `[::1]`（IPv6），浏览器/脚本访问必须用 `http://localhost:5190`；用 `127.0.0.1:5190` 会连不上。
> ⚠️ 别与其他端记混：`5180` = 小程序 H5（`frontend/`），`5190` = 本运营后台。

## 开发登录

后端是 dev mock 登录（code 直接当 openid）。登录页点「一键登录运营账号」即可（code=admin）。

## 页面清单

**登录页 1 + 工作台 1 + 业务页 15 = 17 个页面文件**（另有 `views/Placeholder.vue` 占位组件、非页面）。

| 路由 | 页面 | 文件 | 状态 |
|---|---|---|---|
| /login | 登录 | `Login.vue` | ✅ |
| /dashboard | 工作台（待办聚合 + 快捷入口） | `Dashboard.vue` | ✅ |
| /buyers | 采购方管理（待审核队列 + 筛选；**审核详情为页内弹窗**） | `buyers/BuyerList.vue` | ✅ |
| /suppliers | 供应商管理 | `dispatch/Suppliers.vue` | ✅ |
| /couriers | 配送员管理 | `dispatch/Couriers.vue` | ✅ |
| /goods | 商品审核（含「供货优先级」Tab + 编辑弹窗） | `goods/GoodsAudit.vue` | ✅ |
| /goods-manage | 商品管理 | `goods/GoodsManage.vue` | ✅ |
| /categories | 分类管理 | `goods/Categories.vue` | ✅ |
| /order | 订单履约（核单拆单 / 明细查看；**无验收称重**） | `order/OrderFulfill.vue` | ✅ |
| /aftersale | 售后管理（收拒收 / 少货 / 品质问题处理） | `order/Aftersale.vue` | ✅ |
| /dispatch | 派送调度 | `dispatch/Dispatch.vue` | ✅ |
| /finance | 资金结算（服务费 / 结算单） | `finance/Finance.vue` | ✅ |
| /payments | 支付流水（**仅线上支付**；COD 见订单履约页） | `finance/Payments.vue` | ✅ |
| /audit | 审计日志 | `audit/AuditLog.vue` | ✅ |
| /pricing | 价格与加价 | `pricing/Pricing.vue` | ✅ |
| /reports | 报表中心 | `reports/Reports.vue` | ✅ |
| /settings | 系统设置 | `settings/Settings.vue` | ✅ |

> ⚠️ `views/buyers/BuyerVerify.vue` **不存在**（旧文档误列为独立页面）：采购方审核详情是 `BuyerList.vue` 内的弹窗。
> ⚠️ 原型对应 14 页映射到 12 个文件：`weighing`（验收称重）与 `fulfill`（订单履约）同用 `OrderFulfill.vue`；`feeSetting`（服务费设置）与 `finance`（资金结算）同用 `Finance.vue`。分类管理 / 商品管理 / 售后管理 / 支付流水为**非原型新增页**。

## 后端接口对照

见 `src/api/modules.js`，与《开发配套②-API接口字段契约》一致：

- 采购方审核：`/admin/buyers/*`
- 商品审核 / 商品管理 / 供货优先级：`/admin/goods/*`（含 `PUT /admin/goods/:productId/priority`）
- 订单履约：`/admin/order/*`（核单拆单；**无 weighing 接口**）
- 售后：`/admin/aftersale/*`
- 派送调度：`/admin/dispatch/*`
- 资金结算：`/admin/finance/*`
- 支付流水（只读）：`/admin/payments`
- 审计日志：`/audit`
