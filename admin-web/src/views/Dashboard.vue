<template>
  <div class="admin-dashboard-page">
    <!-- 面包屑 -->
    <div class="admin-dashboard-crumb">工作台 / 今日概览 · {{ today }}</div>

    <!-- 待办统计卡（真实接口） -->
    <div class="admin-dashboard-cards">
      <div v-for="c in cards" :key="c.key" class="admin-dashboard-card" @click="go(c.path)">
        <div class="admin-dashboard-card-label">{{ c.label }}</div>
        <div class="admin-dashboard-card-num" :style="{ color: c.color }">{{ formatNum(c.value) }}</div>
      </div>
    </div>

    <!-- 结算提醒（有真实待对账结算单时显示） -->
    <div v-if="settleCount > 0" class="admin-dashboard-alert" @click="go('/finance')">
      <span>💰 有 {{ settleCount }} 笔结算单待对账</span>
      <span class="admin-dashboard-alert-link">前往处理 ›</span>
    </div>

    <!-- 快捷入口 -->
    <div class="admin-dashboard-panel">
      <div class="admin-dashboard-panel-title">⚡ 快捷入口</div>
      <div class="admin-dashboard-quick-grid">
        <div v-for="q in quicks" :key="q.title" class="admin-dashboard-quick-item" @click="q.path ? go(q.path) : todo(q.title)">
          <div class="admin-dashboard-quick-ico">{{ q.icon }}</div>
          <div class="admin-dashboard-quick-title">{{ q.title }}</div>
          <div class="admin-dashboard-quick-desc">{{ q.desc }}</div>
        </div>
      </div>
    </div>

    <!-- 近期业务状态（接报表接口，真实数据） -->
    <div class="admin-dashboard-panel">
      <div class="admin-dashboard-panel-title">📈 近期业务状态</div>
      <div v-if="overviewLoading" class="admin-dashboard-empty">加载中…</div>
      <div v-else-if="overviewError" class="admin-dashboard-empty">经营数据加载失败，请刷新重试</div>
      <div v-else class="admin-dashboard-ov-grid">
        <div class="admin-dashboard-ov-item">
          <div class="admin-dashboard-ov-label">今日订单</div>
          <div class="admin-dashboard-ov-num">{{ overview.todayOrders ?? 0 }}</div>
        </div>
        <div class="admin-dashboard-ov-item">
          <div class="admin-dashboard-ov-label">今日 GMV</div>
          <div class="admin-dashboard-ov-num">¥{{ fmtMoney(overview.todayGmv) }}</div>
        </div>
        <div class="admin-dashboard-ov-item">
          <div class="admin-dashboard-ov-label">本月订单</div>
          <div class="admin-dashboard-ov-num">{{ overview.monthOrders ?? 0 }}</div>
        </div>
        <div class="admin-dashboard-ov-item">
          <div class="admin-dashboard-ov-label">本月 GMV</div>
          <div class="admin-dashboard-ov-num">¥{{ fmtMoney(overview.monthGmv) }}</div>
        </div>
        <div class="admin-dashboard-ov-item">
          <div class="admin-dashboard-ov-label">处理中订单</div>
          <div class="admin-dashboard-ov-num" style="color:#3B7CFF">{{ overview.pendingCount ?? 0 }}</div>
        </div>
        <div class="admin-dashboard-ov-item">
          <div class="admin-dashboard-ov-label">售后待处理</div>
          <div class="admin-dashboard-ov-num" style="color:#E6A23C">{{ overview.aftersalePending ?? 0 }}</div>
        </div>
      </div>
      <!-- 状态分布 -->
      <div v-if="!overviewLoading && !overviewError && overview.statusDist?.length" class="admin-dashboard-ov-status">
        <span v-for="s in overview.statusDist" :key="s.status" class="admin-dashboard-ov-chip">
          {{ s.statusText }} {{ s.count }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  buyerAdminApi,
  goodsAdminApi,
  orderAdminApi,
  dispatchAdminApi,
  financeAdminApi,
  reportsAdminApi,
  userAdminApi,
} from '../api/modules'

const router = useRouter()

const today = new Date().toISOString().slice(0, 10)

// 近期业务状态（报表接口）
const overview = ref({})
const overviewLoading = ref(true)
const overviewError = ref(false)

// 待办统计卡：value 为 null=加载中、-1=失败、数字=成功
const cards = ref([
  { key: 'buyers', label: '采购方待审核', value: null, color: '#E6A23C', path: '/buyers' },
  { key: 'suppliers', label: '供应商待审核', value: null, color: '#FA8C16', path: '/suppliers' },
  { key: 'couriers', label: '配送员待审核', value: null, color: '#722ED1', path: '/couriers' },
  { key: 'goods', label: '商品待审核', value: null, color: '#00B96B', path: '/goods' },
  { key: 'orders', label: '待核订单', value: null, color: '#3B7CFF', path: '/order' },
  { key: 'dispatch', label: '待派送任务', value: null, color: '#13C2C2', path: '/dispatch' },
])
const settleCount = ref(0)

