<!--
  采购方·驳回申诉页
  对应原型 data-page="verifyRejected"
  用户看到驳回原因，可提交申诉（30 天内仅 1 次）；运营复核后回到 pending 或终态驳回

  2026-09-19 卡D 修复（前 4 处缺陷导致「点了申诉根本发不出去」）：
  ① 原 :46 裸 uni.request —— url 缺 /api/v1 前缀、无 Authorization/X-Role 头，必失败；
     改走 api/modules.js 的 buyerApi.submitAppeal（统一封装，唯一入口）。
  ② 原 :42 驳回信息写死假数据（「业务员-小张 B003」）——
     改 onShow 拉 GET /buyer/pending，按真实返回取：
     rejectInfo{ reason, reasonCode } + steps[key=verify].time（核实时间）。
     接口不返回「核实方式/核实人」字段 → 相应行移除，绝不编造。
  ③ 原 :47 uni.setStorageSync('account_status',...) 键名写错（全仓 5 处均为
     accountStatus）→ 统一为 accountStatus；值用申诉接口返回的 accountStatus。
  ④ 原 :28 <lk-uploader> 全仓不存在的组件 → 附件入口移除（后端暂无申诉附件
     存储字段，属下一张卡；AppealDto.attachments 可选，不传即合法）。
  附：原页面样式类（hero/reason-row/lk-btn-primary 等）全仓无定义，补 scoped 样式。
-->
<template>
  <view class="container">
    <view class="hero">
      <text class="big-emoji">❌</text>
      <text class="title" style="color:#FA5151;">账号未通过审核</text>
      <text class="sub">请查看驳回原因，30 天内可提交一次申诉</text>
    </view>

    <view class="card reason">
      <text class="card-title" style="color:#FA5151;">📋 驳回原因</text>
      <view class="reason-row"><text class="k">原因类型：</text><text class="v">{{ reject.reasonType || '—' }}</text></view>
      <view class="reason-row"><text class="k">驳回原因：</text><text class="v">{{ reject.reason || '暂未获取到驳回说明，请稍后重试或联系客服' }}</text></view>
      <view class="reason-row"><text class="k">核实时间：</text><text class="v">{{ reject.verifiedAt || '—' }}</text></view>
    </view>

    <view class="card">
      <view class="warn">⚠️ 30 天内仅可申诉 1 次，请仔细描述真实情况</view>
      <text class="card-title">✍️ 申诉说明</text>
      <textarea class="ipt" v-model="appealText" rows="4" placeholder="请详细说明情况（如：地址应为 XX 路 18 号，原填写有误）"/>
      <!-- 补充附件入口暂缺：后端暂无申诉附件的接收/存储字段（下一张卡处理），组件本就未定义，先移除 -->
    </view>

    <view class="btn-row">
      <button class="lk-btn-primary" :disabled="!appealText || submitting" @tap="submit">{{ submitting ? '提交中…' : '提交申诉' }}</button>
      <button class="lk-btn" @tap="fixInfo">✏️ 修改资料</button>
    </view>
    <view class="footer-tip">申诉被驳回后，账号将冻结 60 天，之后可重新注册</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'

// 原因类型码表：与运营侧审核 DTO（reasonCode）口径一致
// 1执照不符 2电话无人接 3地址不实 4非餐饮 5重复申请 6资料不全 9其他
const REASON_TYPE = { 1: '执照不符', 2: '电话无人接', 3: '地址不实', 4: '非餐饮', 5: '重复申请', 6: '资料不全', 9: '其他' }

// 驳回信息：真实数据来自 GET /buyer/pending（rejected 时 rejectInfo 非空），不再写死
const reject = ref({ reasonType: '', reason: '', verifiedAt: '' })
const fmtTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const loadRejectInfo = async () => {
  try {
    const data = await buyerApi.getPending()
    const ri = data && data.rejectInfo
    const verifyStep = data && Array.isArray(data.steps) ? data.steps.find((s) => s.key === 'verify') : null
    reject.value = {
      reasonType: ri && ri.reasonCode != null ? (REASON_TYPE[ri.reasonCode] || '其他') : '',
      reason: (ri && ri.reason) || '',
      verifiedAt: verifyStep && verifyStep.time ? fmtTime(verifyStep.time) : '',
    }
  } catch (e) {
    // 拉取失败保留空态文案（绝不回退假数据）；具体错误由统一封装 toast
  }
}
onShow(loadRejectInfo)

const appealText = ref('')
const submitting = ref(false)
const submit = async () => {
  if (submitting.value) return
  submitting.value = true
  try {
    // 统一封装提交（自带 /api/v1 前缀 + Authorization/X-Role 头 + 业务错误 toast）
    const r = await buyerApi.submitAppeal({ text: appealText.value })
    // 键名与全仓统一为 accountStatus（原误写 account_status 无人读取，状态永不同步）；
    // 值用后端返回（申诉成功 → 回到待审核 1），异常时兜底 1 与后端语义一致
    uni.setStorageSync('accountStatus', r && r.accountStatus !== undefined ? r.accountStatus : 1)
    uni.showToast({ title: '申诉已提交，等待运营复核', icon: 'success' })
    setTimeout(() => uni.reLaunch({ url: '/pages/buyer/pending-verify' }), 800)
  } catch (e) {
    // 业务错误/网络错误统一封装已弹明确提示（request.js），此处兜底防静默失败
    if (!e || (!e.msg && !e.errMsg)) {
      uni.showToast({ title: '申诉提交失败，请稍后重试', icon: 'none' })
    }
  } finally {
    submitting.value = false
  }
}
const fixInfo = () => uni.reLaunch({ url: '/pages/buyer/register' })
</script>

<style lang="scss" scoped>
/* 原 .vue 只有结构没有样式（类全仓无定义，页面裸奔），此处按原型补齐 */
.container {
  min-height: 100vh;
  background: $bg-page;
  padding: 16px;
  box-sizing: border-box;
}
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 0 20px;
}
.big-emoji { font-size: 56px; }
.title {
  margin-top: 12px;
  font-size: 20px;
  font-weight: 700;
}
.sub {
  margin-top: 8px;
  font-size: 13px;
  color: $text-second;
}
.card {
  background: $bg-card;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 14px;
}
.card-title {
  display: block;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 10px;
}
.reason-row {
  display: flex;
  padding: 4px 0;
  font-size: 14px;
  line-height: 1.6;
}
.reason-row .k { color: $text-second; flex-shrink: 0; }
.reason-row .v { color: $text-title; flex: 1; min-width: 0; }
.warn {
  background: #FFF7E8;
  border: 1px solid #FFE4BA;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #B26A00;
  margin-bottom: 12px;
  line-height: 1.6;
}
.ipt {
  width: 100%;
  background: $bg-soft;
  border: 1px solid $border;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  box-sizing: border-box;
}
.btn-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}
.lk-btn-primary,
.lk-btn {
  width: 100%;
  height: 46px;
  line-height: 46px;
  border-radius: 23px;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  border: none;
}
.lk-btn-primary {
  background: $brand;
  color: #fff;
  &[disabled] { opacity: 0.5; color: #fff; background: $brand; }
}
.lk-btn {
  background: $bg-soft;
  color: $text-body;
}
.footer-tip {
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: $text-placeholder;
}
</style>
