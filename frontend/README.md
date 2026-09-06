# 绿立方 · uni-app 工程骨架

由《绿立方小程序-全页面原型.html》（37 页）转换而来的小程序端工程骨架。**设计 token、公共样式、页面路由、状态管理、请求层、API 模块已就位**，各页面文件已按原型建好，其中 2 页做了完整转换示范，其余为带转换要点的待办页。

> 业务规则与数据模型见 Obsidian：《绿立方卖菜平台workbuddy版》（主计划）+《开发配套-数据模型与接口草案》。
> 运营后台是独立 Web 工程（Vue3 + Element Plus），不在本仓库内。

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
├── pages.json            # 27 个页面路由（采购方主包 14 + 供应商/配送员分包）+ tabBar
├── manifest.json         # 小程序配置（appid 待替换）
├── main.js / App.vue     # 入口；App.vue 全局注入两份样式
├── styles/
│   ├── tokens.scss       # ★ 设计 token：配色/字号/圆角/间距/阴影变量
│   └── common.scss       # ★ 公共组件样式：card/notice/tag/chip/pbtn/list-item…
├── store/user.js         # Pinia：多身份登录态与角色切换（switchRole 重签 token + reLaunch）
├── api/
│   ├── request.js        # 统一请求：token + X-Role 头、错误 toast、401 处理
│   └── modules.js        # API 模块索引，与《开发配套》接口契约一一对应
├── pages/buyer/          # 采购方 11 页（含 kefu AI 对话 / ai-confirm 可编辑确认单）
├── subpkg-supplier/      # 供应商 7 页（分包，按需加载）
└── subpkg-courier/       # 配送员 6 页（分包）
```

---

## 三、原型 → 工程对照表（开发时逐页照抄原型即可）

| 原型 data-page | 工程页面 | 状态 |
|---|---|---|
| home | pages/buyer/home | ✅ **完整示范**（问候/搜索/九宫格/进行中订单） |
| goodsSubmit | subpkg-supplier/pages/goods-manage | ✅ **完整示范**（搜索筛选/新品提交/变更编辑/⚡免审改库存弹层） |
| goods / goodsDetail / cart / orderList / orderDetail / bill / aftersale / mine | pages/buyer/* | 🚧 骨架，头部注释有转换要点 |
| kefu / aiConfirm | pages/buyer/* | 🚧 骨架（阶段 2 功能，可最后做） |
| supplierHome / stockList / stockDeclare / handover / finance / supplierMine | subpkg-supplier/pages/* | 🚧 骨架 |
| courierHome / taskDetail / deliver / payAssist / report / courierMine | subpkg-courier/pages/* | 🚧 骨架 |
| 运营后台 13 页 | 独立 Web 工程（Vue3 + Element Plus） | 未开始 |

**转换套路**（照两个示范页）：
- HTML 区块 → `template` 里的 `view`/`text`，类名直接沿用（样式已在 common.scss）
- `onclick` → `@tap`；原型 toast 提示文案 → 真实业务逻辑
- 演示数据 → 替换为 `api/modules.js` 对应接口返回
- 原型里黄色 notice 提示条是**权限边界说明**，保留在页面里

---

## 四、业务红线（写代码时不可违背）

1. **供应商端任何接口不得返回销售价/毛利**（后端行级隔离，前端字段直接不出现）
2. **配送员端不出现金额编辑类功能**；收款协助只读
3. **订单五数量分别保存互不覆盖**（qty_ordered/declared/accepted/sorted/received）
4. **服务费/加价改动全量审计日志**；结算单费率取生成时点快照，不追溯
5. **库存快速调整免审核即时生效**；其余商品信息变更必须走审核（版本生效制）

---

## 五、开发顺序建议

按《开发配套》第四节的 6 周顺序：auth+商品域 → 采购方下单流 → 供应商申报+拆单验收 → 配送员签收 → 结算对账 → 灰度。每完成一页，把对照表「状态」更新为 ✅。
