<template>
  <view class="buyer-mine-page">
    <!-- 加载中 -->
    <view v-if="profileLoading" class="buyer-mine-empty">加载中…</view>

    <!-- 加载失败 -->
    <view v-else-if="profileError" class="buyer-mine-empty buyer-mine-retry" @tap="loadProfile">
      <text>资料加载失败，点击重试</text>
    </view>

    <template v-else>
      <!-- ① 账号状态提示条 -->
      <view v-if="profile" :class="['buyer-mine-status', 'buyer-mine-status-' + statusClass]">
        <text class="buyer-mine-status-ico">{{ statusIcon }}</text>
        <view class="buyer-mine-status-main">
          <text class="buyer-mine-status-b">{{ statusTitle }}</text>
          <text class="buyer-mine-status-s">{{ statusSub }}</text>
        </view>
        <text v-if="accountStatus === null" class="buyer-mine-status-link" @tap="go('/pages/buyer/register')">去注册 ›</text>
        <text v-else-if="accountStatus === 1" class="buyer-mine-status-link" @tap="go('/pages/buyer/pending-verify')">查看进度 ›</text>
        <text v-else-if="accountStatus === 3" class="buyer-mine-status-link" @tap="go('/pages/buyer/verify-rejected')">去申诉 ›</text>
      </view>

      <!-- ② 餐馆资料卡 -->
      <view v-if="profile" class="buyer-mine-profile-card">
        <view class="buyer-mine-avatar">🏪</view>
        <view class="buyer-mine-profile-main">
          <view class="buyer-mine-shop-name">{{ shopName }}</view>
          <view class="buyer-mine-shop-sub">
            {{ contactLine }}
            <text v-if="accountStatus === 2" class="buyer-mine-tag buyer-mine-tag-ok">正常</text>
          </view>
        </view>
        <text v-if="canSwitchRole" class="buyer-mine-switch" @tap="onSwitchRole">切换身份 ›</text>
      </view>

      <!-- ③ 数据概览（三栏） -->
      <view v-if="profile && accountStatus === 2" class="buyer-mine-stat-row">
        <view class="buyer-mine-stat" @tap="go('/pages/buyer/bill')">
          <view class="buyer-mine-stat-num buyer-mine-num-orange">{{ fmtMoney(stats.unpaid) }}</view>
          <view class="buyer-mine-stat-lbl">未付账款</view>
        </view>
        <view class="buyer-mine-stat" @tap="goTab('/pages/buyer/order-list')">
          <view class="buyer-mine-stat-num buyer-mine-num-blue">{{ stats.monthOrders ?? '暂无' }}</view>
          <view class="buyer-mine-stat-lbl">本月订单</view>
        </view>
        <view class="buyer-mine-stat" @tap="go('/pages/buyer/aftersale')">
          <view class="buyer-mine-stat-num buyer-mine-num-red">暂无</view>
          <view class="buyer-mine-stat-lbl">售后中</view>
        </view>
      </view>

      <!-- ④ 功能列表 -->
      <view v-if="profile" class="buyer-mine-menu">
        <view class="buyer-mine-menu-item" @tap="todo('餐馆资料（只读，修改请联系运营）')">
          <view class="buyer-mine-menu-ico buyer-mine-ico-green">🏪</view>
          <view class="buyer-mine-menu-main">
            <view class="buyer-mine-menu-t">餐馆资料</view>
            <view class="buyer-mine-menu-d">营业执照 · 食品经营许可证</view>
          </view>
          <view class="buyer-mine-arrow">›</view>
        </view>
        <view class="buyer-mine-menu-item" @tap="todo('收货地址 · 功能建设中')">
          <view class="buyer-mine-menu-ico buyer-mine-ico-blue">📍</view>
          <view class="buyer-mine-menu-main">
            <view class="buyer-mine-menu-t">收货地址</view>
            <view class="buyer-mine-menu-d">配送时段 07:00-09:00</view>
          </view>
          <view class="buyer-mine-arrow">›</view>
        </view>
        <view class="buyer-mine-menu-item" @tap="todo('身份申请 · 功能建设中')">
          <view class="buyer-mine-menu-ico buyer-mine-ico-purple">🪪</view>
          <view class="buyer-mine-menu-main">
            <view class="buyer-mine-menu-t">身份申请</view>
            <view class="buyer-mine-menu-d">申请成为供应商 / 配送人员</view>
          </view>
          <view class="buyer-mine-arrow">›</view>
        </view>
        <view class="buyer-mine-menu-item" @tap="go('/pages/buyer/bill')">
          <view class="buyer-mine-menu-ico buyer-mine-ico-orange">💰</view>
          <view class="buyer-mine-menu-main">
            <view class="buyer-mine-menu-t">账款记录</view>
            <view class="buyer-mine-menu-d">{{ payModeLine }}</view>
          </view>
          <view class="buyer-mine-arrow">›</view>
        </view>
        <view class="buyer-mine-menu-item" @tap="go('/pages/buyer/kefu')">
          <view class="buyer-mine-menu-ico buyer-mine-ico-teal">💬</view>
          <view class="buyer-mine-menu-main">
            <view class="buyer-mine-menu-t">联系客服</view>
            <view class="buyer-mine-menu-d">在线客服</view>
          </view>
          <view class="buyer-mine-arrow">›</view>
        </view>
      </view>

      <!-- 退出登录 -->
      <view v-if="profile" class="buyer-mine-logout" @tap="logout">退出登录</view>
    </template>

    <BuyerTabBar active="/pages/buyer/mine" />
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi, buyerApi } from '@/api/modules'
import BuyerTabBar from '@/components/BuyerTabBar.vue'

