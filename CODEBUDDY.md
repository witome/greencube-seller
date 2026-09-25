# CODEBUDDY.md · 绿立方开发

> 本文件会自动注入到**每一次**新会话。只放**稳定规则**——会变的东西（进度、当日改动、待办）写到 `.workbuddy/memory/` 的日志里，不要往这里塞。

## 项目

绿立方：B2B 生鲜配送平台（菜市场供应商 → 餐馆 / 饭店 / 食堂）。
四角色：**采购方、供应商、配送员、运营后台**。
形态：微信小程序（uni-app，含 supplier / courier 分包）+ Web 运营后台 + NestJS 后端。

### 📐 口径（稳定事实，勿再制造第二套数字）

- **一键验收基线 = 187 通过 / 0 失败**（唯一权威数字，见下文「启动与验收」；2026-09-19 实测，已由 Hermes 独立复跑）
- **页面数口径**：只统计「**原型对应页**」，非原型新增页与准入中间页单列
  - 小程序路由 **30** = 原型对应 **27**（采购方 14 + 供应商 7 + 配送员 6）+ 非原型 **3**（登录页、采购方售后列表、配送员 COD 收款）
  - 运营后台页面文件 **17** = 登录页 1 + 工作台 1 + 业务页 15（另 `Placeholder.vue` 为占位组件、非页面）；其中原型对应 14 页
  - 原型合计 **41** 页；**`views/buyers/BuyerVerify.vue` 不存在**（审核详情是 `BuyerList.vue` 内弹窗）
- **后端模块 22 个目录**（旧文档常写「15 个模块」，已过时）
- **拆单时机**：下单事务内即自动拆单（明细分配供应商），订单状态仍 `10`；**无 `20 已拆单` 态**
- **无「验收称重」环节**：`30→40` 走 `POST /supplier-fulfill/handover`，`weighing` 接口已从代码移除
- **AI 客服 2 页**：页面已实现，**LLM 与企微链路未接**（勿写「已完成」）
- **供货优先级**：前后端都已有（`PUT /admin/goods/:productId/priority` + `GoodsAudit.vue` 弹窗），**不是待办**
- **数量模型**：五数量目前跑通 **四数量**（订购 / 申报 / 验收 / 接受）+ **分拣字段预留**（`qty_sorted`，全仓零引用，业务未启用）。**这不是遗漏，是预留**——2026-09-11 已拍板按「文档降级」处理，**不排期补分拣环节**（会影响对账基数，大辉已决定不做），以后别再当缺陷报
- **微信凭证（2026-09-19 状态已翻篇）**：`WX_APPID` / `WX_SECRET` 是**真实可用凭证**，`WX_MOCK_LOGIN=0`（生产已在用真实登录）。**不要改回占位值、也不要改回 `1`**（详见下文「环境红线」）
- **`POST /api/v1/ai/parse` 必须保持「只读」**（2026-09-25 定）：它只 `findMany` 商品、**不写任何库**。
  所有**生产只读探针**（巡检脚本、冒烟、Hermes 复核）都依赖这条前提；一旦在里面插写库，
  只读探针就开始偷偷改生产数据。要落库的副作用（如「采购需求登记」）一律由**前端单独调别的接口**完成。
- **采购需求 ≠ 下单后缺货**：`purchase_demand*` 三张表（+ `demand_subscribe_quota`）是
  「客户还没下单、我们压根没有这个菜」；`order_item.qty_accepted` 是「已下单、到货不够」。
  **两条独立的线**：不共用表、不共用页面、不互相回写。

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

> ⚠️ **端口别记混**：`5180` = 小程序 H5（`frontend`），`5190` = 运营后台（`admin-web`）。
> 且 admin-web 的 Vite 只绑 `[::1]`（IPv6）——浏览器/脚本必须用 `localhost:5190`，用 `127.0.0.1:5190` 会连不上。

### 🔁 改完后端**必须**重启（规范动作）

> **后端实例不会自己加载新代码。改完 `backend/src/**` 一定要重启，否则页面表现还是旧逻辑——"改了不生效"十有八九是这里。**

三种方式，按场景选一个：

| 方式 | 命令 | 特点 |
|---|---|---|
| **① 推荐 · Git Bash** | `bash 重启后端.sh` | 按端口杀旧实例 → `npm run build` 兜底 → 以 `nest start --watch` 后台启动 → 轮询端口确认就绪。**源码改动自动重编译，改完不用再重启** |
| ② 双击 · Windows | `backend/run-backend.bat` | 杀端口 → 构建 → `node dist/main.js` 常驻，进程挂掉自动 3s 拉起。**注意：改了源码要重跑一次才会重新构建** |
| ③ 一键起多服务 | `start-all.bat` | 同时拉起 后端(3001) + 运营后台(5190)，各开一个窗口 |

