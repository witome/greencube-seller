<template>
  <div>
    <!-- 统计卡片 -->
    <el-row :gutter="16">
      <el-col :span="6" v-for="card in cards" :key="card.label">
        <el-card class="stat-card" shadow="hover" @click="go(card.path)">
          <div class="stat">
            <div class="num" :style="{ color: card.color }">{{ card.value }}</div>
            <div class="label">{{ card.label }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 快捷入口 -->
    <el-card class="quick" shadow="never">
      <template #header>快捷操作</template>
      <div class="quick-grid">
        <div class="quick-item" v-for="q in quicks" :key="q.title" @click="go(q.path)">
          <div class="q-ico">{{ q.icon }}</div>
          <div class="q-title">{{ q.title }}</div>
          <div class="q-desc">{{ q.desc }}</div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  buyerAdminApi,
  goodsAdminApi,
  dispatchAdminApi,
  financeAdminApi,
} from '../api/modules'

const router = useRouter()

const cards = ref([
  { label: '待审核采购方', value: '-', color: '#E6A23C', path: '/buyers' },
  { label: '待审核商品', value: '-', color: '#00B96B', path: '/goods' },
  { label: '待派送订单', value: '-', color: '#409EFF', path: '/dispatch' },
  { label: '待对账结算单', value: '-', color: '#909399', path: '/finance' },
])

const quicks = [
  { icon: '👥', title: '采购方审核', desc: '注册准入 · 线下核实', path: '/buyers' },
  { icon: '📦', title: '商品审核', desc: '新品/变更 · 供货优先级', path: '/goods' },
  { icon: '📋', title: '订单履约', desc: '核单拆单 · 验收称重', path: '/order' },
  { icon: '🚚', title: '派送调度', desc: '指派配送员', path: '/dispatch' },
  { icon: '💰', title: '资金结算', desc: '服务费 · 结算单', path: '/finance' },
  { icon: '🔍', title: '审计日志', desc: '操作留痕追溯', path: '/audit' },
]

function go(path) {
  router.push(path)
}

onMounted(async () => {
  // 聚合各待办数量（后端暂无 dashboard 聚合接口）
  try {
    const buyers = await buyerAdminApi.getPendingBuyers({ page: 1, pageSize: 1 })
    cards.value[0].value = buyers.total ?? 0
  } catch (e) { /* 忽略 */ }
  try {
    const goods = await goodsAdminApi.getGoodsPending()
    const changes = await goodsAdminApi.getGoodsChangePending()
    cards.value[1].value = (goods?.length || 0) + (changes?.length || 0)
  } catch (e) { /* 忽略 */ }
  try {
    const dispatch = await dispatchAdminApi.getDispatchList()
    cards.value[2].value = dispatch?.length || 0
  } catch (e) { /* 忽略 */ }
  try {
    const settlements = await financeAdminApi.getSettlements({ status: 0 })
    cards.value[3].value = settlements?.length || settlements?.total || 0
  } catch (e) { /* 忽略 */ }
})
</script>

<style scoped>
.stat-card {
  cursor: pointer;
}
.stat {
  text-align: center;
  padding: 8px 0;
}
.num {
  font-size: 30px;
  font-weight: 700;
}
.label {
  color: #909399;
  font-size: 13px;
  margin-top: 6px;
}
.quick {
  margin-top: 16px;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.quick-item {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 18px;
  cursor: pointer;
  transition: all 0.2s;
}
.quick-item:hover {
  border-color: #00b96b;
  box-shadow: 0 2px 10px rgba(0, 185, 107, 0.12);
}
.q-ico {
  font-size: 26px;
}
.q-title {
  font-size: 15px;
  font-weight: 600;
  margin-top: 8px;
}
.q-desc {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
</style>