const profile = ref(null)
const profileLoading = ref(true)
const profileError = ref(false)
// 数据概览：未付账款 + 本月订单（来自月度对账单）；售后中暂无接口
const stats = ref({ unpaid: null, monthOrders: null })

const accountStatus = computed(() => profile.value?.purchaser?.accountStatus ?? null)
const shopName = computed(() => profile.value?.purchaser?.shopName || '未注册餐馆')
const canSwitchRole = computed(() => (profile.value?.roles?.length || 0) > 1)

// 联系人 · 脱敏手机号
const maskPhone = (p) => {
  const s = String(p || '')
  if (!s) return '未绑定手机'
  if (s.length < 7) return s
  return s.slice(0, 3) + '****' + s.slice(-4)
}
const contactLine = computed(() => {
  const c = profile.value?.purchaser?.contact || ''
  const phone = profile.value?.purchaser?.phone || profile.value?.phone || ''
  return [c, maskPhone(phone)].filter(Boolean).join(' · ') || '未完善资料'
})

// 结算方式（账款记录副标题）
const payModeLine = computed(() => {
  const mode = { 1: 'COD', 2: '周结', 3: '月结' }[profile.value?.purchaser?.payMode] || 'COD'
  const limit = Number(profile.value?.purchaser?.creditLimit || 0)
  return `${mode} · 额度 ¥${limit}`
})

// 账号状态（提示条）
const statusIcon = computed(() => ({ 1: '⏳', 2: '✅', 3: '❌', 4: '⛔', 5: '⏸' }[accountStatus.value] || '🏪'))
const statusTitle = computed(() => {
  if (accountStatus.value === null) return '尚未注册餐馆账号'
  return { 1: '账号审核中', 2: '账号已激活', 3: '账号未通过审核', 4: '账号已冻结', 5: '账号已停用' }[accountStatus.value] || '账号状态异常'
})
const statusSub = computed(() => {
  if (accountStatus.value === null) return '注册后即可在线下单采购'
  return {
    1: '审核通过后即可下单，请耐心等待',
    2: '您可正常下单 · 资质信息以证照为准',
    3: '可提交申诉重新审核',
    4: '账号已冻结，请联系运营处理',
    5: '账号已停用，请联系运营处理',
  }[accountStatus.value] || ''
})
const statusClass = computed(() => {
  if (accountStatus.value === null) return 'warn'
  return { 1: 'warn', 2: 'ok', 3: 'err', 4: 'err', 5: 'warn' }[accountStatus.value] || 'warn'
})