需要临时实例（不占用 3001）：`PORT=3011 bash 重启后端.sh`。
日志：`%TEMP%\lvlifang-backend-3001.log`。

**验证真的生效了**（重启后必做一次）：

```bash
cd backend && node -e "fetch('http://127.0.0.1:3001/api/v1/auth/wx-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'admin'})}).then(r=>r.json()).then(d=>console.log(d.code===0?'后端在线':'异常'))"
```

⚠️ 只重启后端**不用**重启前端：H5 / 运营后台是 Vite dev server，自带 HMR，改完即生效。
⚠️ 小程序端要单独重编译：`cd frontend && npm run build:mp-weixin`，再在开发者工具里「编译」加载新包。

- 数据库：MySQL84（`net start MySQL84`）
- 一键验收：`cd backend && node 验收测试.js`（预期 **187 通过 / 0 失败**；历史 25/25、30/30、77/0 均已过时，**不要再引用旧值**）
- 登录：`POST /api/v1/auth/wx-login`，body `{"code":"xxx"}`；dev mock 下 code 直接映射 openid
- 演示账号：运营 `admin`｜供应商 `demo_supplier`｜配送员 `courier`｜采购方任意 code（新号走注册+审核）
- 真机调试：微信开发者工具，本机 IP `192.168.1.78`；AppID 已配在 `frontend/src/manifest.json`（密钥问大辉）

## 🧪 小程序自测通道（微信开发者工具 Skills，2026-09-23 已实测跑通）

小程序端不该只靠人点：开发者工具里已内置官方 `wechatide` CLI，Agent 能编译、开项目窗口、点元素、截模拟器画面、读 console/network、断言当前路由。**这是「验收要双重证据」里"真实操作"那一条在小程序端的落地手段。**

- **自测必须用自测包，不许碰出货目录**（2026-09-23 定，起因：自测构建把 9/21 那份连生产的出货包覆盖成了连局域网版）：
  - 自测包 = `cd frontend && npm run build:self:mp` → 产物在 **`frontend/dist/self/mp-weixin`**（连本机后端 `192.168.1.78:3001`，**不碰** `dist/build`）
  - 出货包 = `npm run build:prod:mp` → 产物在 `dist/build/mp-weixin`（连生产域名，构建后**自动校验**：域名对不对、有没有混进局域网地址、调试浮窗删没删干净、appid 对不对）
  - 🚫 **禁止裸跑 `npm run build:mp-weixin`**：已被 `prebuild:mp-weixin` 钩子拦住（不带接口地址直接报错退出）。为什么不用它：uni CLI 在 vite 加载前就会**清空输出目录**，裸跑一次哪怕报错，出货包也已经没了。
  - 🚫 **禁止拿 `dist/build/mp-weixin` 做自测**，也禁止拿 `dist/self/mp-weixin` 上传微信
- **项目根是编译产物**：自测用 `frontend/dist/self/mp-weixin`，**不是 `src/`**；改完前端先 `npm run build:self:mp` 再刷新模拟器。
- **命令一律走 PowerShell 包装**（本机实测：git-bash 直接调 `wechatide.cmd`，含空格/括号的参数会被拆坏，报 `'C:\Program' 不是内部或外部命令`）：
  > ⚠️ 下面这组是 **Hermes / 人用 bash** 的写法。**WorkBuddy 的沙箱禁止从 Bash 里调 PowerShell**（会被安全策略拦），它应改用**自己的 PowerShell 工具**执行同样命令 —— 详见本节末尾「实测补充」。

```bash
PS="C:\Program Files (x86)\Tencent\微信web开发者工具\wechatide.cmd"
P="C:/Users/Administrator/Documents/绿立方开发/frontend/dist/self/mp-weixin"
powershell -NoProfile -Command "& '$PS' -c WorkBuddy open_project_window --project '$P'"
powershell -NoProfile -Command "& '$PS' -c WorkBuddy simulator_open_page --project '$P' --page pages/login/index"
powershell -NoProfile -Command "& '$PS' -c WorkBuddy simulator_screenshot --project '$P' --path 'C:/Users/Administrator/AppData/Local/Temp/shot.jpg'"
powershell -NoProfile -Command "& '$PS' -c WorkBuddy automation_evaluate --project '$P' --fn-source 'function(){return getCurrentPages().map(function(p){return p.route})}'"
powershell -NoProfile -Command "& '$PS' -c WorkBuddy automation_element_action --project '$P' --action tap --selector '.reg-link' --wait-for-selector '.reg-link'"
powershell -NoProfile -Command "& '$PS' -c WorkBuddy get_simulator_console --project '$P' --command 'grep -n .'"
```

