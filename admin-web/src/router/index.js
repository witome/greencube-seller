import { createRouter, createWebHistory } from 'vue-router'
import AdminLayout from '../layout/AdminLayout.vue'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { title: '登录' } },
  {
    path: '/',
    component: AdminLayout,
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue'), meta: { title: '工作台' } },
      { path: 'buyers', name: 'buyers', component: () => import('../views/buyers/BuyerList.vue'), meta: { title: '采购方管理' } },
      { path: 'goods', name: 'goods', component: () => import('../views/goods/GoodsAudit.vue'), meta: { title: '商品审核' } },
      { path: 'goods-manage', name: 'goods-manage', component: () => import('../views/goods/GoodsManage.vue'), meta: { title: '商品管理' } },
      { path: 'categories', name: 'categories', component: () => import('../views/goods/Categories.vue'), meta: { title: '分类管理' } },
      { path: 'suppliers', name: 'suppliers', component: () => import('../views/dispatch/Suppliers.vue'), meta: { title: '供应商管理' } },
      { path: 'couriers', name: 'couriers', component: () => import('../views/dispatch/Couriers.vue'), meta: { title: '配送员管理' } },
      { path: 'order', name: 'order', component: () => import('../views/order/OrderFulfill.vue'), meta: { title: '订单履约' } },
      { path: 'dispatch', name: 'dispatch', component: () => import('../views/dispatch/Dispatch.vue'), meta: { title: '派送调度' } },
      { path: 'finance', name: 'finance', component: () => import('../views/finance/Finance.vue'), meta: { title: '资金结算' } },
      { path: 'audit', name: 'audit', component: () => import('../views/audit/AuditLog.vue'), meta: { title: '审计日志' } },
      { path: 'pricing', name: 'pricing', component: () => import('../views/pricing/Pricing.vue'), meta: { title: '价格与加价' } },
      { path: 'reports', name: 'reports', component: () => import('../views/reports/Reports.vue'), meta: { title: '报表' } },
      { path: 'settings', name: 'settings', component: () => import('../views/settings/Settings.vue'), meta: { title: '系统设置' } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫：未登录跳登录页
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('admin_token')
  if (to.path !== '/login' && !token) {
    next('/login')
  } else {
    next()
  }
})

export default router
