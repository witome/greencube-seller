<template>
  <view class="drs-wrap">
    <view class="drs-btn" @tap.stop="panelShow = !panelShow">🎭</view>
    <view v-if="panelShow" class="drs-panel">
      <view class="drs-panel-title">切换测试角色</view>
      <view v-for="r in roles" :key="r.role" class="drs-item" @tap.stop="switchTo(r)">
        <text class="drs-emoji">{{ r.emoji }}</text>
        <text class="drs-name">{{ r.name }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { authApi } from '@/api/modules'

const panelShow = ref(false)

const roles = [
  { name: '采购方', role: 'buyer', path: '/pages/buyer/home', emoji: '🛒' },
  { name: '供应商', role: 'demo_supplier', path: '/subpkg-supplier/pages/home', emoji: '🥕' },
  { name: '配送员', role: 'courier', path: '/subpkg-courier/pages/home', emoji: '🚚' },
]

const switchTo = async (r) => {
  panelShow.value = false
  uni.setStorageSync('devRole', r.role)
  try {
    const data = await authApi.login(r.role)
    uni.setStorageSync('token', data.token)
    uni.setStorageSync('currentRole', data.currentRole)
    uni.setStorageSync('accountStatus', data.accountStatus)
    uni.reLaunch({ url: r.path })
  } catch (e) {
    uni.showToast({ title: '切换失败：请确认后端已启动', icon: 'none' })
  }
}
</script>

<style lang="scss" scoped>
.drs-wrap {
  position: fixed;
  right: 14px;
  bottom: 120px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.drs-btn {
  width: 46px;
  height: 46px;
  border-radius: 23px;
  background: #00b96b;
  color: #fff;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
}
.drs-panel {
  margin-top: 8px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  min-width: 160px;
}
.drs-panel-title {
  padding: 10px 16px;
  font-size: 12px;
  color: #8a9099;
  border-bottom: 1px solid #f0f0f0;
}
.drs-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 18px;
  font-size: 14px;
  color: #333;
  border-bottom: 1px solid #f0f0f0;
}
.drs-item:last-child {
  border-bottom: none;
}
.drs-emoji {
  font-size: 16px;
}
.drs-name {
  font-weight: 600;
}
</style>
