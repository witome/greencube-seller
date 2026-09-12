<template>
  <view class="spe-page">
    <!-- ① 店铺资料（原型：🏪 店铺资料 · 资质证照 + 到期时间；可自助改 4 项，状态只读） -->
    <view class="spe-card">
      <view class="spe-card-title">🏪 店铺资料</view>

      <view class="spe-field">
        <text class="spe-label">档口名称</text>
        <input class="spe-input" v-model="form.stallName" placeholder="请输入档口名称" maxlength="100" />
      </view>
      <view class="spe-field">
        <text class="spe-label">联系人</text>
        <input class="spe-input" v-model="form.contact" placeholder="请输入联系人" maxlength="32" />
      </view>
      <view class="spe-field">
        <text class="spe-label">电话</text>
        <input class="spe-input" v-model="form.phone" type="number" placeholder="11 位手机号" maxlength="11" />
      </view>
      <view class="spe-field">
        <text class="spe-label">档口地址</text>
        <textarea class="spe-textarea" v-model="form.address" placeholder="请输入档口地址（市场内摊位号等）" maxlength="255" :auto-height="true" />
      </view>

      <!-- 合作状态由运营管理：只读 -->
      <view class="spe-field spe-field-readonly">
        <text class="spe-label">合作状态</text>
        <text class="spe-readonly-value">{{ form.statusText }}</text>
      </view>
    </view>

    <!-- ② 资质证照（原型：资质证照 + 到期时间）——只读，准入材料必须运营审核 -->
    <view class="spe-card">
      <view class="spe-card-title">📋 资质证照</view>

      <view class="spe-field spe-field-readonly">
        <text class="spe-label">营业执照</text>
        <text class="spe-readonly-value">{{ form.qualification.businessLicense || '未登记' }}</text>
      </view>
      <view class="spe-field spe-field-readonly">
        <text class="spe-label">检疫合格证</text>
        <text class="spe-readonly-value">{{ form.qualification.quarantineCert || '未登记' }}</text>
      </view>
      <view class="spe-field spe-field-readonly" v-if="form.qualification.businessLicenseExpiry || form.qualification.quarantineCertExpiry">
        <text class="spe-label">证照有效期</text>
        <text class="spe-readonly-value">{{ expiryText }}</text>
      </view>
      <view class="spe-readonly-tip">资质证照需联系运营修改（准入审核材料，供应商不可自助变更）</view>
    </view>

    <!-- 保存 -->
    <view class="spe-save" :class="{ 'spe-save--disabled': saving }" @tap="save">
      {{ saving ? '保存中…' : '保存' }}
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { supplierApi } from '@/api/modules'

// 可自助修改的 4 个字段（与后端 UpdateSupplierProfileDto 一致，字段落点照运营侧 UpdateSupplierDto）
const form = ref({
  stallName: '',
  contact: '',
  phone: '',
  address: '',
  statusText: '',      // 只读
  qualification: {     // 只读
    businessLicense: '',
    quarantineCert: '',
    businessLicenseExpiry: '',
    quarantineCertExpiry: '',
  },
})

const loading = ref(true)
const saving = ref(false)

const expiryText = computed(() => {
  const q = form.value.qualification
  const parts = []
  if (q.businessLicenseExpiry) parts.push(`营业执照 ${q.businessLicenseExpiry} 到期`)
  if (q.quarantineCertExpiry) parts.push(`检疫证 ${q.quarantineCertExpiry} 到期`)
  return parts.join(' · ')
})

const load = async () => {
  loading.value = true
  try {
    const d = await supplierApi.getProfile()
    form.value = {
      stallName: d.stallName || '',
      contact: d.contact || '',
      phone: d.phone || '',
      address: d.address || '',
      statusText: d.statusText || '',
      qualification: {
        businessLicense: d.qualification?.businessLicense || '',
        quarantineCert: d.qualification?.quarantineCert || '',
        businessLicenseExpiry: d.qualification?.businessLicenseExpiry || '',
        quarantineCertExpiry: d.qualification?.quarantineCertExpiry || '',
      },
    }
  } catch (e) {
    uni.showToast({ title: '资料加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

const save = async () => {
  if (saving.value) return
  if (!form.value.stallName.trim()) {
    uni.showToast({ title: '档口名称不能为空', icon: 'none' }); return
  }
  const phone = String(form.value.phone || '').trim()
  if (phone && !/^1\d{10}$/.test(phone)) {
    uni.showToast({ title: '手机号格式错误', icon: 'none' }); return
  }

  saving.value = true
  try {
    await supplierApi.updateProfile({
      stallName: form.value.stallName.trim(),
      contact: form.value.contact.trim(),
      phone: phone || undefined,
      address: form.value.address.trim(),
    })
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 600)
  } catch (e) {
    // 失败：request 层已提示，停留本页
  } finally {
    saving.value = false
  }
}

onLoad(() => {
  uni.setNavigationBarTitle({ title: '店铺资料' })
  load()
})
</script>

<style lang="scss" scoped>
/* 样式对齐采购方 profile-edit（A 卡），同一套信息结构语言 */
.spe-page {
  min-height: 100vh;
  background: $bg-page;
  padding: 12px;
  padding-bottom: 90px;
  box-sizing: border-box;
}
.spe-card {
  background: #fff;
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.spe-card-title { font-size: 15px; font-weight: 700; color: $text-title; margin-bottom: 10px; }

.spe-field { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; }
.spe-label { width: 84px; flex-shrink: 0; font-size: 13px; color: $text-second; line-height: 36px; }
.spe-input {
  flex: 1; min-width: 0; height: 36px; font-size: 13px; color: $text-title;
  background: #F7F9FA; border-radius: 8px; padding: 0 10px;
}
.spe-textarea {
  flex: 1; min-width: 0; min-height: 60px; font-size: 13px; color: $text-title;
  background: #F7F9FA; border-radius: 8px; padding: 8px 10px; width: auto;
}
.spe-field-readonly { align-items: center; }
.spe-readonly-value { flex: 1; font-size: 13px; color: $text-placeholder; }
.spe-readonly-tip { font-size: 11px; color: #B26A00; background: #FFF8EC; border-radius: 8px; padding: 7px 10px; margin-top: 4px; }

.spe-save {
  position: fixed; left: 12px; right: 12px; bottom: 20px;
  background: $brand; color: #fff; text-align: center;
  border-radius: 12px; padding: 13px; font-size: 15px; font-weight: 700;
}
.spe-save--disabled { opacity: .6; }
</style>
