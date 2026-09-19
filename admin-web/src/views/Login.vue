<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="logo">🌿 绿立方运营后台</div>
      <p class="tip">运营管理员登录</p>
      <el-form @submit.prevent>
        <el-input v-model="username" placeholder="账号" autocomplete="username" @keyup.enter="doLogin" />
        <el-input
          v-model="password"
          type="password"
          class="pwd"
          placeholder="密码"
          show-password
          autocomplete="current-password"
          @keyup.enter="doLogin"
        />
        <el-button type="primary" class="btn" :loading="loading" @click="doLogin">登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../api/modules'

const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)

async function doLogin() {
  // 非空校验
  if (!username.value.trim()) {
    ElMessage.warning('请输入账号')
    return
  }
  if (!password.value) {
    ElMessage.warning('请输入密码')
    return
  }
  loading.value = true
  try {
    const data = await authApi.adminLogin({ username: username.value.trim(), password: password.value })
    localStorage.setItem('admin_token', data.token)
    localStorage.setItem('admin_name', '运营管理员')
    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (e) {
    // 错误提示已由拦截器统一弹出（后端返回的 message）
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1f2d3d 0%, #00b96b 100%);
}
.login-card {
  width: 360px;
  padding: 12px 8px;
}
.logo {
  text-align: center;
  font-size: 20px;
  font-weight: 700;
  color: #00b96b;
  margin-bottom: 8px;
}
.tip {
  text-align: center;
  color: #909399;
  font-size: 13px;
  margin-bottom: 20px;
}
.pwd {
  margin-top: 12px;
}
.btn {
  width: 100%;
  margin-top: 20px;
  margin-left: 0;
}
</style>
