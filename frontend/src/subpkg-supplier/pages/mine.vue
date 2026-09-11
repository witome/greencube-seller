<template>
  <view class="page">
    <view class="card" v-if="profile">
      <view class="user-row">
        <view class="avatar">🥕</view>
        <view class="user-main">
          <view class="user-name">{{ profile.supplier?.stallName || '档口' }}</view>
          <view class="user-phone">{{ profile.phone || '未绑定手机' }}</view>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="list-item" @tap="go('/subpkg-supplier/pages/goods-manage')"><view class="li-ico" style="background:#E6F9F0;">📦</view><view class="li-main"><view class="li-t">商品管理</view><view class="li-d">提交新品 · 变更 · 改库存</view></view><view class="arrow">›</view></view>
      <view class="list-item" @tap="go('/subpkg-supplier/pages/finance')"><view class="li-ico" style="background:#F3EDFF;">💰</view><view class="li-main"><view class="li-t">历史与应付</view><view class="li-d">月度结算单</view></view><view class="arrow">›</view></view>
      <view class="list-item" @tap="t('资质证照：营业执照/检疫证（含有效期预警）')"><view class="li-ico" style="background:#FFF3E6;">📋</view><view class="li-main"><view class="li-t">资质维护</view><view class="li-d">营业执照 · 检疫合格证</view></view><view class="arrow">›</view></view>
    </view>

    <!-- 身份切换 -->
    <view class="card" v-if="profile && profile.roles && profile.roles.length > 1">
      <view class="card-title">切换身份</view>
      <view v-for="r in profile.roles" :key="r" class="list-item" @tap="switchRole(r)">
        <view class="li-ico">{{ roleIcon(r) }}</view>
        <view class="li-main"><view class="li-t">{{ roleName(r) }}</view></view>
        <view class="tag" v-if="r === profile.currentRole">当前</view>
      </view>
    </view>

    <view class="row-btns"><view class="pbtn" @tap="logout">退出登录</view></view>

    <CustomTabBar :tabs="supplierTabs" active="/subpkg-supplier/pages/mine" />
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi } from '@/api/modules'
import { useUserStore } from '@/store/user'
import CustomTabBar from '@/components/CustomTabBar.vue'

const profile = ref(null)
const go = (url) => uni.navigateTo({ url })
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })
const roleName = (r) => ({ purchaser: '采购方', supplier: '供应商', courier: '配送员', admin: '运营' }[r] || r)
const roleIcon = (r) => ({ purchaser: '🏪', supplier: '🥕', courier: '🚚', admin: '⚙️' }[r] || '👤')

const supplierTabs = [
  { path: '/subpkg-supplier/pages/home', icon: '📋', label: '今日待办' },
  { path: '/subpkg-supplier/pages/stock-list', icon: '📄', label: '备货单' },
  { path: '/subpkg-supplier/pages/handover', icon: '🤝', label: '交接' },
  { path: '/subpkg-supplier/pages/finance', icon: '💰', label: '应付' },
  { path: '/subpkg-supplier/pages/mine', icon: '👤', label: '我的' },
]

onShow(() => {
})

const switchRole = async (r) => {
  try {
    await useUserStore().switchRole(r)
  } catch (e) {
    // 失败：request 层已提示；保持原身份与原页面，不跳转
  }
}

const logout = () => {
  uni.removeStorageSync('token'); uni.removeStorageSync('currentRole')
  uni.removeStorageSync('accountStatus'); uni.removeStorageSync('devRole')
  uni.reLaunch({ url: '/pages/login/index' })
}

onMounted(async () => { try { profile.value = await authApi.getProfile() } catch (e) {} })
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.user-row { display: flex; align-items: center; gap: 12px; }
.avatar { width: 48px; height: 48px; border-radius: 50%; background: #e6f9f0; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.user-name { font-size: 16px; font-weight: 700; color: $text-title; }
.user-phone { font-size: 12px; color: $text-second; margin-top: 3px; }
</style>
