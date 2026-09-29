/**
 * API 模块索引 —— 与《开发配套-数据模型与接口草案.md》第三节一一对应
 * 各模块按需拆分到独立文件，此处给出核心接口签名
 */
import { get, post, put, del } from './request'

/* ── auth ── */
export const authApi = {
  login: (code) => post('/auth/wx-login', { code }),        // wx.login 换 token + roles
  switchRole: (role) => post('/auth/switch-role', { role }), // 多身份切换重签
  getProfile: () => get('/auth/profile'),
}

/* ── 供应商 / 配送员注册（采购方注册见 buyerApi.register）── */
export const registerApi = {
  supplier: (data) => post('/register/supplier', data),
  courier: (data) => post('/register/courier', data),
}

/* ── 审核状态查询（三角色返回结构一致：accountStatus/submittedAt/overdue/steps/rejectInfo；值含义见 utils/audit-sync.js）── */
export const auditApi = {
  purchaser: () => get('/buyer/pending'),
  supplier: () => get('/supplier/pending'),
  courier: () => get('/courier/pending'),
}

/* ── 采购方端 ── */
export const buyerApi = {
  // 注册与审核（详见主计划 4.1）
  register: (data) => post('/buyer/register', data),            // 注册提交（→ pending）
  getPending: () => get('/buyer/pending'),                       // 待审核状态查询
  submitAppeal: (data) => post('/buyer/appeal', data),          // 提交申诉
  urgeVerify: () => post('/buyer/urge-verify'),                 // 催办

  // 业务
  getCategories: () => get('/product/categories'),
  getGoods: (params) => get('/product/list', params),      // 仅返回销售价
  getGoodsDetail: (id) => get(`/product/${id}`),
  addToCart: (data) => post('/cart', data),
  getCart: () => get('/cart'),
  updateCart: (id, qty) => put(`/cart/${id}`, { qty }),
  removeCart: (id) => del(`/cart/${id}`),
  placeOrder: (data) => post('/order', data),
  getOrderList: (params) => get('/order', params),
  getOrderDetail: (id) => get(`/order/${id}`),
  // 卡S1：按**支付单号**直达订单详情 —— 微信「小程序购物订单」/发货通知跳转带的是
  // 下单接口的 out_trade_no（= payment_record.payNo，32 位随机串），**不是订单 id**
  getOrderByPayNo: (payNo) => get(`/order/by-pay-no/${payNo}`),
  cancelOrder: (id) => post(`/order/${id}/cancel`),
  receiveOrder: (id, data) => post(`/order/${id}/receive`, data), // 逐项接受/拒收
  updateOrder: (id, data) => post(`/order/${id}/update`, data),   // 编辑待确认订单（覆盖式）
  payOrder: (id, payMethod) => post(`/order/${id}/pay`, { payMethod }), // 2 货到付款（1 微信支付走 wechatPrepay，模拟通道不再从前端调用）
  wechatPrepay: (orderId) => post('/payment/wechat/prepay', { orderId }), // 真实微信支付下单（卡R1）：返回 uni.requestPayment 参数
  requestRefund: (orderId) => post('/payment/wechat/refund', { orderId }), // 真退款（卡R1）：后台运营用，小程序端不调用
  mockPay: (payNo) => post('/payment/mock/pay', { payNo }), // 模拟支付通道（WX_MOCK_PAY=1 才注册；保留但不调用——卡R1 起前端改走 wechatPrepay）
  // 货到付款「我已付款」声明（2026-09-19 卡L）：⚠️ 只登记「客户称已付」，不是核销
  claimPaid: (id) => post(`/buyer/order/${id}/claim-paid`),
  setUrgent: (id, urgent) => post(`/order/${id}/urgent`, { urgent }), // 加急 1 / 取消加急 0
  // AI 客服下单解析
  // ctx 可选（2026-09-24 多轮上下文）：{ draft:[{productId,qty,unit,name}], draftDeliveryDate, draftRemark }
  // 传了 draft = 这句话作用在当前草稿上，返回合并后的完整 items；不传 = 老单句口径（行为不变）
  aiParse: (text, ctx) => post('/ai/parse', ctx ? { text, ...ctx } : { text }),
  // 对账单/售后
  getBill: (period) => get(`/buyer/bill/${period}`),
  submitAftersale: (data) => post('/buyer/aftersale', data),
  getAftersaleList: () => get('/buyer/aftersale'), // 我的售后工单（含处理状态）

  // 自助改资料（2026-09-11 任务卡 A：只改自己，资质字段不可改）
  getProfile: () => get('/buyer/profile'),
  updateProfile: (data) => put('/buyer/profile', data),
  // 审核催办（返回 { urged, nextFollowHours }）
  urgeVerify: () => post('/buyer/urge-verify'),
  // 首页内容一次取全（横幅/公告/今日推荐位，2026-09-11 首页接口化卡）
  getHomeContent: () => get('/buyer/home-content'),
}

