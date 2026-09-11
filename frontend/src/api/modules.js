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
  cancelOrder: (id) => post(`/order/${id}/cancel`),
  receiveOrder: (id, data) => post(`/order/${id}/receive`, data), // 逐项接受/拒收
  updateOrder: (id, data) => post(`/order/${id}/update`, data),   // 编辑待确认订单（覆盖式）
  payOrder: (id, payMethod) => post(`/order/${id}/pay`, { payMethod }), // 1 微信支付（返回支付单）/ 2 货到付款
  mockPay: (payNo) => post('/payment/mock/pay', { payNo }), // 模拟支付通道（WX_MOCK_PAY=1；接商户号后换 wx.requestPayment）
  setUrgent: (id, urgent) => post(`/order/${id}/urgent`, { urgent }), // 加急 1 / 取消加急 0
  aiParse: (text) => post('/ai/parse', { text }),                 // AI 客服下单解析
  // 对账单/售后
  getBill: (period) => get(`/buyer/bill/${period}`),
  submitAftersale: (data) => post('/buyer/aftersale', data),
  getAftersaleList: () => get('/buyer/aftersale'), // 我的售后工单（含处理状态）
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
  getDashboard: () => get('/admin/dashboard'),
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