- **前提**：开发者工具已启动且已登录（`check_wechatide_status` 要返回 `openid` 且 `versionRelation: equal`）；**每个 clientName 首次连接会弹一次授权框**，需大辉点确认。
- **截图要看到才算数**：`simulator_open_page` 之后立刻截图可能拍到空白帧，等 2~3 秒或用 `--wait-for-selector` 再拍。
- **后端没起来时，登录/注册按钮点了不会跳转**（它先调 `/auth/wx-login`）——先确认 `http://127.0.0.1:3001` 在线，再判是不是页面 bug。
- `upload` = 发布体验版，属发布动作，**不许自动点**；云开发工具（`cloud_*`）本项目用不到，忽略。
- 全部 45 个工具的完整参数：`C:\Program Files (x86)\Tencent\微信web开发者工具\resources\app.asar.unpacked\wechatide-skill\wechatide-tools\references\tools.yaml`

### 实测补充（2026-09-23，3 页自测跑通后记下）

- **门禁要带版本号**：`check_wechatide_status` 不加 `--skill-version` 会返回 `versionRelation: skip_check` + 警告；带上当前 skill 版本（`0.3.9`，见 `wechatide-skill/SKILL.md` frontmatter）才返回 `equal`。已登录态下 `open_project_window` 通常直接 `success: true, type: "reuse"`，**不弹授权框**。
- **必须用 PowerShell 工具执行**，不要在 Bash 里写 `powershell -NoProfile -Command "..."` —— 本机安全策略会直接拦掉这条 Bash 命令（`Invoking PowerShell from Bash bypasses PowerShell security checks`）。
- **PowerShell 工具 stdout 不回显**：每条命令末尾接 `*>&1 | Out-File "$env:TEMP\xxx.txt" -Encoding utf8`，再用 Read 读文件。`wechatide.cmd` 会把进度写 stderr（表现为 `NativeCommandError` 噪声），**别被吓到**，看 JSON 的 `ok` 字段为准。
- ⚠️ **`automation_evaluate --fn-source` 里不能出现双引号**：外层 shell 会把 `"token"` 的引号吃掉 → 运行时报 `Uncaught token is not defined`。改成不含引号的写法，例如用 `wx.getStorageInfoSync().keys` 取存储键列表，而不是 `wx.getStorageSync("token")`。
- 截图要用 `--wait 2`（或 `--wait-for-selector`）再拍，否则可能拍到空白帧。
- 首次跑通记录（3 页：登录 / 采购方首页 / 商品列表）与踩坑详见 `自测证据/小程序自测-对照表.md`（该目录不入库，只留在磁盘）。

## 八条已拍板决策（不得推翻）

1. **下单即自动拆单**——下单落 `status=10`，事务内按供货优先级写 `order_item.supplier_id`；运营核单确认/调整，可重新拆单
2. **申报超时自动兜底**——每日 22:00 截止，超时取 `daily_supply`，标 `is_auto_declared=1`（幂等）
3. **拒收从结算剔除 + 生成售后工单**——对账基数恒为 `qty_accepted`
4. **token 内嵌身份，切换重签**——JWT 含 `currentRole`，`/auth/switch-role` 重签、旧 token 失效
5. **业务员 = 运营子账号**——`business_agent`，仅限采购方审核，看不到金额/订单/结算
6. **申诉内容与附件必须入库**（2026-09-19 拍板）——新增申诉表存正文 + 附件；后端**不允许**「只改状态、把申诉内容丢掉」
7. **售后申请 / 配送员上报支持拍照留证**（2026-09-19 拍板）——这两处加照片字段，前端接真实上传（`uni.chooseImage`），**不许留「点了没反应」的假按钮**
8. **货到付款（COD）送达后的付款口径**（2026-09-19 拍板）——采购方订单送达后要能看到两个付款按钮（**扫码付款**＝引导用微信「扫一扫」扫配送员出示的收款码；**微信直接支付**＝商户号到位前只弹「即将开通」，**绝不许接模拟支付**），外加一个「**我已付款**」按钮（落库，供配送员看到「客户称已付」）。**核销口径不变：仍以 `order.payProof`（配送员拍照凭证）为准**；「客户称已付」只是标记，两个状态必须分开显示。**运营后台要把「客户称已付但未核销」的订单标出来并支持筛选**（按日期翻，用于当天对账不成功时逐个核对）

另：服务费（对供应商抽成）与加价比例（销售毛利）是**两套独立机制**；数量模型＝**四数量（订购 / 申报 / 验收 / 接受）已跑通 + 分拣字段预留**（`qty_sorted` 未启用），分别保存、互不覆盖。

## 三条权限铁律（写代码不能违反）

