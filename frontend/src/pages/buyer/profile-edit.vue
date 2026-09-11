<template>
  <view class="bpe-page">
    <!-- ① 餐馆资料（原型：🏪 餐馆资料 · 营业执照/食品经营许可证） -->
    <view class="bpe-card">
      <view class="bpe-card-title">🏪 餐馆资料</view>

      <view class="bpe-field">
        <text class="bpe-label">店名</text>
        <input class="bpe-input" v-model="form.shopName" placeholder="请输入餐馆名称" maxlength="100" />
      </view>
      <view class="bpe-field">
        <text class="bpe-label">联系人</text>
        <input class="bpe-input" v-model="form.contact" placeholder="请输入联系人" maxlength="32" />
      </view>
      <view class="bpe-field">
        <text class="bpe-label">电话</text>
        <input class="bpe-input" v-model="form.phone" type="number" placeholder="11 位手机号" maxlength="11" />
      </view>

      <!-- 资质属准入材料：只读展示，必须运营审核修改 -->
      <view class="bpe-field bpe-field-readonly">
        <text class="bpe-label">营业执照号</text>
        <text class="bpe-readonly-value">{{ form.businessLicenseNo || '未填写' }}</text>
      </view>
      <view class="bpe-field bpe-field-readonly">
        <text class="bpe-label">食品经营许可证</text>
        <text class="bpe-readonly-value">{{ form.permitImg ? '已上传' : '未上传' }}</text>
      </view>
      <view class="bpe-readonly-tip">执照与资质图片需联系运营修改（准入审核材料）</view>
    </view>

    <!-- ② 收货地址（原型：📍 收货地址 · 1 个地址 · 配送时段 07:00-09:00） -->
    <view class="bpe-card">
      <view class="bpe-card-title">📍 收货地址</view>

      <view class="bpe-field">
        <text class="bpe-label">收货地址</text>
        <textarea class="bpe-textarea" v-model="form.address" placeholder="请输入详细收货地址" maxlength="255" :auto-height="true" />
      </view>

      <view class="bpe-field">
        <text class="bpe-label">配送时段</text>
        <view class="bpe-windows">
          <text
            v-for="w in windowOptions"
            :key="w"
            :class="['bpe-window-chip', { 'bpe-window-chip--on': selectedWindows.includes(w) }]"
            @tap="toggleWindow(w)"
          >{{ w }}</text>
        </view>
        <view v-if="customWindows.length" class="bpe-custom-tip">
          <text>已有时段：{{ customWindows.join('、') }}（保留，时段管理接口化后可调整）</text>
        </view>
      </view>
    </view>

    <!-- 保存 -->
    <view class="bpe-save" :class="{ 'bpe-save--disabled': saving }" @tap="save">
      {{ saving ? '保存中…' : '保存' }}
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { buyerApi } from '@/api/modules'

// 可自助修改的 5 个字段（与后端 UpdateBuyerProfileDto 一致）
const form = ref({
  shopName: '',
  contact: '',
  phone: '',
  address: '',
  businessLicenseNo: '', // 只读
  permitImg: '',         // 只读
})
// 预设配送时段（与订单 timeWindow 1/2/3 对应）；DB 里已有非预设值时保留显示、不强制覆盖
const windowOptions = ['早 05-08', '中 10-13', '晚 16-19']
const selectedWindows = ref([])
const initialWindows = ref([])
const customWindows = computed(() => initialWindows.value.filter((w) => !windowOptions.includes(w)))

const loading = ref(true)
const saving = ref(false)

const toggleWindow = (w) => {
  const i = selectedWindows.value.indexOf(w)
  if (i >= 0) selectedWindows.value.splice(i, 1)
  else selectedWindows.value.push(w)
}

const load = async () => {
  loading.value = true
  try {
    const d = await buyerApi.getProfile()
    form.value = {
      shopName: d.shopName || '',
      contact: d.contact || '',
      phone: d.phone || '',
      address: d.address || '',
      businessLicenseNo: d.businessLicenseNo || '',
      permitImg: d.permitImg || '',
    }
    const wins = Array.isArray(d.deliveryWindows) ? d.deliveryWindows : []
    initialWindows.value = wins
    selectedWindows.value = wins.filter((w) => windowOptions.includes(w))
  } catch (e) {
    uni.showToast({ title: '资料加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

const save = async () => {
  if (saving.value) return
  if (!form.value.shopName.trim()) {
    uni.showToast({ title: '店名不能为空', icon: 'none' }); return
  }
  const phone = String(form.value.phone || '').trim()
  if (phone && !/^1\d{10}$/.test(phone)) {
    uni.showToast({ title: '手机号格式错误', icon: 'none' }); return
  }
  // 保留 DB 里的非预设时段，避免自助保存把历史值洗掉
  const deliveryWindows = [...selectedWindows.value, ...customWindows.value]

  saving.value = true
  try {
    await buyerApi.updateProfile({
      shopName: form.value.shopName.trim(),
      contact: form.value.contact.trim(),
      phone: phone || undefined,
      address: form.value.address.trim(),
      deliveryWindows,
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
  uni.setNavigationBarTitle({ title: '餐馆资料与收货地址' })
  load()
})
</script>

<style lang="scss" scoped>
.bpe-page {
  min-height: 100vh;
  background: $bg-page;
  padding: 12px;
  padding-bottom: 90px;
  box-sizing: border-box;
}
.bpe-card {
  background: #fff;
  border-radius: 14px;
  padding: 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.bpe-card-title { font-size: 15px; font-weight: 700; color: $text-title; margin-bottom: 10px; }

.bpe-field { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; }
.bpe-label { width: 84px; flex-shrink: 0; font-size: 13px; color: $text-second; line-height: 36px; }
.bpe-input {
  flex: 1; min-width: 0; height: 36px; font-size: 13px; color: $text-title;
  background: #F7F9FA; border-radius: 8px; padding: 0 10px;
}
.bpe-textarea {
  flex: 1; min-width: 0; min-height: 60px; font-size: 13px; color: $text-title;
  background: #F7F9FA; border-radius: 8px; padding: 8px 10px; width: auto;
}
.bpe-field-readonly { align-items: center; }
.bpe-readonly-value { flex: 1; font-size: 13px; color: $text-placeholder; }
.bpe-readonly-tip { font-size: 11px; color: #B26A00; background: #FFF8EC; border-radius: 8px; padding: 7px 10px; margin-top: 4px; }

.bpe-windows { flex: 1; display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; }
.bpe-window-chip {
  font-size: 12px; padding: 5px 12px; border-radius: 14px;
  background: #F2F4F6; color: $text-second; border: 1px solid transparent;
}
.bpe-window-chip--on { background: $brand-soft; color: $brand-deep; border-color: $brand; font-weight: 600; }
.bpe-custom-tip { width: 100%; font-size: 11px; color: #8A9099; margin-top: 6px; }

.bpe-save {
  position: fixed; left: 12px; right: 12px; bottom: 20px;
  background: $brand; color: #fff; text-align: center;
  border-radius: 12px; padding: 13px; font-size: 15px; font-weight: 700;
}
.bpe-save--disabled { opacity: .6; }
</style>
