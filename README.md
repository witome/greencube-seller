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
│       └── modules\           业务模块（controller/service/module，共 22 个目录）
├── frontend\             uni-app 前端（Vue3 + Vite + Pinia，H5 端口 5180）
│   ├── src\pages.json         30 条页面路由（主包 16 + subpkg-supplier 7 + subpkg-courier 7）
│   ├── src\styles\tokens.scss 设计 token（与原型一致）
│   └── src\pages\...          三端页面已实现（原型对应页 27/27 全部已建，详见下方「页面数口径」）
└── admin-web\            运营后台（Vue3 + Element Plus，端口 5190）
```

## 📐 页面数口径（统一口径，避免三处数字打架）

> **口径：只统计「原型对应页」；非原型新增页与准入中间页一律单列，不与原型页混算。**

| 端 | 原型对应页 | 非原型页（单列） | 合计 |
|---|---|---|---|
| 采购方小程序 | 14（含注册 / 待审核 / 驳回申诉 3 个准入中间页） | 1 · `buyer/aftersale-list`（售后列表） | 15 |
| 供应商小程序 | 7 | 0 | 7 |
| 配送员小程序 | 6 | 1 · `courier/cod-pay`（COD 收款） | 7 |
| 小程序登录页 | 0（原型无登录页） | 1 | 1 |
| **小程序小计** | **27** | **3** | **30** |
| 运营后台 | 14（映射到 12 个 `.vue` 文件） | 4（分类管理 / 商品管理 / 售后管理 / 支付流水）+ 登录页 1 | 17 个页面文件 |
| **原型合计** | **41** | | |

> 原型对应页映射到文件时会有「一文件多页」：`weighing`（验收称重）与 `fulfill`（订单履约）同用 `OrderFulfill.vue`；`feeSetting`（服务费设置）与 `finance`（资金结算）同用 `Finance.vue`。

> **AI 客服 2 页的状态要写准**（别写成「已完成」）：`pages/buyer/kefu.vue` + `pages/buyer/ai-confirm.vue` **页面已实现**，后端 `POST /ai/parse` 为**规则/关键词解析版**；**LLM 与企微「微信客服」链路未接**（属阶段 2 待办，依赖企微主体认证）。接口结构已预留替换大模型。

> **数量模型现状**：`order_item` 的数量字段设计为「五数量」，实际业务**只跑通 4 个**——订购 `qty_ordered` / 申报 `qty_declared` / 验收 `qty_accepted`（= 申报量）/ 接受；**分拣 `qty_sorted` 全仓零引用**（仅 schema 预留字段，业务未启用）。是否启用或文档降级属**待拍板项**（涉及对账基数口径）。

### ⚙️ 运营后台页面清单（`admin-web/src/views/`）

**登录页 1**：`Login.vue`　**工作台 1**：`Dashboard.vue`　**业务页 15**：

| # | 业务页 | 文件 |
|---|---|---|
| 1 | 采购方管理 | `buyers/BuyerList.vue`（审核详情为其内部弹窗） |
| 2 | 供应商管理 | `dispatch/Suppliers.vue` |
| 3 | 配送员管理 | `dispatch/Couriers.vue` |
| 4 | 商品审核 | `goods/GoodsAudit.vue` |
| 5 | 商品管理 | `goods/GoodsManage.vue` |
| 6 | 分类管理 | `goods/Categories.vue` |
| 7 | 订单履约（核单拆单） | `order/OrderFulfill.vue` |
| 8 | 售后管理 | `order/Aftersale.vue` |
| 9 | 派送调度 | `dispatch/Dispatch.vue` |
| 10 | 资金结算 | `finance/Finance.vue` |
| 11 | 支付流水 | `finance/Payments.vue` |
| 12 | 审计日志 | `audit/AuditLog.vue` |
| 13 | 价格与加价 | `pricing/Pricing.vue` |
| 14 | 报表中心 | `reports/Reports.vue` |
| 15 | 系统设置 | `settings/Settings.vue` |

> ⚠️ **`views/buyers/BuyerVerify.vue` 不存在**——旧文档（含 Obsidian《原型代码对照清单》）把它列为独立页面，实际「采购方审核详情」是 `BuyerList.vue` 内的弹窗。
> 另：`views/Placeholder.vue` 是占位组件，不是页面。
> 合计 18 个 `.vue` 文件 = 登录页 1 + 工作台 1 + 业务页 15 + 占位组件 1。


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
| 1 | **下单时即自动拆单**（2026-09-10 拍板修订，原「核单时拆单」已作废） | 下单落 `status=10`（待核单），并在**下单事务内**按供货优先级 + 当日可供量自动拆单写 `order_item.supplier_id` / `supply_price` 快照 / `qtyDeclared=qtyOrdered`；`10→30 备货中` 由「支付方式生效（COD）/ 支付回调（微信）/ 运营核单」任一触发。**不存在 `20 已拆单` 态**（已废弃）。运营核单时对明细做确认/调整，支持重新拆单（改拆单按商品维度重建明细）。落点：`order.service.ts:81-82 → autoSplit()` |
| 2 | **申报超时自动兜底** | 每日 22:00 截止，超时取 `daily_supply`，标 `is_auto_declared=1`（已实现：`supplier-fulfill/auto-declare.service.ts`，幂等 + 写审计）。注意它与「拆单即默认满额、缺货才异常申报」**并存不冲突**——前者管「没申报怎么办」，后者管「申报接口的语义」 |
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
第 3 周：供应商端（备货单 + 异常申报 + 确认备货完成）+ 核单拆单（无验收称重环节）
第 4 周：配送员端（任务/签收）+ 派送调度 + 订单状态机收尾
第 5 周：结算单（服务费公式）+ 对账报表 + 联调
第 6 周：真实用户灰度（3 供应商 + 5 餐馆）
```

> ⚠️ **无「验收称重」环节**（旧文档残留）：`POST /admin/order/:id/weighing` 接口**已从代码移除**。
> `30 备货中 → 40 待配送` 由供应商「确认备货完成」触发，落点 = `POST /supplier-fulfill/handover`：
> 申报量即最终交付量（`qtyAccepted = qtyDeclared`），并自动重算 `amountFinal = Σ(验收量 × 销售价) + 运费`。

## 🔗 前后端接口对照

前端 `frontend/src/api/modules.js` 的接口签名 ↔ 后端 `backend/src/modules/*` ↔ 契约文档《开发配套②》三者一一对应，改任一方需同步另外两处。

## ✅ 当前验收基线（唯一权威数字）

```bash
cd backend && node 验收测试.js
```

**预期输出：`✅ 通过 77 项 / ❌ 失败 0 项`（退出码 0）。**

> 历史沿革（仅备查，勿再引用旧值）：25/25（脚本按已废弃旧状态机写，**虚标不可复现**）→ 30/30（2026-09-11 重写对齐，提交 `96b3f50`）→ 46/46（+ 微信支付模拟回调 16 项）→ 64/1（+ 支付流水页 19 项，1 项失败暴露守卫漏洞）→ **77/0（2026-09-11 修掉漏洞与假红后，+ 12 项权限收口回归）**。

