# CODEBUDDY.md · 绿立方开发

> 本文件会自动注入到**每一次**新会话。只放**稳定规则**——会变的东西（进度、当日改动、待办）写到 `.workbuddy/memory/` 的日志里，不要往这里塞。

## 项目

绿立方：B2B 生鲜配送平台（菜市场供应商 → 餐馆 / 饭店 / 食堂）。
四角色：**采购方、供应商、配送员、运营后台**。
形态：微信小程序（uni-app，含 supplier / courier 分包）+ Web 运营后台 + NestJS 后端。

## 路径

| 内容 | 路径 |
|---|---|
| 代码工程（当前会话应在此目录） | `C:\Users\Administrator\Documents\绿立方开发\` |
| 产品/接口文档（**只读**，改动由大辉决定） | `C:\Users\Administrator\Documents\Obsidian Vault\绿立方卖菜平台workbuddy版\` |
| **视觉基准原型（41 页）** | 同上 `\原型\绿立方小程序-全页面原型.html` |
| 接口字段契约（写接口对照这份） | `开发配套-API接口字段契约.md` |

## 启动与验收

| 端 | 命令 | 地址 |
|---|---|---|
| 后端 NestJS | `cd backend && npm run dev` | http://localhost:3001/api/v1 |
| 小程序端 | `cd frontend && npm run dev:h5` / `dev:mp-weixin` | http://localhost:5180 |
| 运营后台 | `cd admin-web && npm run dev` | http://localhost:5190 |

- 数据库：MySQL84（`net start MySQL84`）
- 一键验收：`cd backend && node 验收测试.js`（预期 **30/30**，2026-09-11 已把脚本对齐现行状态机）
- 登录：`POST /api/v1/auth/wx-login`，body `{"code":"xxx"}`；dev mock 下 code 直接映射 openid
- 演示账号：运营 `admin`｜供应商 `demo_supplier`｜配送员 `courier`｜采购方任意 code（新号走注册+审核）
- 真机调试：微信开发者工具，本机 IP `192.168.1.78`；AppID 已配在 `frontend/src/manifest.json`（密钥问大辉）

## 五条已拍板决策（不得推翻）

1. **下单即自动拆单**——下单落 `status=10`，事务内按供货优先级写 `order_item.supplier_id`；运营核单确认/调整，可重新拆单
2. **申报超时自动兜底**——每日 22:00 截止，超时取 `daily_supply`，标 `is_auto_declared=1`（幂等）
3. **拒收从结算剔除 + 生成售后工单**——对账基数恒为 `qty_accepted`
4. **token 内嵌身份，切换重签**——JWT 含 `currentRole`，`/auth/switch-role` 重签、旧 token 失效
5. **业务员 = 运营子账号**——`business_agent`，仅限采购方审核，看不到金额/订单/结算

另：服务费（对供应商抽成）与加价比例（销售毛利）是**两套独立机制**；五数量模型（订购/申报/验收/分拣/接受）分别保存。

## 三条权限铁律（写代码不能违反）

1. **配送员不碰钱**——courier 模块不返回任何金额字段；唯一例外 `GET /courier/task/:id/amount`（仅 COD 订单展示应收数字供核对，不碰资金流）
2. **供应商不见销售价**——product 模块对 supplier 角色不返回 `salePrice`
3. **运营看得全、改得慎**——金额相关操作二次确认 + 全量写 `audit_log`

## 工作纪律

1. **原型是硬基准**。改任何页面前先读原型对应部分，严格照做。**禁止凭记忆自由发挥、禁止改版式、禁止"先随便做以后再对齐"**。原型没有的页面（如运营后台上传下载类），按后台既有视觉规范自行设计。
2. **改动不许溢出**。每动手前先说清"改哪些文件、只影响哪个页面"；做完回报同样格式。不允许改 A 页面把 B 页面带崩。
3. **涉及金额 / 权限 / schema 的岔路：停下来**，写清选项 + 你的建议，等拍板。不要自作主张推翻既有决策。
4. **小事不磨叽**。拿不准的小事按最合理方式做，在报告里记录即可，不要中途反复询问。
5. **验收要双重证据**：自动测试 + 真实浏览器/真机操作，缺一不算完成。接口冒烟不能冒充页面验收。
6. **不直接改 Obsidian**。需要同步时写进报告，由大辉/二黑侧同步。
7. 每一批改动完成后自己跑一遍 + `git commit` 打点（message 写清改了什么），**不要 push**。

## 踩过的坑（同一类错不要犯第二次）

1. **小程序端 GET 传参禁用 `undefined`** —— `uni.request` 会把它序列化成字符串 `"undefined"`，后端当有效值 → 查询为空。一律条件构造 params（只传有值字段）。
2. **小程序端布局用 `100vh`，禁用 `height:100%`** —— 小程序 `page` 默认 `height:auto`，`height:100%` 会塌陷成 0（整片空白），H5 上却不暴露。
3. **改 `JWT_SECRET` 后必须让前端能自动重登**（清旧 token）—— 否则 App 带着失效 token 一直请求，被 2001 拒，表现为"注册不落库""页面空白"这类怪象。
4. **派生金额（运费/合计）必须在所有金额变动入口重算** —— 不能只在改配送日期时算。
5. **页面生命周期 `onShow` 从 `@dcloudio/uni-app` import**，不是从 `vue`。
6. **调试前先确认端口归属** —— 本机 5173/5174 被其他同名前缀项目占用过，别把别人的服务当自己的验证。

## 进度在哪看

- 当天的改动与决策 → `.workbuddy/memory/YYYY-MM-DD.md`（append-only）
- 项目长期约定 → `.workbuddy/memory/MEMORY.md`
- 阶段交接 → `任务单/` 下最新的一份
- 工程结构说明 → `README.md`
