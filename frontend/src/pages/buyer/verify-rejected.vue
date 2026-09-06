<!--
  采购方·驳回申诉页
  对应原型 data-page="verifyRejected"
  用户看到驳回原因，可提交申诉（30 天内仅 1 次）；运营复核后回到 pending 或终态驳回
-->
<template>
  <view class="container">
    <view class="hero">
      <text class="big-emoji">❌</text>
      <text class="title" style="color:#FA5151;">账号未通过审核</text>
      <text class="sub">驳回原因已通过短信通知到您的手机</text>
    </view>

    <view class="card reason">
      <text class="card-title" style="color:#FA5151;">📋 驳回原因</text>
      <view class="reason-row"><text class="k">原因类型：</text><text class="v">{{ reject.reason }}</text></view>
      <view class="reason-row"><text class="k">核实方式：</text><text class="v">{{ reject.method }}</text></view>
      <view class="reason-row"><text class="k">核实时间：</text><text class="v">{{ reject.verifiedAt }}</text></view>
      <view class="reason-row"><text class="k">核实人：</text><text class="v">{{ reject.operator }}</text></view>
    </view>

    <view class="card">
      <view class="warn">⚠️ 30 天内仅可申诉 1 次，请仔细描述真实情况</view>
      <text class="card-title">✍️ 申诉说明</text>
      <textarea class="ipt" v-model="appealText" rows="4" placeholder="请详细说明情况（如：地址应为 XX 路 18 号，原填写有误；附实地照片更佳）"/>
      <view class="form-row">
        <text class="fr-l">补充附件</text>
        <lk-uploader v-model="attachments" :max="5"/>
      </view>
    </view>

    <view class="btn-row">
      <button class="lk-btn-primary" :disabled="!appealText" @tap="submit">提交申诉</button>
      <button class="lk-btn" @tap="fixInfo">✏️ 修改资料</button>
    </view>
    <view class="footer-tip">申诉被驳回后，账号将冻结 60 天，之后可重新注册</view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
const reject = ref({ reason: '地址不实（业务员上门未找到该地址）', method: '上门核实', verifiedAt: '2026-09-05 14:30', operator: '业务员-小张（工号 B003）' })
const appealText = ref('')
const attachments = ref([])
const submit = () => {
  uni.request({ url:'/api/buyer/appeal', method:'POST', data:{ text: appealText.value, attachments: attachments.value }, success: r => {
    if (r.data.code===0) { uni.setStorageSync('account_status','pending'); uni.reLaunch({ url:'/pages/buyer/pending-verify' }) }
  }})
}
const fixInfo = () => uni.reLaunch({ url:'/pages/buyer/register' })
</script>