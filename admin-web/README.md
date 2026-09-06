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

## 开发登录

后端是 dev mock 登录（code 直接当 openid）。登录页点「一键登录运营账号」即可（code=admin）。

## 页面清单

| 路由 | 页面 | 状态 |
|---|---|---|
| /login | 登录 | ✅ |
| /dashboard | 工作台（待办聚合 + 快捷入口） | ✅ |
| /buyers | 采购方管理（待审核队列 + 筛选） | ✅ |
| /buyers/:id/verify | 核实详情（风险预检 + 通过/驳回 + 申诉复核） | ✅ |
| /goods | 商品审核 | ⬜ 占位（后端已就绪） |
| /order | 订单履约（核单拆单/验收称重） | ⬜ 占位 |
| /dispatch | 派送调度 | ⬜ 占位 |
| /finance | 资金结算（服务费/结算单） | ⬜ 占位 |
| /audit | 审计日志 | ⬜ 占位 |

## 后端接口对照

见 `src/api/modules.js`，与《开发配套②-API接口字段契约》一致：

- 采购方审核：`/admin/buyers/*`
- 商品审核：`/admin/goods/*`
- 订单履约：`/admin/order/*`
- 派送调度：`/admin/dispatch`
- 资金结算：`/admin/finance/*`
- 审计日志：`/audit`