1. **配送员不碰钱**——courier 模块不返回任何金额字段；唯一例外 `GET /courier/task/:id/amount`（仅 COD 订单展示应收数字供核对，不碰资金流）
2. **供应商不见销售价**——product 模块对 supplier 角色不返回 `salePrice`
3. **运营看得全、改得慎**——金额相关操作二次确认 + 全量写 `audit_log`

## 🔒 环境红线 · 微信凭证（⚠️ 2026-09-19 已更新，旧版「占位值」说法作废）

- **已切真实微信登录**：`WX_APPID` / `WX_SECRET` 是**真实可用凭证**（生产服务器已生效），`WX_MOCK_LOGIN=0`。
- ⚠️ **不要改回占位值，也不要把 `WX_MOCK_LOGIN` 改回 `1`**——生产已在用真实登录。
- ⚠️ **`WX_MOCK_PAY` 生产当前仍为 `1`**（测试期，大辉 2026-09-19 同意）；**正式上线前必须关掉**（已记入《上线部署方案》上线前清单第 10 项）。
- 生产：`api.hsfresh.com`（小程序接口）/ `admin.hsfresh.com`（运营后台）。**密钥只存服务器 `.env`，绝不写进文档、对话或仓库。**

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
7. **改了后端不重启 = 改了不生效** —— 后端是长驻进程，`backend/src/**` 的改动不会自动加载。
   表现极具迷惑性：接口返回正常、页面不报错，但字段/逻辑就是旧的，容易误判成"前端没写对"或"数据没落库"。
   一律走 `bash 重启后端.sh`（见上文「改完后端必须重启」）。
8. **小程序端改了 H5 只算改一半** —— `dev:h5` 的 HMR 不影响小程序包；真机/开发者工具看到的是
   `frontend/dist/build/mp-weixin`，必须 `npm run build:mp-weixin` 重编译，再在开发者工具里「编译」。
   外部命令改动了 dist 后，开发者工具要手动「编译」或重开项目才会加载新代码；真机需重新扫码。
9. **列表页 `loading` 必须用 try/catch/finally 兜底** —— 请求一旦抛错而 `loading` 没复位，
   页面会**永久停在「加载中」，网络恢复也不自愈**（2026-09-11 商品列表实测复现过：
   后端重启窗口内点进页面就中招）。规范写法：
   ```js
   loading.value = true
   try { /* 请求 + 赋值 */ }
   catch (e) { loadError.value = '加载失败，请检查网络后重试' }   // 给出可见反馈
   finally { loading.value = false }                             // ⭐ 必须复位
   ```
   另外：**列表页要在 `onShow` 里补一次**（`if (loadError.value && !loading.value) load()`），
   否则用户切走再切回来仍是失败态。只靠 `onMounted` 的页面最容易踩。
10. **raw SQL 写日期列必须用 `UTC_TIMESTAMP(3)`，不是 `NOW(3)`**（2026-09-25 实测踩到）——
   本机 MySQL 会话时区是 `SYSTEM`（+08），`NOW(3)` 给的是**本地时间**，
   而 **Prisma 读写 `datetime(3)` 一律按 UTC 解释** → 用 `NOW(3)` 写进去的值被当 UTC 读，**整列偏 8 小时**。
   表现极具迷惑性：把一条明细回拨成「49 小时前」，读回来却是「41 小时前」，48 小时窗口判定就假红。
   自检：`SELECT @@session.time_zone, NOW(3), UTC_TIMESTAMP(3);`
   （Prisma 常规 `create/update` 走客户端 `@updatedAt`，不受影响；**只有 raw SQL 要注意**。
   仓里 `service_fee_config` 的写入还留着 `NOW(3)`，只影响展示列、业务不依赖 —— 别顺手改，要改先报。）
11. **要给浏览器真下载文件的接口，用 `@Res()` 直接写响应**（2026-09-25）——
   全局 `ResponseInterceptor` 会把任何非 `{code}` 返回值包成 `{ code, msg, data }`，
   所以返回 CSV 字符串到前端只会下到一个 JSON。Nest 源码里
   `!isResponseHandled && apply(...)`：标了 `@Res()`（未开 passthrough）就不会二次发送，安全。
   ⚠️ 前端拿它时**必须 `res.arrayBuffer()`，不能用 `res.text()`** ——
   `text()` 按规范会**吃掉 BOM**，再拿去 `new Blob()` 下载，导出的 CSV 就丢 BOM → Excel 中文乱码。

## 进度在哪看

- 当天的改动与决策 → `.workbuddy/memory/YYYY-MM-DD.md`（append-only）
- 项目长期约定 → `.workbuddy/memory/MEMORY.md`
- 阶段交接 → `任务单/` 下最新的一份
- 工程结构说明 → `README.md`
