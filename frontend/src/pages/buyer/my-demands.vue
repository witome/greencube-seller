<template>
  <view class="buyer-demands-page">
    <!-- 说明 -->
    <view class="buyer-demands-notice">
      📩 这里是你跟智能助手说过、但我们还没上架的菜。<br>
      已帮你记下了，采购回来会通知你；已到货的可以直接下单。
    </view>

    <!-- 补授权：没授权过（或额度用完了）时给一个入口。
         模板未配置（运营还没申请到货通知模板）时**整块不显示** —— 不给点不出结果的按钮。 -->
    <view v-if="templateConfigured && !allNotified" class="buyer-demands-sub-card">
      <view class="buyer-demands-sub-main">
        <view class="buyer-demands-sub-t">🔔 开启到货通知</view>
        <view class="buyer-demands-sub-d">开启后，你要的菜一到货，微信会直接通知你</view>
      </view>
      <view class="buyer-demands-sub-btn" :class="{ done: subscribing }" @tap="onSubscribe">
        {{ subscribing ? '处理中…' : '开启' }}
      </view>
    </view>

    <!-- 加载中 -->
    <view v-if="loading" class="buyer-demands-empty">加载中…</view>

    <!-- 加载失败（必须给可见反馈 + 复位 loading，见仓库约定「坑 9」） -->
    <view v-else-if="loadError" class="buyer-demands-empty buyer-demands-retry" @tap="load">
      <text>{{ loadError }}</text>
      <text class="buyer-demands-retry-btn">点击重试</text>
    </view>

    <!-- 空 -->
    <view v-else-if="!list.length" class="buyer-demands-empty">
      还没有记录～<br>在智能助手里说一句想买的菜，没上架的会自动帮你记下来。
    </view>

    <!-- 列表 -->
    <view v-else class="buyer-demands-list">
      <view v-for="d in list" :key="d.id" class="buyer-demands-item">
        <view class="buyer-demands-item-head">
          <text class="buyer-demands-item-name">{{ d.name }}</text>
          <text :class="['buyer-demands-tag', statusClass(d.status)]">{{ d.statusText }}</text>
        </view>
        <view class="buyer-demands-item-sub">
          <text>要说 {{ d.demandCount }} 次 · 最近 {{ fmtTime(d.lastAt) }}</text>
        </view>
        <view class="buyer-demands-item-foot">
          <text v-if="d.notified" class="buyer-demands-notified">📩 已通知你到货</text>
          <text v-else-if="d.status === 2" class="buyer-demands-arrived">✅ 已到货，可在商品列表下单</text>
          <text v-else class="buyer-demands-pending">到货后会通知你</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { demandApi } from '@/api/modules'
import { guardBuyerSuspended } from '@/utils/account-guard'

const list = ref([])
const loading = ref(false)
const loadError = ref('')
const templateConfigured = ref(false)
const subscribing = ref(false)

const allNotified = computed(() => list.value.length > 0 && list.value.every((d) => d.notified))

// ⚠️ 仓库约定（坑 9）：loading 必须 try/catch/finally 兜底，否则请求一抛错页面永久停在「加载中」；
//    并且要在 onShow 里补一次，否则切走再切回来还是失败态。
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await demandApi.mine()
    list.value = data.list || []
    templateConfigured.value = !!data.templateConfigured
  } catch (e) {
    loadError.value = '加载失败，请检查网络后重试'
  } finally {
    loading.value = false
  }
}

onShow(async () => {
  // 卡AA：账号被运营停用（accountStatus=5）→ reLaunch 停用提示页，本页不再加载
  if (await guardBuyerSuspended()) return
  if (loadError.value && !loading.value) load()
})

