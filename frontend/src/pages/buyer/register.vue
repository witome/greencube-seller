<template>
  <view class="page">
    <view class="hero">
      <view class="title">🍃 欢迎注册辉崧鲜配</view>
      <view class="sub">请选择注册身份，填写对应信息，工作人员将在 24 小时内联系核实</view>
    </view>

    <!-- ① 选择注册身份 -->
    <view class="card">
      <view class="card-title">👤 选择注册身份</view>
      <view class="role-group">
        <view v-for="r in roles" :key="r.key" :class="['role-item', { on: role === r.key }]" @tap="role = r.key">
          <view class="role-ico">{{ r.icon }}</view>
          <view class="role-name">{{ r.name }}</view>
        </view>
      </view>
    </view>

    <view class="notice" v-if="role === 'purchaser'">⚠️ 同一手机号 30 天内最多注册 2 次；同一收货地址 30 天内最多 3 个联系人</view>
    <view class="notice" v-else>⚠️ 提交后需运营审核，审核通过方可{{ role === 'supplier' ? '接单供货' : '接单配送' }}</view>

    <!-- ② 采购方（餐馆）表单 -->
    <view class="card" v-if="role === 'purchaser'">
      <view class="card-title">📋 餐馆信息（必填）</view>
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
          <view v-for="w in windows" :key="w" :class="['chip', { on: form.deliveryWindows.includes(w) }]" @tap="toggleWindow(w)">{{ w }}</view>
        </view>
      </view>
    </view>

    <!-- ② 供应商（档口）表单 -->
    <view class="card" v-if="role === 'supplier'">
      <view class="card-title">🥕 档口信息（必填）</view>
      <view class="form-row">
        <view class="fr-l">档口名称</view>
        <input class="ipt" v-model="form.stallName" placeholder="如：陈记蔬菜档" />
      </view>
      <view class="form-row">
        <view class="fr-l">档口地址</view>
        <input class="ipt" v-model="form.stallAddress" placeholder="如：XX菜市场 A 区 12 号档口" />
      </view>
      <view class="form-row">
        <view class="fr-l">联系人</view>
        <input class="ipt" v-model="form.contact" placeholder="负责人姓名" />
      </view>
      <view class="form-row">
        <view class="fr-l">手机号</view>
        <input class="ipt" v-model="form.phone" type="number" maxlength="11" placeholder="11 位手机号" />
      </view>
      <view class="form-row">
        <view class="fr-l">营业执照号</view>
        <input class="ipt" v-model="form.businessLicenseNo" placeholder="选填，加速审核" />
      </view>
      <view class="form-tip">经营品类与资质图片可在审核通过后由运营配置或于「我的」补充</view>
    </view>

    <!-- ② 配送员表单 -->
    <view class="card" v-if="role === 'courier'">
      <view class="card-title">🚚 配送员信息（必填）</view>
      <view class="form-row">
        <view class="fr-l">姓名</view>
        <input class="ipt" v-model="form.name" placeholder="真实姓名" />
      </view>
      <view class="form-row">
        <view class="fr-l">手机号</view>
        <input class="ipt" v-model="form.phone" type="number" maxlength="11" placeholder="11 位手机号" />
      </view>
      <view class="form-row">
        <view class="fr-l">身份证号</view>
        <input class="ipt" v-model="form.idCardNo" placeholder="用于实名，防重复申请" />
      </view>
      <view class="form-row">
        <view class="fr-l">健康证到期</view>
        <picker mode="date" :value="form.healthCertExpiry" @change="onCertChange">
          <text class="ipt picker-link">{{ form.healthCertExpiry || '请选择到期日' }} ▾</text>
        </picker>
      </view>
      <view class="form-row">
        <view class="fr-l">自有车辆</view>
        <view class="chip-group">
          <view :class="['chip', { on: form.ownVehicle === 1 }]" @tap="form.ownVehicle = 1">有自有车辆</view>
          <view :class="['chip', { on: form.ownVehicle === 0 }]" @tap="form.ownVehicle = 0">无自有车辆</view>
        </view>
      </view>
      <view class="form-row" v-if="form.ownVehicle === 1">
        <view class="fr-l">车辆类型</view>
        <view class="chip-group">
          <view v-for="v in vehicleTypes" :key="v.value" :class="['chip', { on: form.vehicleType === v.value }]" @tap="form.vehicleType = v.value">{{ v.label }}</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">驾驶证</view>
        <view class="chip-group">
          <view :class="['chip', { on: form.hasDriverLicense === 1 }]" @tap="form.hasDriverLicense = 1">有驾驶证</view>
          <view :class="['chip', { on: form.hasDriverLicense === 0 }]" @tap="form.hasDriverLicense = 0">无驾驶证</view>
        </view>
      </view>
      <view class="form-row" v-if="form.hasDriverLicense === 1">
        <view class="fr-l">驾驶证类型</view>
        <view class="chip-group">
          <view v-for="lt in licenseTypes" :key="lt" :class="['chip', { on: form.licenseType === lt }]" @tap="form.licenseType = lt">{{ lt }}</view>
        </view>
      </view>
    </view>

    <!-- ③ 协议 -->
    <view class="card agree" @tap="agreed = !agreed">
      <view class="agree-box">
        <view :class="['cb', { on: agreed }]">{{ agreed ? '✓' : '' }}</view>
        <view class="agree-text">我已阅读并同意<text class="doc-link" @tap.stop="openDoc('user')">《用户协议》</text><text class="doc-link" @tap.stop="openDoc('privacy')">《隐私政策》</text>，承诺所填信息真实有效</view>
      </view>
    </view>

    <view class="row-btns">
      <view :class="['pbtn', 'primary', { disabled: !canSubmit }]" @tap="submit">提交注册</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { buyerApi, registerApi } from '@/api/modules'

