/**
 * 统一请求封装
 * - 携带 token 与当前身份标识（后端按角色守卫 + 数据行级隔离）
 * - 统一处理 { code, msg, data } 信封：code≠0 时 toast + reject
 * - 401/2001 跳登录
 */
const BASE_URL = import.meta.env.MODE === 'development'
  ? 'http://localhost:3001/api/v1'  // NestJS 本地（含 /api/v1 前缀）
  : 'https://api.example.com/api/v1' // TODO: 生产域名

function request({ url, method = 'GET', data, header = {} }) {
  return new Promise((resolve, reject) => {
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

        // 未登录 / token 失效
        if (res.statusCode === 401 || body.code === 2001) {
          uni.reLaunch({ url: '/pages/buyer/home' }) // TODO: 登录页
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
  })
}

export const get = (url, params) => request({ url, method: 'GET', data: params })
export const post = (url, data) => request({ url, method: 'POST', data })
export const put = (url, data) => request({ url, method: 'PUT', data })
export const del = (url, data) => request({ url, method: 'DELETE', data })
export default request
