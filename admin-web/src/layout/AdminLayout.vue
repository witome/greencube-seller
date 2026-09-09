<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="logo">🌿 绿立方运营后台</div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="#1f2d3d"
        text-color="#bfcbd9"
        active-text-color="#00B96B"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon><span>工作台</span>
        </el-menu-item>
        <el-menu-item index="/buyers">
          <el-icon><User /></el-icon><span>采购方管理</span>
        </el-menu-item>
        <el-menu-item index="/suppliers">
          <el-icon><Shop /></el-icon><span>供应商管理</span>
        </el-menu-item>
        <el-menu-item index="/couriers">
          <el-icon><Bicycle /></el-icon><span>配送员管理</span>
        </el-menu-item>
        <el-menu-item index="/goods">
          <el-icon><Goods /></el-icon><span>商品审核</span>
        </el-menu-item>
        <el-menu-item index="/goods-manage">
          <el-icon><Box /></el-icon><span>商品管理</span>
        </el-menu-item>
        <el-menu-item index="/categories">
          <el-icon><Menu /></el-icon><span>分类管理</span>
        </el-menu-item>
        <el-menu-item index="/pricing">
          <el-icon><PriceTag /></el-icon><span>价格与加价</span>
        </el-menu-item>
        <el-menu-item index="/order">
          <el-icon><Tickets /></el-icon><span>订单履约</span>
        </el-menu-item>
        <el-menu-item index="/aftersale">
          <el-icon><Service /></el-icon><span>售后管理</span>
        </el-menu-item>
        <el-menu-item index="/dispatch">
          <el-icon><Van /></el-icon><span>派送调度</span>
        </el-menu-item>
        <el-menu-item index="/finance">
          <el-icon><Wallet /></el-icon><span>资金结算</span>
        </el-menu-item>
        <el-menu-item index="/audit">
          <el-icon><Document /></el-icon><span>审计日志</span>
        </el-menu-item>
        <el-menu-item index="/reports">
          <el-icon><TrendCharts /></el-icon><span>报表</span>
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon><span>系统设置</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="crumb">{{ $route.meta.title }}</div>
        <div class="user">
          <span class="uname">运营管理员</span>
          <el-button link type="danger" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

// 菜单高亮：核实详情页归到采购方管理
const activeMenu = computed(() => {
  if (route.path.startsWith('/buyers')) return '/buyers'
  return route.path
})

function logout() {
  localStorage.removeItem('admin_token')
  router.push('/login')
}
</script>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #1f2d3d;
  overflow: hidden;
}
.logo {
  height: 56px;
  line-height: 56px;
  text-align: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  background: #17212e;
}
.aside :deep(.el-menu) {
  border-right: none;
}
.header {
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.crumb {
  font-size: 15px;
  font-weight: 600;
}
.user {
  display: flex;
  align-items: center;
  gap: 8px;
}
.uname {
  color: #606266;
  font-size: 13px;
}
.main {
  background: #f5f6f8;
  padding: 20px;
}
</style>
