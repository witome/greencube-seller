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
}

/* ── 商品审核 ── */
export const goodsAdminApi = {
  getGoodsPending: () => request.get('/admin/goods/pending'),
  getGoodsChangePending: () => request.get('/admin/goods/change-pending'),
  reviewGoodsApply: (applyId, data) => request.post(`/admin/goods/pending/${applyId}/review`, data),
  reviewGoodsChange: (changeId, data) => request.post(`/admin/goods/change/${changeId}/review`, data),
}

/* ── 供应商/配送员管理 ── */
export const userAdminApi = {
  getSuppliers: () => request.get('/admin/suppliers'),
  getCouriers: () => request.get('/admin/couriers'),
}

/* ── 订单履约 / 派送 ── */
export const orderAdminApi = {
  getPendingList: () => request.get('/admin/order/pending'),
  getSplitPreview: (id) => request.get(`/admin/order/${id}/split-preview`),
  split: (id, data) => request.post(`/admin/order/${id}/split`, data),
  weighing: (id, data) => request.post(`/admin/order/${id}/weighing`, data),
}

export const dispatchAdminApi = {
  getDispatchList: () => request.get('/admin/dispatch'),
  getCouriers: () => request.get('/admin/dispatch/couriers'),
  assign: (data) => request.post('/admin/dispatch', data),
  autoAssign: () => request.post('/admin/dispatch/auto-assign'),
  updateCourierSettings: (id, data) => request.put(`/admin/dispatch/couriers/${id}/settings`, data),
}

/* ── 财务 ── */
export const financeAdminApi = {
  getSettlements: (params) => request.get('/admin/finance/settlements', { params }),
  previewServiceFee: (params) => request.get('/admin/finance/service-fee/preview', { params }),
  updateServiceFee: (data) => request.put('/admin/finance/service-fee', data),
  generateSettlement: (data) => request.post('/admin/finance/generate', data),
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
