# 绿立方 · uni-app 小程序端工程

由《绿立方小程序-全页面原型.html》（**41 页**，其中小程序端 **27 页**）转换而来的小程序端工程。**设计 token、公共样式、页面路由、状态管理、请求层、API 模块已就位，各页面均已接真 API 实现**（不再有骨架页）。

> 业务规则与数据模型见 Obsidian：《绿立方卖菜平台workbuddy版》（主计划）+《开发配套-数据模型与接口草案》。
> 运营后台是独立 Web 工程（Vue3 + Element Plus），独立目录 `admin-web/`。

> ⚠️ **口径更新（2026-09-11）**：本文件早期版本把工程描述为「骨架 + 2 页完整示范」，该描述**已过时**——截至 2026-09-11 全部页面均已接真 API 实现。以下数字与状态已按代码事实改写。

---

## 一、快速启动

```bash
npm install
npm run dev:mp-weixin    # 微信开发者工具导入 dist/dev/mp-weixin
npm run dev:h5            # 或先在浏览器里跑
```

> 依赖版本如与 uni-app 最新版不匹配，用官方脚手架重建后把 `src/` 整目录拷入即可：
> `npx degit dcloudio/uni-preset-vue#vite myapp`

别忘了：
1. `src/manifest.json` 中替换 `mp-weixin.appid` 为你的小程序 AppID
2. `src/api/request.js` 中 `BASE_URL` 改为后端地址（NestJS）

---

## 二、目录结构

```
src/
├── pages.json            # 30 条页面路由（主包 16 + subpkg-supplier 7 + subpkg-courier 7）+ tabBar
├── manifest.json         # 小程序配置（appid 待替换）
├── main.js / App.vue     # 入口；App.vue 全局注入两份样式
├── styles/
│   ├── tokens.scss       # ★ 设计 token：配色/字号/圆角/间距/阴影变量
│   └── common.scss       # ★ 公共组件样式：card/notice/tag/chip/pbtn/list-item…
├── store/user.js         # Pinia：多身份登录态与角色切换（switchRole 重签 token + reLaunch）
├── api/
│   ├── request.js        # 统一请求：token + X-Role 头、错误 toast、401 处理
│   └── modules.js        # API 模块索引，与《开发配套》接口契约一一对应
├── pages/login/          # 登录页 1（原型无此页，非原型页）
├── pages/buyer/          # 采购方 15 页（原型对应 14 + 非原型 1：aftersale-list 售后列表）
├── subpkg-supplier/      # 供应商 7 页（分包，按需加载；全部为原型对应页）
└── subpkg-courier/       # 配送员 7 页（分包；原型对应 6 + 非原型 1：cod-pay COD 收款）
```

> **页面数口径**：只统计「原型对应页」，非原型页单列。小程序合计 30 条路由 = 原型对应 **27** + 非原型 **3**（登录页 / 采购方售后列表 / 配送员 COD 收款）。


---

## 三、原型 → 工程对照表（27 个原型对应页，全部已接真 API）

| 原型 data-page | 工程页面 | 状态 |
|---|---|---|
| register | pages/buyer/register | ✅ 已实现 |
| pendingVerify | pages/buyer/pending-verify | ✅ 已实现 |
| verifyRejected | pages/buyer/verify-rejected | ✅ 已实现 |
| home | pages/buyer/home | ✅ 已实现 |
| goods | pages/buyer/goods | ✅ 已实现 |
| goodsDetail | pages/buyer/goods-detail | ✅ 已实现 |
| cart | pages/buyer/cart | ✅ 已实现 |
| orders | pages/buyer/order-list | ✅ 已实现 |
| orderDetail | pages/buyer/order-detail | ✅ 已实现 |
| bill | pages/buyer/bill | ✅ 已实现 |
| aftersale | pages/buyer/aftersale | ✅ 已实现 |
| profile | pages/buyer/mine | ✅ 已实现 |
| kefu | pages/buyer/kefu | ✅ **页面已实现**（`POST /ai/parse` 规则解析版；**LLM 与企微链路未接**） |
| aiConfirm | pages/buyer/ai-confirm | ✅ **页面已实现**（同上） |
| todo | subpkg-supplier/pages/home | ✅ 已实现 |
| goodsSubmit | subpkg-supplier/pages/goods-manage | ✅ 已实现 |
| stockList | subpkg-supplier/pages/stock-list | ✅ 已实现 |
| declare | subpkg-supplier/pages/stock-declare | ✅ 已实现 |
| handover | subpkg-supplier/pages/handover | ✅ 已实现 |
| payable | subpkg-supplier/pages/finance | ✅ 已实现 |
| profile（供应商） | subpkg-supplier/pages/mine | ✅ 已实现 |
| tasks | subpkg-courier/pages/home | ✅ 已实现 |
| route | subpkg-courier/pages/task-detail | ✅ 已实现 |
| deliver | subpkg-courier/pages/deliver | ✅ 已实现 |
| payAssist | subpkg-courier/pages/pay-assist | ✅ 已实现 |
| report | subpkg-courier/pages/report | ✅ 已实现 |
| profile（配送员） | subpkg-courier/pages/mine | ✅ 已实现 |

**非原型页（3 条，单列）**：`pages/login/index`（登录页，原型无）· `pages/buyer/aftersale-list`（售后列表）· `subpkg-courier/pages/cod-pay`（COD 收款）。

**运营后台 14 个原型页**：独立 Web 工程 `admin-web/`（已实现，见 `admin-web/README.md`）。

**转换套路**（照两个示范页）：
- HTML 区块 → `template` 里的 `view`/`text`，类名直接沿用（样式已在 common.scss）
- `onclick` → `@tap`；原型 toast 提示文案 → 真实业务逻辑
- 演示数据 → 替换为 `api/modules.js` 对应接口返回
- 原型里黄色 notice 提示条是**权限边界说明**，保留在页面里

---

## 四、业务红线（写代码时不可违背）

1. **供应商端任何接口不得返回销售价/毛利**（后端行级隔离，前端字段直接不出现）
2. **配送员端不出现金额编辑类功能**；收款协助只读
3. **数量模型：五数量目前跑通「四数量」+ 分拣字段预留**——`qty_ordered` / `qty_declared` / `qty_accepted`（= 申报量）/ 接受 已跑通；分拣 `qty_sorted` **全仓零引用，业务未启用**（**这不是遗漏，是预留**）。2026-09-11 已拍板按「文档降级」处理，**不排期补分拣环节**（影响对账基数）
4. **服务费/加价改动全量审计日志**；结算单费率取生成时点快照，不追溯
5. **库存快速调整免审核即时生效**；其余商品信息变更必须走审核（版本生效制）

---

## 五、开发顺序建议

按《开发配套》第四节的 6 周顺序：auth+商品域 → 采购方下单流 → 供应商备货+拆单 → 配送员签收 → 结算对账 → 灰度。

> ⚠️ 第 3 周**无「验收称重」环节**：`POST /admin/order/:id/weighing` 接口已从代码移除，`30→40` 走 `POST /supplier-fulfill/handover`（申报量即最终交付量）。
