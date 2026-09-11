import request from './request'

/* ── 登录 ── */
export const authApi = {
  login: (code) => request.post('/auth/wx-login', { code }),
}

/* ── 采购方审核 ── */
export const buyerAdminApi = {
  getPendingBuyers: (params) => request.get('/admin/buyers/pending', { params }),
  getBuyerVerifyDetail: (id) => request.get(`/admin/buyers/${id}/verify-detail`),
  submitVerification: (id, data) => request.post(`/admin/buyers/${id}/verify`, data),
  reviewAppeal: (id, data) => request.post(`/admin/buyers/${id}/appeal-review`, data),
  updateBuyer: (id, data) => request.put(`/admin/buyers/${id}`, data),
}

/* ── 商品审核 ── */
export const goodsAdminApi = {
  getGoodsPending: () => request.get('/admin/goods/pending'),
  getGoodsChangePending: () => request.get('/admin/goods/change-pending'),
  reviewGoodsApply: (applyId, data) => request.post(`/admin/goods/pending/${applyId}/review`, data),
  reviewGoodsChange: (changeId, data) => request.post(`/admin/goods/change/${changeId}/review`, data),
  getPriority: (productId) => request.get(`/admin/goods/${productId}/priority`),
  setPriority: (productId, items) => request.put(`/admin/goods/${productId}/priority`, { items }),
  // 商品管理（在售/下架商品列表 + 上下架 + 新增 + 编辑）
  listProducts: (params) => request.get('/admin/goods/list', { params }),
  updateProductStatus: (id, status) => request.put(`/admin/goods/${id}/status`, { status }),
  createProduct: (data) => request.post('/admin/goods', data),
  updateProduct: (id, data) => request.put(`/admin/goods/${id}`, data),
}

/* ── 供应商/配送员管理 ── */
export const userAdminApi = {
  getSuppliers: () => request.get('/admin/suppliers'),
  getCouriers: () => request.get('/admin/couriers'),
  updateSupplierStatus: (id, status) => request.put(`/admin/suppliers/${id}/status`, { status }),
  updateCourierStatus: (id, status) => request.put(`/admin/couriers/${id}/status`, { status }),
  updateSupplier: (id, data) => request.put(`/admin/suppliers/${id}`, data),
  updateCourier: (id, data) => request.put(`/admin/couriers/${id}`, data),
}

/* ── 订单履约 / 派送 ── */
export const orderAdminApi = {
  getPendingList: () => request.get('/admin/order/pending'),
  getSplitPreview: (id) => request.get(`/admin/order/${id}/split-preview`),
  split: (id, data) => request.post(`/admin/order/${id}/split`, data),
  autoSplit: (id) => request.post(`/admin/order/${id}/auto-split`),
  autoSplitAll: () => request.post('/admin/order/auto-split-all'),
  reSplitShortage: (id) => request.post(`/admin/order/${id}/re-split-shortage`),
  weighing: (id, data) => request.post(`/admin/order/${id}/weighing`, data),
}

export const dispatchAdminApi = {
  getDispatchList: () => request.get('/admin/dispatch'),
  getCouriers: () => request.get('/admin/dispatch/couriers'),
  assign: (data) => request.post('/admin/dispatch', data),
  autoAssign: () => request.post('/admin/dispatch/auto-assign'),
  updateCourierSettings: (id, data) => request.put(`/admin/dispatch/couriers/${id}/settings`, data),
  getExceptions: (params) => request.get('/admin/dispatch/exceptions', { params }),
  handleException: (id) => request.put(`/admin/dispatch/exceptions/${id}`),
}

/* ── 财务 ── */
export const financeAdminApi = {
  getSettlements: (params) => request.get('/admin/finance/settlements', { params }),
  getServiceFeeConfigs: () => request.get('/admin/finance/service-fee'),
  previewServiceFee: (params) => request.get('/admin/finance/service-fee/preview', { params }),
  updateServiceFee: (data) => request.put('/admin/finance/service-fee', data),
  generateSettlement: (data) => request.post('/admin/finance/generate', data),
  getDeliveryFee: () => request.get('/admin/finance/delivery-fee'),
  updateDeliveryFee: (data) => request.put('/admin/finance/delivery-fee', data),
  getPayQr: () => request.get('/admin/finance/pay-qr'),
  updatePayQr: (data) => request.put('/admin/finance/pay-qr', data),
  uploadImage: (base64) => request.post('/upload/image', { base64 }),
}

/* ── 支付流水（2026-09-11 新增：只读，仅线上支付） ── */
export const paymentAdminApi = {
  getList: (params) => request.get('/admin/payments', { params }),
}

/* ── 价格与加价 ── */
export const pricingAdminApi = {
  getList: () => request.get('/admin/pricing'),
  update: (id, data) => request.put(`/admin/pricing/${id}`, data),
  batchMarkup: (data) => request.put('/admin/pricing/batch', data),
}

/* ── 报表 ── */
export const reportsAdminApi = {
  getOverview: () => request.get('/admin/reports/overview'),
  getCategorySales: (params) => request.get('/admin/reports/category-sales', { params }),
}

/* ── 审计 ── */
export const auditApi = {
  getLogs: (params) => request.get('/audit', { params }),
}

/* ── 分类管理 ── */
export const categoryAdminApi = {
  getCategories: () => request.get('/admin/categories'),
  createCategory: (data) => request.post('/admin/categories', data),
  updateCategory: (id, data) => request.put(`/admin/categories/${id}`, data),
  deleteCategory: (id) => request.delete(`/admin/categories/${id}`),
  getSupplierCategories: (id) => request.get(`/admin/suppliers/${id}/categories`),
  setSupplierCategories: (id, categoryIds) => request.put(`/admin/suppliers/${id}/categories`, { categoryIds }),
}

/* ── 售后管理（2026-09-10 新增，修复单缺陷 3） ── */
export const aftersaleAdminApi = {
  list: (params) => request.get('/admin/aftersale', { params }),
  detail: (id) => request.get(`/admin/aftersale/${id}`),
  handle: (id, data) => request.post(`/admin/aftersale/${id}/handle`, data),
}