const openDoc = (type) => {
  uni.navigateTo({ url: `/pages/agreement/index?type=${type}` })
}

const roles = [
  { key: 'purchaser', name: '餐馆采购', icon: '🏪' },
  { key: 'supplier', name: '供应商', icon: '🥕' },
  { key: 'courier', name: '配送员', icon: '🚚' },
]
const role = ref('purchaser')
const windows = ['早 05-08', '中 10-13', '晚 16-19']
const licenseTypes = ['C1', 'C2', 'B2', 'A1', 'A2', 'D']
const vehicleTypes = [
  { value: 1, label: '电动自行车' },
  { value: 2, label: '三轮车' },
  { value: 3, label: '面包车' },
  { value: 4, label: '小货车' },
  { value: 5, label: '其他' },
]

const form = ref({
  // 采购方
  shopName: '', contact: '', phone: '', address: '', businessLicenseNo: '',
  deliveryWindows: ['中 10-13'],
  // 供应商
  stallName: '', stallAddress: '',
  // 配送员
  name: '', idCardNo: '', healthCertExpiry: '', vehicleType: 1,
  ownVehicle: 1, hasDriverLicense: 1, licenseType: 'C1',
})
const agreed = ref(false)
const submitting = ref(false)

const toggleWindow = (w) => {
  const arr = form.value.deliveryWindows
  const i = arr.indexOf(w)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(w)
}
const onCertChange = (e) => { form.value.healthCertExpiry = e.detail.value }

const phoneOk = () => /^1\d{10}$/.test(form.value.phone)

const canSubmit = computed(() => {
  if (!agreed.value || submitting.value || !phoneOk()) return false
  if (role.value === 'purchaser') return !!(form.value.shopName && form.value.contact && form.value.address)
  if (role.value === 'supplier') return !!(form.value.stallName && form.value.contact)
  if (role.value === 'courier') return !!(form.value.name && form.value.idCardNo)
  return false
})

const submit = async () => {
  if (!canSubmit.value) {
    if (!agreed.value) uni.showToast({ title: '请先勾选同意协议', icon: 'none' })
    else if (!phoneOk()) uni.showToast({ title: '手机号格式错误', icon: 'none' })
    else uni.showToast({ title: '请填写完整信息', icon: 'none' })
    return
  }
  submitting.value = true
  try {
    if (role.value === 'purchaser') {
      // 卡BK：采购方不再提交营业执照号（后端字段保留不动）
      const { businessLicenseNo, ...purchaserForm } = form.value
      await buyerApi.register(purchaserForm)
    } else if (role.value === 'supplier') {
      await registerApi.supplier({
        stallName: form.value.stallName,
        address: form.value.stallAddress || undefined,
        contact: form.value.contact,
        phone: form.value.phone,
        businessLicenseNo: form.value.businessLicenseNo || undefined,
      })
    } else {
      await registerApi.courier({
        name: form.value.name,
        phone: form.value.phone,
        idCardNo: form.value.idCardNo,
        healthCertExpiry: form.value.healthCertExpiry || undefined,
        vehicleType: form.value.ownVehicle === 1 ? form.value.vehicleType : undefined,
        ownVehicle: form.value.ownVehicle,
        hasDriverLicense: form.value.hasDriverLicense,
        licenseType: form.value.hasDriverLicense === 1 ? form.value.licenseType : undefined,
      })
    }
    uni.setStorageSync('accountStatus', 1)
    uni.setStorageSync('registeredRole', role.value)
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
.notice { background: #fff8ec; color: #ff8f1f; font-size: 12px; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; }
.role-group { display: flex; gap: 10px; }
.role-item { flex: 1; text-align: center; padding: 14px 4px; border-radius: 10px; background: $bg-soft; border: 1px solid transparent; }
.role-item.on { background: $brand-soft; border-color: $brand; }
.role-ico { font-size: 24px; }
.role-name { font-size: 13px; color: $text-title; margin-top: 4px; font-weight: 600; }
.role-item.on .role-name { color: $brand-deep; }
.form-row { display: flex; align-items: flex-start; padding: 12px 0; border-bottom: 1px solid $bg-soft; }
.fr-l { width: 88px; font-size: 14px; color: $text-title; flex-shrink: 0; padding-top: 14px; }
.ipt { flex: 1; font-size: 14px; color: $text-body; min-height: 44px; height: 44px; line-height: 44px; }
.picker-link { color: $brand; font-weight: 600; }
.chip-group { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; }
.chip { padding: 5px 12px; border-radius: 14px; background: $bg-soft; font-size: 12px; color: $text-second; }
.chip.on { background: $brand-soft; color: $brand-deep; font-weight: 600; }
.form-tip { font-size: 12px; color: $text-placeholder; padding-top: 10px; }
.agree { margin-top: 12px; }
.agree-box { display: flex; align-items: center; gap: 8px; }
.cb { width: 18px; height: 18px; border: 1px solid #ccc; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #fff; flex-shrink: 0; }
.cb.on { background: $brand; border-color: $brand; }
.agree-text { font-size: 12px; color: $text-second; }
.doc-link { color: $brand; display: inline-block; }
.disabled { opacity: 0.5; }
</style>
