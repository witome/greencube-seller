<template>
  <el-container class="layout">
    <!-- 卡BE：≤768px 时侧栏改抽屉（fixed + translateX），遮罩点击收起；桌面样式不变 -->
    <el-aside width="220px" class="aside" :class="{ open: mobileOpen }">
      <div class="logo">🌿 辉崧鲜配运营后台</div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="#1f2d3d"
        text-color="#bfcbd9"
        active-text-color="#00B96B"
        @select="mobileOpen = false"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon><span>工作台</span>
        </el-menu-item>
        <el-menu-item index="/buyers">
          <el-icon><User /></el-icon><span>采购方管理</span>
        </el-menu-item>
        <el-menu-item index="/appeals">
          <el-icon><ChatDotRound /></el-icon><span>申诉处理</span>
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
        <el-menu-item index="/demand">
          <el-icon><Bell /></el-icon><span>采购需求</span>
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
        <!-- 卡BN-2（2026-10-02）：催单台（订单履约下方新增，其余菜单项不动） -->
        <el-menu-item index="/reminder">
          <el-icon><Phone /></el-icon><span>📞 催单台</span>
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
        <el-menu-item index="/payments">
          <el-icon><Money /></el-icon><span>支付流水</span>
        </el-menu-item>
        <el-menu-item index="/daily-reconciliation">
          <el-icon><CreditCard /></el-icon><span>每日对账</span>
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

    <!-- 卡BE：抽屉态半透明遮罩 -->
    <div class="aside-mask" :class="{ on: mobileOpen }" @click="mobileOpen = false"></div>

    <el-container>
      <el-header class="header">
        <el-icon class="hamburger" @click="mobileOpen = !mobileOpen"><Menu /></el-icon>
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
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

// 卡BE：≤768px 抽屉开关（≥769px 不生效，纯 CSS 控制）
const mobileOpen = ref(false)

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

/* ── 卡BE 手机端适配：仅 ≤768px 生效；≥769px 桌面视觉零变化 ── */
/* 汉堡按钮：桌面隐藏 */
.hamburger {
  display: none;
  font-size: 20px;
  color: #303133;
  cursor: pointer;
  margin-right: 10px;
  padding: 4px;
}
.aside-mask {
  display: none;
}
@media (max-width: 768px) {
  .hamburger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    padding: 6px; /* 触摸热区 ≥32px */
  }
  .aside {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 2500;
    width: 220px !important; /* 覆盖 el-aside 内联宽度，脱离文档流后主区占满 */
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    overflow-y: auto;
  }
  .aside.open {
    transform: translateX(0);
    box-shadow: 2px 0 12px rgba(0, 0, 0, 0.25);
  }
  .aside-mask {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 2400;
    background: rgba(0, 0, 0, 0.45);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
  }
  .aside-mask.on {
    opacity: 1;
    pointer-events: auto;
  }
  .header {
    height: 56px;
    padding: 0 12px;
  }
  .crumb {
    font-size: 14px;
    flex: 1;
    min-width: 0; /* 允许收缩出省略号，不折行 */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 8px;
  }
  .user {
    flex: 0 0 auto;
    gap: 6px;
  }
  .uname {
    font-size: 12px;
  }
  .main {
    padding: 10px;
  }
}
</style>