/** 补授权：与 kefu 页同一套流程（授权只在客户端发生，结果必须报给服务端） */
async function onSubscribe() {
  if (subscribing.value) return
  let tmpl = ''
  try {
    const cfg = await demandApi.subscribeConfig()
    tmpl = cfg && cfg.configured ? cfg.templateId || '' : ''
  } catch (e) {
    tmpl = ''
  }
  if (!tmpl) {
    uni.showToast({ title: '运营还没配置到货通知模板', icon: 'none' })
    return
  }
  if (typeof uni.requestSubscribeMessage !== 'function') {
    uni.showToast({ title: '请在微信小程序里开启到货通知', icon: 'none' })
    return
  }
  subscribing.value = true
  uni.requestSubscribeMessage({
    tmplIds: [tmpl],
    success: async (res) => {
      const accepted = []
      const rejected = []
      Object.keys(res || {}).forEach((k) => {
        if (k === 'errMsg') return
        if (res[k] === 'accept') accepted.push(k)
        else rejected.push(k)
      })
      try {
        await demandApi.subscribe({ templateId: tmpl, accepted, rejected })
      } catch (e) {
        /* 静默：下次还能再开 */
      }
      uni.showToast({
        title: accepted.length ? '已开启，到货就通知你' : '已取消，可随时再来开',
        icon: 'none',
      })
      subscribing.value = false
      load()
    },
    fail: () => {
      subscribing.value = false
      uni.showToast({ title: '开启失败，请稍后再试', icon: 'none' })
    },
  })
}

const STATUS_CLASS = { 0: 'tag-pending', 1: 'tag-ordered', 2: 'tag-arrived', 3: 'tag-abandoned' }
const statusClass = (s) => STATUS_CLASS[s] || 'tag-pending'

function fmtTime(s) {
  if (!s) return '-'
  const d = new Date(s)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

load()
</script>

<style lang="scss" scoped>
.buyer-demands-page { min-height: 100vh; background: $bg-page; padding: 12px; box-sizing: border-box; }
.buyer-demands-notice {
  background: $brand-soft; color: $brand-deep; font-size: 12px; line-height: 1.8;
  padding: 10px 12px; border-radius: 8px; margin-bottom: 10px;
}

.buyer-demands-sub-card {
  background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 10px;
  display: flex; align-items: center; gap: 10px;
}
.buyer-demands-sub-main { flex: 1; min-width: 0; }
.buyer-demands-sub-t { font-size: 14px; font-weight: 600; color: $text-title; }
.buyer-demands-sub-d { font-size: 11px; color: $text-second; margin-top: 3px; }
.buyer-demands-sub-btn {
  flex: none; background: $brand; color: #fff; font-size: 13px; font-weight: 600;
  padding: 8px 16px; border-radius: 16px;
}
.buyer-demands-sub-btn.done { opacity: 0.6; }

.buyer-demands-empty {
  background: #fff; border-radius: 10px; padding: 40px 16px; text-align: center;
  font-size: 13px; color: $text-second; line-height: 1.9;
}
.buyer-demands-retry { display: flex; flex-direction: column; gap: 8px; }
.buyer-demands-retry-btn { color: $brand; font-weight: 600; }

.buyer-demands-list { display: flex; flex-direction: column; gap: 10px; }
.buyer-demands-item { background: #fff; border-radius: 10px; padding: 12px; }
.buyer-demands-item-head { display: flex; align-items: center; gap: 8px; }
.buyer-demands-item-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: $text-title; }
.buyer-demands-tag { flex: none; font-size: 11px; padding: 2px 8px; border-radius: 10px; }
.tag-pending { background: #FFF4E5; color: #B36B00; }
.tag-ordered { background: #E8F1FF; color: #1A6FD4; }
.tag-arrived { background: $brand-soft; color: $brand-deep; }
.tag-abandoned { background: #F0F1F3; color: #8A9099; }
.buyer-demands-item-sub { font-size: 11px; color: $text-second; margin-top: 6px; }
.buyer-demands-item-foot { margin-top: 8px; font-size: 12px; }
.buyer-demands-notified { color: $brand-deep; }
.buyer-demands-arrived { color: $brand; font-weight: 600; }
.buyer-demands-pending { color: $text-second; }
</style>