/* ── 采购需求（客户要了、我们还没有的货）2026-09-25 ──
 * ⚠️ 与「下单后供应商缺货」（order_item.qty_accepted）是**两条独立的线**，别混用。
 * ⚠️ 上报走这里的 report 接口，**不在 /ai/parse 里写库**——/ai/parse 必须保持只读
 *    （所有生产只读探针都依赖这条）。
 */
export const demandApi = {
  // 授权配置：configured=false（运营还没配模板）时「到货通知我」按钮**不显示**
  subscribeConfig: () => get('/buyer/demand/subscribe-config'),
  // 上报没认出来的菜名（幂等；调用方必须 catch 后静默，绝不影响下单）
  report: (items, source = 1) => post('/buyer/demand/report', { items, source }),
  // 上报 wx.requestSubscribeMessage 的结果 → 落授权额度（服务端只能靠它知道能不能发）
  subscribe: (data) => post('/buyer/demand/subscribe', data),
  // 我的需求（名称/状态/最后时间/是否已通知）
  mine: () => get('/buyer/demand/mine'),
}

/* ── 运营端 ── */
export const adminApi = {
  // 采购方管理（含注册-审核）
  getPendingBuyers: (params) => get('/admin/buyers/pending', params),
  getBuyerVerifyDetail: (id) => get(`/admin/buyers/${id}/verify-detail`),
  submitVerification: (id, data) => post(`/admin/buyers/${id}/verify`, data), // 提交线下核实记录（含通过/驳回）
  reviewAppeal: (id, data) => post(`/admin/buyers/${id}/appeal-review`, data),
  assignAgent: (id, agentId) => post(`/admin/buyers/${id}/assign`, { agentId }),

  // 其他模块（占位）
  getGoodsPending: () => get('/admin/goods/pending'),
  getGoodsChangePending: () => get('/admin/goods/change-pending'),
  getGoodsPriority: (productId) => get(`/admin/goods/${productId}/priority`),
}

/* ── 供应商端（⚠️ 行级隔离：只返回自己的数据） ── */
export const supplierApi = {
  // 商品管理
  getMyGoods: (params) => get('/supplier-goods', params),   // 搜索/状态筛选
  getMyCategories: () => get('/supplier-goods/categories'),  // 我的授权分类（发布商品可选）
  submitGoods: (data) => post('/supplier-goods/apply', data), // 新品提交（审核制）
  applyChange: (productId, data) => post(`/supplier-goods/${productId}/change`, data),
  quickStock: (productId, dailySupply) => put(`/supplier-goods/${productId}/stock`, { dailySupply }), // 免审即时生效
  // 履约
  getStockList: (date) => get('/supplier-fulfill/stock-list', { date }),
  declareStock: (orderId, items) => post('/supplier-fulfill/declare', { orderId, items }), // 少交必填原因
  handover: (orderId) => post('/supplier-fulfill/handover', { orderId }), // 备货完成确认
  // 结算（含服务费扣除行）
  getSettlement: (period) => get(`/supplier-finance/settlement/${period}`),
  // 店铺资料自助（2026-09-11 深夜卡：只改自己，资质/状态不可改）
  getProfile: () => get('/supplier/profile'),
  updateProfile: (data) => put('/supplier/profile', data),
}

/* ── 配送员端 ── */
export const courierApi = {
  getTodayTasks: () => get('/courier/today-tasks'),
  getTaskAmount: (taskId) => get(`/courier/task/${taskId}/amount`), // 任务订单总金额（交付核对）
  pickupScan: (taskId) => post(`/courier/task/${taskId}/pickup`),
  pickupOrder: (orderId) => post(`/courier/order/${orderId}/pickup`), // 订单级取货
  deliverConfirm: (taskId, data) => post(`/courier/task/${taskId}/deliver`, data), // 拍照+签名
  report: (data) => post('/courier/report', data),
  markPaid: (orderId) => post(`/courier/order/${orderId}/mark-paid`), // 仅标记不作核销
  getPayQr: () => get('/courier/pay-qr'), // 收款二维码（货到付款）
  submitPayProof: (orderId, photos) => post(`/courier/order/${orderId}/pay-proof`, { photos }), // 上传付款凭证
  uploadImage: (base64) => post('/upload/image', { base64 }), // 通用图片上传（交付照片/付款凭证）
  // 接单状态
  getStatus: () => get('/courier/status'),
  setOnline: (online) => post('/courier/online', { online }),
  setAutoAccept: (autoAccept) => post('/courier/auto-accept', { autoAccept }),
  depart: () => post('/courier/depart'), // 出发（进入配送中，无法接新单）
}
