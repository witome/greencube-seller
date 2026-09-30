<template>
  <view class="page">
    <view class="card" v-if="profile">
      <view class="user-row">
        <view class="avatar">🚚</view>
        <view class="user-main">
          <view class="user-name">配送员</view>
          <view class="user-phone">{{ profile.phone || '未绑定手机' }}</view>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="list-item" @tap="t('健康证有效期：以运营登记为准')"><view class="li-ico" style="background:#E6F9F0;">📋</view><view class="li-main"><view class="li-t">证照管理</view><view class="li-d">健康证 · 驾驶证</view></view><view class="arrow">›</view></view>
      <view class="list-item" @tap="t('培训记录：将由平台统一记录')"><view class="li-ico" style="background:#E8F1FF;">📚</view><view class="li-main"><view class="li-t">培训记录</view><view class="li-d">由平台统一记录</view></view><view class="arrow">›</view></view>
      <view class="list-item" @tap="t('收入由平台统一发放，不展示订单金额')"><view class="li-ico" style="background:#FFF3E6;">💰</view><view class="li-main"><view class="li-t">收入说明</view><view class="li-d">平台统一发放</view></view><view class="arrow">›</view></view>
      <view class="list-item" @tap="t('违规记录：以平台记录为准')"><view class="li-ico" style="background:#FFEDED;">⚠️</view><view class="li-main"><view class="li-t">违规记录</view><view class="li-d">以平台记录为准</view></view><view class="arrow">›</view></view>
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

    <CustomTabBar :tabs="courierTabs" active="/subpkg-courier/pages/mine" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi } from '@/api/modules'
import { useUserStore } from '@/store/user'
import { logoutToLogin } from '@/utils/logout'
import CustomTabBar from '@/components/CustomTabBar.vue'

const profile = ref(null)
const t = (msg) => uni.showToast({ title: msg, icon: 'none' })
const roleName = (r) => ({ purchaser: '采购方', supplier: '供应商', courier: '配送员', admin: '运营' }[r] || r)
const roleIcon = (r) => ({ purchaser: '🏪', supplier: '🥕', courier: '🚚', admin: '⚙️' }[r] || '👤')

const courierTabs = [
  { path: '/subpkg-courier/pages/home', icon: '📋', label: '今日任务' },
  { path: '/subpkg-courier/pages/task-detail', icon: '🧭', label: '配送' },
  { path: '/subpkg-courier/pages/deliver', icon: '✅', label: '交付' },
  { path: '/subpkg-courier/pages/mine', icon: '👤', label: '我的' },
]

// 状态自动同步：onShow 每次都重新拉 profile（不再依赖登录时的旧缓存）；
// 审核通过（0 待审核 → 1 正常，仅外部申请制有审核环节）跃迁时提示——完整轮询+自动进入见审核中页（audit-sync composable）
onShow(async () => {
  const prev = profile.value?.courier?.status
  try { profile.value = await authApi.getProfile() } catch (e) {}
  if (prev === 0 && profile.value?.courier?.status === 1) {
    uni.showToast({ title: '审核已通过', icon: 'success' })
  }
})

const switchRole = async (r) => {
  try {
    await useUserStore().switchRole(r)
  } catch (e) {
    // 失败：request 层已提示；保持原身份与原页面，不跳转
  }
}

// Hermes 复核收口（2026-09-30）：并到唯一共享实现 —— 原内联版本漏了 stopAllPollers()，
// 会出现「退出登录后旧页轮询还拿旧身份打接口 → 反复弹权限错」。
const logout = () => logoutToLogin()

</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; }
.user-row { display: flex; align-items: center; gap: 12px; }
.avatar { width: 48px; height: 48px; border-radius: 50%; background: #e6f9f0; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.user-name { font-size: 16px; font-weight: 700; color: $text-title; }
.user-phone { font-size: 12px; color: $text-second; margin-top: 3px; }
</style>
