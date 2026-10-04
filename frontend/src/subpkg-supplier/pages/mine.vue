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
      <view class="list-item" @tap="go('/subpkg-supplier/pages/profile-edit')"><view class="li-ico" style="background:#FFF3E6;">🏪</view><view class="li-main"><view class="li-t">店铺资料</view><view class="li-d">档口信息 · 资质证照（只读）</view></view><view class="arrow">›</view></view>
    </view>

    <!-- 卡BN-3：提醒设置（接口拿不到时整卡隐藏降级，不显示成「关闭」误导供应商） -->
    <view class="card" v-if="notify">
      <view class="card-title">提醒设置</view>
      <view class="list-item">
        <view class="li-main"><view class="li-t">📞  电话提醒</view><view class="li-d">超 {{ notify.thresholdMinutes }} 分钟未接单，系统打电话给你</view></view>
        <switch :key="notify.ackCallEnabled ? 'on' : 'off'" :checked="notify.ackCallEnabled" color="#00b96b" @change="onNotifyToggle" />
      </view>
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
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi } from '@/api/modules'
import { useUserStore } from '@/store/user'
import { logoutToLogin } from '@/utils/logout'
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

// 状态自动同步：onShow 每次都重新拉 profile（不再依赖登录时的旧缓存）；
// 审核通过（0 待审核 → 1 合作中）跃迁时提示——完整的轮询+自动进入见审核中页（audit-sync composable）
onShow(async () => {
  const prev = profile.value?.supplier?.status
  try { profile.value = await authApi.getProfile() } catch (e) {}
  if (prev === 0 && profile.value?.supplier?.status === 1) {
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

// ─── 卡BN-3（2026-10-02）：电话提醒开关（GET/PUT /supplier-notify/me）───
// 追加独立 import（不改上面的原有行，保证删除行数=0）
import { supplierApi } from '@/api/modules'

const notify = ref(null) // null = 接口不可用 → 整卡隐藏（降级）

// uni-app 的 onShow 支持多次注册：这里追加一个回调，不改动上面的原 onShow
onShow(async () => {
  try {
    notify.value = await supplierApi.getNotifySetting()
  } catch (e) {
    notify.value = null // 网络错/未上线 → 隐藏卡片，绝不显示成「关闭」
  }
})

// 切换：乐观更新 → PUT；失败回滚开关并 toast（switch 绑了 :key，回滚后强制重渲染保证 UI 一致）
const onNotifyToggle = async (e) => {
  const next = !!(e && e.detail && e.detail.value)
  const prev = notify.value.ackCallEnabled
  notify.value = { ...notify.value, ackCallEnabled: next }
  try {
    await supplierApi.updateNotifySetting({ ackCallEnabled: next })
  } catch (err) {
    notify.value = { ...notify.value, ackCallEnabled: prev }
    t('设置失败，请重试')
  }
}
</script>

<style lang="scss" scoped>
.page { padding-bottom: 70px; padding-bottom: calc(70px + env(safe-area-inset-bottom)); padding-bottom: calc(70px + var(--ctb-safe-final, env(safe-area-inset-bottom))); } /* 卡BF: 三重声明，env 失效时由 CustomTabBar 写入的 --ctb-safe-final 兜底 */
.user-row { display: flex; align-items: center; gap: 12px; }
.avatar { width: 48px; height: 48px; border-radius: 50%; background: #e6f9f0; display: flex; align-items: center; justify-content: center; font-size: 22px; }
.user-name { font-size: 16px; font-weight: 700; color: $text-title; }
.user-phone { font-size: 12px; color: $text-second; margin-top: 3px; }
</style>