const quicks = [
  { icon: '👥', title: '采购方审核', desc: '注册准入 · 线下核实', path: '/buyers' },
  { icon: '📦', title: '商品审核', desc: '新品 / 变更 · 供货优先级', path: '/goods' },
  { icon: '📋', title: '订单履约', desc: '核单拆单', path: '/order' },
  { icon: '🚚', title: '派送调度', desc: '指派配送员', path: '/dispatch' },
  { icon: '💰', title: '资金结算', desc: '服务费 · 结算单', path: '/finance' },
  { icon: '🔍', title: '审计日志', desc: '操作留痕追溯', path: '/audit' },
  { icon: '🥕', title: '供应商管理', desc: '供应商档案', path: '/suppliers' },
  { icon: '🧑‍✈️', title: '配送员管理', desc: '配送员档案', path: '/couriers' },
  { icon: '🗂️', title: '分类管理', desc: '商品分类维护', path: '/categories' },
  { icon: '🏷️', title: '价格与加价', desc: '分类加价比例', path: '/pricing' },
  { icon: '📈', title: '报表', desc: '经营统计', path: '/reports' },
  { icon: '⚙️', title: '系统设置', desc: '交易规则 · 通知', path: '/settings' },
  { icon: '🛡️', title: '售后工单', desc: '售后处理', todo: '售后工单' },
  { icon: '🚨', title: '异常仲裁', desc: '异常订单处理', todo: '异常仲裁' },
  { icon: '🌇', title: '日结', desc: '每日结算', todo: '日结管理' },
]

function formatNum(v) {
  if (v === null) return '…' // 加载中
  if (v < 0) return '—' // 加载失败
  return v
}

function fmtMoney(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function setCard(key, value) {
  const c = cards.value.find((x) => x.key === key)
  if (c) c.value = value
}

function go(path) {
  router.push(path)
}

// 暂未接入的模块：明确提示，不做无声跳转
function todo(name) {
  ElMessage.info(`${name}功能暂未接入`)
}

onMounted(async () => {
  // 采购方待审核（status=1 待审核）
  try {
    const buyers = await buyerAdminApi.getPendingBuyers({ status: 1, page: 1, pageSize: 1 })
    setCard('buyers', buyers?.total ?? 0)
  } catch (e) {
    setCard('buyers', -1)
  }
  // 供应商待审核（status=0）
  try {
    const suppliers = await userAdminApi.getSuppliers()
    setCard('suppliers', (suppliers || []).filter((s) => s.status === 0).length)
  } catch (e) {
    setCard('suppliers', -1)
  }
  // 配送员待审核（status=0）
  try {
    const couriers = await userAdminApi.getCouriers()
    setCard('couriers', (couriers || []).filter((c) => c.status === 0).length)
  } catch (e) {
    setCard('couriers', -1)
  }
  // 商品待审核（新品 + 变更）
  try {
    const goods = await goodsAdminApi.getGoodsPending()
    const changes = await goodsAdminApi.getGoodsChangePending()
    setCard('goods', (goods?.length || 0) + (changes?.length || 0))
  } catch (e) {
    setCard('goods', -1)
  }
  // 待核订单（status=10 待确认，排除已拆单备货中的 30）
  try {
    const pending = await orderAdminApi.getPendingList()
    setCard('orders', (pending || []).filter((o) => o.status === 10).length)
  } catch (e) {
    setCard('orders', -1)
  }
  // 待派送任务（status=40 待配送）
  try {
    const dispatch = await dispatchAdminApi.getDispatchList()
    setCard('dispatch', dispatch?.length || 0)
  } catch (e) {
    setCard('dispatch', -1)
  }
  // 待结算单（status=0 待对账；接口返回全部，前端过滤）
  try {
    const settlements = await financeAdminApi.getSettlements()
    settleCount.value = (settlements || []).filter((s) => s.status === 0).length
  } catch (e) {
    settleCount.value = 0
  }
  // 近期业务状态（报表接口）
  try {
    overview.value = await reportsAdminApi.getOverview()
  } catch (e) {
    overviewError.value = true
  } finally {
    overviewLoading.value = false
  }
})
</script>

<style scoped>
.admin-dashboard-page {
  max-width: 1280px;
  margin: 0 auto;
}
.admin-dashboard-crumb {
  font-size: 13px;
  color: #8a9099;
  margin-bottom: 14px;
}
.admin-dashboard-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 14px;
}
.admin-dashboard-card {
  background: #fff;
  border-radius: 10px;
  padding: 18px 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: box-shadow 0.2s;
}
.admin-dashboard-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
.admin-dashboard-card-label {
  font-size: 13px;
  color: #8a9099;
}
.admin-dashboard-card-num {
  font-size: 30px;
  font-weight: 700;
  margin-top: 6px;
}
.admin-dashboard-alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff8ec;
  border: 1px solid #ffe4ba;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
  color: #b26a00;
  margin-bottom: 14px;
  cursor: pointer;
}
.admin-dashboard-alert-link {
  font-weight: 600;
  white-space: nowrap;
}
.admin-dashboard-panel {
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  margin-bottom: 14px;
}
.admin-dashboard-panel-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 14px;
}
.admin-dashboard-quick-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.admin-dashboard-quick-item {
  border: 1px solid #ebeef5;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}
.admin-dashboard-quick-item:hover {
  border-color: #00b96b;
  background: #f0fbf6;
}
.admin-dashboard-quick-ico {
  font-size: 24px;
}
.admin-dashboard-quick-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  margin-top: 8px;
}
.admin-dashboard-quick-desc {
  font-size: 12px;
  color: #8a9099;
  margin-top: 4px;
}
.admin-dashboard-empty {
  text-align: center;
  color: #b8bec6;
  font-size: 13px;
  padding: 40px 0;
}
.admin-dashboard-ov-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.admin-dashboard-ov-item {
  background: #f8fafc;
  border-radius: 10px;
  padding: 14px 16px;
}
.admin-dashboard-ov-label {
  font-size: 12px;
  color: #8a9099;
}
.admin-dashboard-ov-num {
  font-size: 22px;
  font-weight: 700;
  color: #1a1a1a;
  margin-top: 6px;
}
.admin-dashboard-ov-status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.admin-dashboard-ov-chip {
  font-size: 12px;
  color: #606266;
  background: #f0f2f5;
  border-radius: 12px;
  padding: 4px 12px;
}
</style>
