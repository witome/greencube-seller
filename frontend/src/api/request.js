/**
 * 统一请求封装
 * - 携带 token 与当前身份标识（后端按角色守卫 + 数据行级隔离）
 * - 统一处理 { code, msg, data } 信封：code≠0 时 toast + reject
 * - 401/2001 跳登录
 */
// 后端地址：开发/测试默认连本机 3001；生产部署时通过 VITE_API_BASE 环境变量覆盖
// 真机调试：用局域网 IP（手机与电脑同 WiFi）；H5 本机预览也可用 127.0.0.1/localhost
const BASE_URL = import.meta.env.VITE_API_BASE || 'http://192.168.1.78:3001/api/v1'

// 图片/静态资源服务器地址（去掉 /api/v1 前缀），上传图片返回的相对路径拼此前缀
export const BASE_HOST = BASE_URL.replace(/\/api\/v1$/, '')

// 把上传返回的相对路径（/uploads/xxx）拼成完整可访问 URL
export const fullUrl = (path) => (path ? (path.startsWith('http') ? path : BASE_HOST + path) : '')

function request({ url, method = 'GET', data, header = {} }) {
  return new Promise((resolve, reject) => {
    const doRequest = () => {
      uni.request({
        url: BASE_URL + url,
        method,
        data,
        header: {
          Authorization: `Bearer ${uni.getStorageSync('token') || ''}`,
          'X-Role': uni.getStorageSync('currentRole') || '',
          ...header,
        },
        success: (res) => {
          const body = res.data || {}

          // 未登录 / token 失效：清除凭据，跳登录页
          if (res.statusCode === 401 || body.code === 2001) {
            uni.removeStorageSync('token')
            uni.removeStorageSync('currentRole')
            uni.removeStorageSync('accountStatus')
            uni.reLaunch({ url: '/pages/login/index' })
            reject(body)
            return
          }

          // 业务错误（HTTP 200 + code≠0）
          if (body.code !== 0 && body.code !== undefined) {
            uni.showToast({ title: body.msg || '操作失败', icon: 'none' })
            reject(body)
            return
          }

          // 成功：直接解包 data
          resolve(body.data !== undefined ? body.data : body)
        },
        fail: (err) => {
          uni.showToast({ title: '网络异常，请检查后端是否启动', icon: 'none' })
          reject(err)
        },
      })
    }

    // 未登录时：登录接口本身直接发（无需 token），其它接口跳登录页
    if (!uni.getStorageSync('token') && url !== '/auth/wx-login') {
      uni.reLaunch({ url: '/pages/login/index' })
      reject({ code: 2001, msg: '未登录' })
      return
    }
    doRequest()
  })
}

export const get = (url, params) => {
  // 过滤 undefined/null 字段：小程序端会把它们序列化成 "undefined"/"null" 字符串，后端误判（如 date=undefined）
  let clean = params
  if (params) {
    clean = {}
    for (const k in params) {
      const v = params[k]
      if (v !== undefined && v !== null) clean[k] = v
    }
  }
  return request({ url, method: 'GET', data: clean })
}
export const post = (url, data) => request({ url, method: 'POST', data })
export const put = (url, data) => request({ url, method: 'PUT', data })
export const del = (url, data) => request({ url, method: 'DELETE', data })
export default request
