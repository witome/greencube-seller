<template>
  <view class="page">
    <view class="hero">
      <view class="title">🍃 欢迎注册绿立方</view>
      <view class="sub">请如实填写餐馆信息，工作人员将在 24 小时内联系您核实</view>
    </view>

    <view class="notice">⚠️ 同一手机号 30 天内最多注册 2 次；同一营业执照仅可注册 1 次</view>

    <!-- 必填信息 -->
    <view class="card">
      <view class="card-title">📋 必填信息</view>
      <view class="form-row">
        <view class="fr-l">餐馆名称</view>
        <input class="ipt" v-model="form.shopName" placeholder="需与营业执照一致" />
      </view>
      <view class="form-row">
        <view class="fr-l">联系人</view>
        <input class="ipt" v-model="form.contact" placeholder="老板/采购员姓名" />
      </view>
      <view class="form-row">
        <view class="fr-l">手机号</view>
        <input class="ipt" v-model="form.phone" type="number" maxlength="11" placeholder="11 位手机号" />
      </view>
      <view class="form-row">
        <view class="fr-l">收货地址</view>
        <input class="ipt" v-model="form.address" placeholder="详细到门牌号" />
      </view>
      <view class="form-row">
        <view class="fr-l">配送时段</view>
        <view class="chip-group">
          <view
            v-for="w in windows"
            :key="w"
            :class="['chip', { on: form.deliveryWindows.includes(w) }]"
            @tap="toggleWindow(w)"
          >{{ w }}</view>
        </view>
      </view>
    </view>

    <!-- 资质（选填） -->
    <view class="card">
      <view class="card-title">📎 资质信息（选填，加速审核）</view>
      <view class="form-row">
        <view class="fr-l">营业执照号</view>
        <input class="ipt" v-model="form.businessLicenseNo" placeholder="统一社会信用代码" />
      </view>
      <view class="form-tip">图片资质可在审核通过后于「我的」页面补充上传</view>
    </view>

    <!-- 协议 -->
    <view class="card agree" @tap="agreed = !agreed">
      <view class="agree-box">
        <view :class="['cb', { on: agreed }]">{{ agreed ? '✓' : '' }}</view>
        <text class="agree-text">我已阅读并同意《用户协议》《隐私政策》，承诺所填信息真实有效</text>
      </view>
    </view>

    <view class="row-btns">
      <view :class="['pbtn', 'primary', { disabled: !canSubmit }]" @tap="submit">提交注册</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { buyerApi } from '@/api/modules'

const form = ref({
  shopName: '',
  contact: '',
  phone: '',
  address: '',
  deliveryWindows: ['中 10-13'],
  businessLicenseNo: '',
})
const windows = ['早 05-08', '中 10-13', '晚 16-19']
const agreed = ref(false)
const submitting = ref(false)

const toggleWindow = (w) => {
  const arr = form.value.deliveryWindows
  const i = arr.indexOf(w)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(w)
}

const canSubmit = computed(
  () =>
    form.value.shopName &&
    form.value.contact &&
    /^1\d{10}$/.test(form.value.phone) &&
    form.value.address &&
    agreed.value &&
    !submitting.value,
)

const submit = async () => {
  if (!canSubmit.value) {
    if (!agreed.value) uni.showToast({ title: '请先勾选同意协议', icon: 'none' })
    else if (!/^1\d{10}$/.test(form.value.phone)) uni.showToast({ title: '手机号格式错误', icon: 'none' })
    else uni.showToast({ title: '请填写完整信息', icon: 'none' })
    return
  }
  submitting.value = true
  try {
    await buyerApi.register(form.value)
    uni.setStorageSync('accountStatus', 1)
    uni.reLaunch({ url: '/pages/buyer/pending-verify' })
  } catch (e) {
    // 错误已由 request.js 统一提示
  } finally {
    submitting.value = false
  }
}
</script>

<style lang="scss" scoped>
.hero { padding: 6px 2px 14px; }
.title { font-size: 20px; font-weight: 700; color: $text-title; }
.sub { font-size: 13px; color: $text-second; margin-top: 6px; }
.notice {
  background: #fff8ec;
  color: #ff8f1f;
  font-size: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
}
.form-row {
  display: flex;
  align-items: flex-start;
  padding: 12px 0;
  border-bottom: 1px solid $bg-soft;
}
.fr-l {
  width: 88px;
  font-size: 14px;
  color: $text-title;
  flex-shrink: 0;
  padding-top: 2px;
}
.ipt {
  flex: 1;
  font-size: 14px;
  color: $text-body;
}
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; }
.chip {
  padding: 5px 12px;
  border-radius: 14px;
  background: $bg-soft;
  font-size: 12px;
  color: $text-second;
}
.chip.on { background: $brand-soft; color: $brand-deep; font-weight: 600; }
.form-tip { font-size: 12px; color: $text-placeholder; padding-top: 10px; }
.agree { margin-top: 12px; }
.agree-box { display: flex; align-items: center; gap: 8px; }
.cb {
  width: 18px;
  height: 18px;
  border: 1px solid #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #fff;
  flex-shrink: 0;
}
.cb.on { background: $brand; border-color: $brand; }
.agree-text { font-size: 12px; color: $text-second; }
.disabled { opacity: 0.5; }
</style>
