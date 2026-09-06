<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="logo">🌿 绿立方运营后台</div>
      <p class="tip">开发环境登录（后端 dev mock）</p>
      <el-input v-model="code" placeholder="登录标识 code" @keyup.enter="doLogin" />
      <el-button type="primary" class="btn" :loading="loading" @click="doLogin">登录</el-button>
      <el-button class="btn" @click="quickAdmin">一键登录运营账号（code=admin）</el-button>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '../api/modules'

const router = useRouter()
const code = ref('')
const loading = ref(false)

async function doLogin(c = null) {
  const loginCode = c ?? code.value
  if (!loginCode) {
    ElMessage.warning('请输入登录标识 code')
    return
  }
  loading.value = true
  try {
    const data = await authApi.login(loginCode)
    localStorage.setItem('admin_token', data.token)
    localStorage.setItem('admin_name', '运营管理员')
    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    loading.value = false
  }
}

function quickAdmin() {
  doLogin('admin')
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
.btn {
  width: 100%;
  margin-top: 16px;
  margin-left: 0;
}
</style>
