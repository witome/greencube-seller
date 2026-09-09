<template>
  <view class="login-page">
    <!-- 品牌区 -->
    <view class="brand">
      <view class="logo">🍃</view>
      <view class="brand-name">绿立方</view>
      <view class="brand-slogan">鲜货直供 · 次日送达 · 货到付款</view>
    </view>

    <!-- 卖点卡片 -->
    <view class="feature-row">
      <view class="feature">
        <view class="feature-ico">🥬</view>
        <view class="feature-text">源头直供</view>
      </view>
      <view class="feature">
        <view class="feature-ico">🚚</view>
        <view class="feature-text">次日送达</view>
      </view>
      <view class="feature">
        <view class="feature-ico">💰</view>
        <view class="feature-text">货到付款</view>
      </view>
    </view>

    <!-- 登录区 -->
    <view class="login-area">
      <view class="wx-btn" :class="{ loading: logging }" @tap="doLogin">
        <text class="wx-ico">💚</text>
        <text>{{ logging ? '登录中…' : '微信一键登录' }}</text>
      </view>
      <view class="reg-link" @tap="goRegister">还没有账号？<text class="reg-link-b">注册 ›</text></view>
    </view>

    <!-- 底部协议 -->
    <view class="agreement">登录即代表同意《用户协议》和《隐私政策》</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { authApi } from '@/api/modules'

const logging = ref(false)

// 登录后按角色跳转对应首页
const routeToHome = (currentRole) => {
  const homeMap = {
    purchaser: '/pages/buyer/home',
    supplier: '/subpkg-supplier/pages/home',
    courier: '/subpkg-courier/pages/home',
    admin: '/pages/buyer/home',
  }
  uni.reLaunch({ url: homeMap[currentRole] || '/pages/buyer/home' })
}

const doLogin = async () => {
  if (logging.value) return
  logging.value = true
  try {
    // mock 阶段：固定以采购方身份登录（角色切换通过登录后的 🎭 按钮）
    const data = await authApi.login('buyer')
    uni.setStorageSync('token', data.token)
    uni.setStorageSync('currentRole', data.currentRole)
    uni.setStorageSync('accountStatus', data.accountStatus)
    if (data.needRegister) {
      uni.reLaunch({ url: '/pages/buyer/register' })
    } else {
      uni.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => routeToHome(data.currentRole), 200)
    }
  } catch (e) {
    uni.showToast({ title: '登录失败，请确认后端已启动', icon: 'none' })
  } finally {
    logging.value = false
  }
}

const goRegister = async () => {
  if (logging.value) return
  logging.value = true
  try {
    // 注册用独立新账号（时间戳 code → 新 openid），避免复用固定测试账号导致「已提交过注册」
    const data = await authApi.login('reg_' + Date.now())
    uni.setStorageSync('token', data.token)
    uni.setStorageSync('currentRole', data.currentRole)
    uni.setStorageSync('accountStatus', data.accountStatus)
    uni.navigateTo({ url: '/pages/buyer/register' })
  } catch (e) {
    uni.showToast({ title: '请先登录后再注册', icon: 'none' })
  } finally {
    logging.value = false
  }
}

onShow(() => {
  // 已登录则直接跳转首页（避免已登录用户停留在登录页）
  if (uni.getStorageSync('token')) {
    const role = uni.getStorageSync('currentRole') || 'purchaser'
    routeToHome(role)
  }
})
</script>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #e6f9f0 0%, #f5f6f8 40%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 32px;
  box-sizing: border-box;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 120px;
}
.logo {
  width: 84px;
  height: 84px;
  border-radius: 24px;
  background: $brand;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  box-shadow: 0 8px 24px rgba(0, 185, 107, 0.25);
}
.brand-name {
  margin-top: 20px;
  font-size: 28px;
  font-weight: 700;
  color: $text-title;
  letter-spacing: 2px;
}
.brand-slogan {
  margin-top: 10px;
  font-size: 14px;
  color: $text-second;
}
.feature-row {
  display: flex;
  gap: 40px;
  margin-top: 48px;
}
.feature {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.feature-ico {
  font-size: 28px;
}
.feature-text {
  font-size: 12px;
  color: $text-second;
}
.login-area {
  width: 100%;
  margin-top: 64px;
}
.wx-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 50px;
  border-radius: 25px;
  background: $brand;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 6px 16px rgba(0, 185, 107, 0.28);
}
.wx-btn.loading {
  opacity: 0.7;
}
.wx-ico {
  font-size: 20px;
}
.reg-link {
  margin-top: 20px;
  text-align: center;
  font-size: 14px;
  color: $text-second;
}
.reg-link-b {
  color: $brand;
  font-weight: 600;
}
.agreement {
  position: absolute;
  bottom: 48px;
  font-size: 11px;
  color: $text-placeholder;
}
</style>