const fmtMoney = (n) => {
  if (n === null || n === undefined) return '暂无'
  return '¥' + Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

const roleName = (r) => ({ purchaser: '采购方', supplier: '供应商', courier: '配送员', admin: '运营' }[r] || r)

const go = (url) => uni.navigateTo({ url })
const goTab = (url) => uni.switchTab({ url })
const todo = (msg) => uni.showToast({ title: msg, icon: 'none' })

// ── 切换身份（复用现有 switchRole 逻辑） ──
const switchRole = async (r) => {
  const data = await authApi.switchRole(r)
  uni.setStorageSync('token', data.token)
  uni.setStorageSync('currentRole', data.currentRole)
  const homeMap = { purchaser: '/pages/buyer/home', supplier: '/subpkg-supplier/pages/home', courier: '/subpkg-courier/pages/home' }
  uni.reLaunch({ url: homeMap[r] || '/pages/buyer/home' })
}

const onSwitchRole = () => {
  const roles = profile.value?.roles || []
  const others = roles.filter((r) => r !== profile.value?.currentRole)
  if (!others.length) {
    uni.showToast({ title: '当前仅采购方身份', icon: 'none' })
    return
  }
  uni.showActionSheet({
    itemList: others.map((r) => roleName(r)),
    success: (res) => switchRole(others[res.tapIndex]),
  })
}

const logout = () => {
  uni.removeStorageSync('token')
  uni.removeStorageSync('currentRole')
  uni.removeStorageSync('accountStatus')
  uni.removeStorageSync('devRole')
  uni.reLaunch({ url: '/pages/login/index' })
}

const currentPeriod = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const loadProfile = async () => {
  profileLoading.value = true
  profileError.value = false
  try {
    profile.value = await authApi.getProfile()
  } catch (e) {
    profileError.value = true
  } finally {
    profileLoading.value = false
  }
}

// 未付账款 + 本月订单：复用月度对账单接口（真实数据）
const loadStats = async () => {
  try {
    const bill = await buyerApi.getBill(currentPeriod())
    stats.value = { unpaid: bill.unpaidAmount ?? 0, monthOrders: bill.orderCount ?? 0 }
  } catch (e) {
    stats.value = { unpaid: null, monthOrders: null }
  }
}

onMounted(async () => {
  await loadProfile()
  if (accountStatus.value === 2) loadStats()
})

onShow(() => {
  try { uni.hideTabBar({ animation: false, fail: () => {} }) } catch (e) {}
})
</script>

<style lang="scss" scoped>
.buyer-mine-page {
  min-height: 100vh;
  background: $bg-page;
  padding: 12px;
  padding-bottom: 80px; /* 预留底部导航高度 */
  box-sizing: border-box;
}
.buyer-mine-empty {
  text-align: center; color: $text-placeholder; font-size: 13px; padding: 60px 0;
}
.buyer-mine-retry { color: $info; }

/* ── ① 账号状态提示条（浅绿渐变） ── */
.buyer-mine-status {
  display: flex; align-items: center; gap: 8px;
  border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px;
}
.buyer-mine-status-ico { font-size: 15px; flex-shrink: 0; }
.buyer-mine-status-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.buyer-mine-status-b { font-weight: 700; }
.buyer-mine-status-s { font-size: 11px; opacity: .9; margin-top: 1px; }
.buyer-mine-status-link { font-weight: 700; white-space: nowrap; }
.buyer-mine-status-ok { background: linear-gradient(90deg, #E6F9F0, #F4FFF8); border: 1px solid #C9F0DD; color: #00B96B; }
.buyer-mine-status-warn { background: #FFF8EC; border: 1px solid #FFE4BA; color: #B26A00; }
.buyer-mine-status-err { background: #FFF0F0; border: 1px solid #FFD6D6; color: #FA5151; }

/* ── ② 餐馆资料卡 ── */
.buyer-mine-profile-card {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: 14px; padding: 14px;
  margin-bottom: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.buyer-mine-avatar {
  width: 52px; height: 52px; border-radius: 50%; background: #E6F9F0;
  display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0;
}
.buyer-mine-profile-main { flex: 1; min-width: 0; }
.buyer-mine-shop-name { font-size: 16px; font-weight: 800; color: $text-title; }
.buyer-mine-shop-sub { font-size: 11px; color: #8A9099; margin-top: 2px; display: flex; align-items: center; gap: 4px; }
.buyer-mine-tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
.buyer-mine-tag-ok { background: #E6F9F0; color: #00B96B; }
.buyer-mine-switch { font-size: 11px; color: #00B96B; white-space: nowrap; }

/* ── ③ 数据概览（三栏） ── */
.buyer-mine-stat-row { display: flex; gap: 8px; margin-bottom: 10px; }
.buyer-mine-stat {
  flex: 1; background: #fff; border-radius: 12px; padding: 12px 4px;
  text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.buyer-mine-stat-num { font-size: 18px; font-weight: 800; color: $text-title; }
.buyer-mine-num-orange { color: #FF8F1F; }
.buyer-mine-num-blue { color: #3B7CFF; }
.buyer-mine-num-red { color: #FA5151; }
.buyer-mine-stat-lbl { font-size: 11px; color: #8A9099; margin-top: 2px; }

/* ── ④ 功能列表 ── */
.buyer-mine-menu {
  background: #fff; border-radius: 14px; margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04); overflow: hidden;
}
.buyer-mine-menu-item {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 14px; border-bottom: 1px solid #F5F6F8;
}
.buyer-mine-menu-item:last-child { border-bottom: none; }
.buyer-mine-menu-item:active { background: #F7F9FA; }
.buyer-mine-menu-ico {
  width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 20px;
}
.buyer-mine-ico-green { background: #E6F9F0; }
.buyer-mine-ico-blue { background: #E8F1FF; }
.buyer-mine-ico-purple { background: #F3EDFF; }
.buyer-mine-ico-orange { background: #FFF3E6; }
.buyer-mine-ico-teal { background: #E3F7F5; }
.buyer-mine-menu-main { flex: 1; min-width: 0; }
.buyer-mine-menu-t { font-size: 14px; font-weight: 600; color: $text-title; }
.buyer-mine-menu-d { font-size: 11px; color: #8A9099; margin-top: 2px; }
.buyer-mine-arrow { color: #C2C8D0; font-size: 18px; }

/* ── 退出登录 ── */
.buyer-mine-logout {
  text-align: center; background: #fff; border-radius: 14px;
  padding: 13px; font-size: 14px; color: $text-second;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
</style>
