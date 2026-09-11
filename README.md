# 绿立方 · 开发项目

B2B 生鲜配送平台（菜市场供应商 → 餐馆/食堂）的完整代码工程。

## 📚 设计与文档在哪？

**不在本文件夹内。** 计划文档全部在 Obsidian， deliberately 与代码分开：

```
C:\Users\Administrator\Documents\Obsidian Vault\绿立方卖菜平台workbuddy版\
├── 绿立方卖菜平台workbuddy版.md          ← 主计划（业务规则、权限、路线图）
├── 开发配套-数据模型与接口草案.md          ← 数据字典、订单状态机、5 项已确认决策
├── 开发配套-API接口字段契约.md            ← ⭐ 编码时对照这份写接口
├── 开发配套-环境准备与上线清单.md          ← 备案/账号/服务器准备
└── 原型\                                  ← 41 页 HTML 原型（视觉基准）
```

> **为什么分开**：Obsidian 是笔记工具，代码工程会带几万文件的 `node_modules`，混在一起会拖慢它。文档是给人看的，代码是要跑的，性质不同。

## 🗂 本工程结构

```
绿立方开发\
├── backend\              NestJS 后端（端口 3001）
│   ├── prisma\schema.prisma   ← 全部数据表（从数据字典翻译）
│   └── src\
│       ├── common\            统一响应、异常过滤、角色守卫、错误码
│       └── modules\           业务模块（controller/service/module）
├── frontend\             uni-app 前端（Vue3 + Vite + Pinia，H5 端口 5180）
│   ├── src\pages.json         27 个页面路由（另有 subpkg-supplier / subpkg-courier 分包）
│   ├── src\styles\tokens.scss 设计 token（与原型一致）
│   └── src\pages\...          采购方/供应商/配送员端页面已实现（39/41 对齐原型，AI 客服 2 页为阶段 2）
└── admin-web\            运营后台（Vue3 + Element Plus，端口 5190）
```

## 🚀 启动

### 后端

```bash
cd backend
npm install
cp .env.example .env          # 然后改 DATABASE_URL 等
npx prisma migrate dev --name init
npm run dev                   # http://localhost:3001/api/v1（.env PORT=3001，本机 3000 被占用）
```

### 前端

```bash
cd frontend
npm install
npm run dev:h5                # 浏览器调试
npm run dev:mp-weixin         # 微信开发者工具导入 dist/dev/mp-weixin
```

> 前端两处必改：`src/manifest.json` 填小程序 AppID、`src/api/request.js` 改 BASE_URL。

## ✅ 已确认的业务决策（编码时必须遵守）

| # | 决策 | 影响 |
|---|---|---|
| 1 | **下单时即自动拆单**（2026-09-10 拍板修订，原「核单时拆单」已作废） | 下单落 `status=10`（待核单），并在下单事务内按供货优先级 + 当日可供量自动拆单写 `order_item.supplier_id`；运营核单时对明细做确认/调整，支持重新拆单（改拆单按商品维度重建明细） |
| 2 | **申报超时自动兜底** | 每日 22:00 截止，超时取 `daily_supply`，标 `is_auto_declared=1` |
| 3 | **拒收从结算剔除 + 生成售后工单** | 对账基数恒为 `qty_accepted`，差额进 `aftersale_order` |
| 4 | **token 内嵌身份，切换重签** | JWT payload 含 `currentRole`；`/auth/switch-role` 重签，旧 token 失效 |
| 5 | **业务员 = 运营子账号** | 角色码 `business_agent`，权限仅限采购方审核，看不到金额/订单/结算 |

> **支付金额口径（2026-09-11 拍板）**：线上支付（微信支付模拟通道）支付金额 = **下单时刻应付 = `amountOrdered + deliveryFee`**（加急费已含在 `deliveryFee`）；备货缺货导致的差额走售后/结算环节找补（与 COD 口径一致）。订单超时自动关单为已知欠账，未实现。

## ⚠️ 三条权限铁律（写代码时不能违反）

1. **配送员不碰钱** —— `courier` 模块接口不返回任何金额字段；唯一例外是「收款协助」`GET /courier/task/:id/amount`，仅展示**货到付款订单的应收数字**供核对（非 COD 订单隐藏），且配送员只标记收款、不作核销，不碰资金流
2. **供应商不见销售价** —— `product` 模块对 `supplier` 角色**不返回 `salePrice`**
3. **运营看得全、改得慎** —— 金额相关操作二次确认 + 全量写 `audit_log`

## 📅 开发顺序（见《开发配套①》第四节）

```
第 1 周：auth + 用户/角色 + 采购方注册审核 + 分类/商品
第 2 周：采购方端（商品/购物车/下单）+ admin-goods 审核
第 3 周：供应商端（备货申报）+ 核单拆单 + 验收称重（五数量）
第 4 周：配送员端（任务/签收）+ 派送调度 + 订单状态机收尾
第 5 周：结算单（服务费公式）+ 对账报表 + 联调
第 6 周：真实用户灰度（3 供应商 + 5 餐馆）
```

## 🔗 前后端接口对照

前端 `frontend/src/api/modules.js` 的接口签名 ↔ 后端 `backend/src/modules/*` ↔ 契约文档《开发配套②》三者一一对应，改任一方需同步另外两处。
