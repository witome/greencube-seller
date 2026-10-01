<template>
  <!--
    卡BC（2026-10-01）：从 pages/buyer/cart.vue 的「＋ 添加商品」页内选品弹层**原样抽出**的共享组件。
    分类 / 搜索 / 上架过滤 / 分页 / 加减回调，行为与抽出前一致；全仓只有这一份选品实现。

    ⚠️ 两个调用方共用同一份数据源（buyerApi.getCategories / buyerApi.getGoods）：
       · pages/buyer/cart.vue        —— 加减写服务端草稿（POST /cart、PUT /cart/:id、DELETE /cart/:id）
       · pages/buyer/order-detail.vue —— 加减攒在本地订单明细里，关闭时统一 POST /order/:id/update
    ⚠️ qtyMap 用**普通对象**传（{ [productId]: qty }），不用函数 prop：
       小程序端 props 走 setData 序列化，函数会被丢掉。
  -->
  <view v-if="open" class="pk-mask" @tap="onClose">
    <view class="pk-sheet" @tap.stop>
      <view class="pk-head">
        <text class="pk-title">{{ title }}</text>
        <view class="pk-close" @tap="onClose">✕</view>
      </view>

      <view class="pk-search">
        <input class="pk-input" v-model="pkKeyword" placeholder="搜索商品" confirm-type="search" @confirm="loadPkGoods" />
        <view class="pk-search-btn" @tap="loadPkGoods">搜索</view>
      </view>

      <view class="pk-body">
        <scroll-view scroll-y class="pk-cate">
          <view :class="['pk-cate-item', { on: pkCate === 0 }]" @tap="switchPkCate(0)">全部</view>
          <view v-for="c in categories" :key="c.id" :class="['pk-cate-item', { on: pkCate === c.id }]" @tap="switchPkCate(c.id)">{{ c.name }}</view>
        </scroll-view>

        <scroll-view scroll-y class="pk-list">
          <view v-for="g in pickerGoods" :key="g.id" class="pk-row">
            <view class="pk-info">
              <view class="pk-name">{{ g.name }}</view>
              <view class="pk-spec">{{ g.specText || (g.weighType === 1 ? '称重' : '固定规格') }}</view>
              <view class="pk-price">¥{{ money(g.salePrice) }}/{{ g.unit }}</view>
            </view>
            <view v-if="qtyOf(g.id)" class="pk-stepper">
              <view class="st-btn" @tap="onDec(g)">−</view>
              <text class="pk-qty">{{ qtyOf(g.id) }}</text>
              <view class="st-btn" @tap="onAdd(g)">＋</view>
            </view>
            <view v-else class="pk-add" @tap="onAdd(g)">＋</view>
          </view>
          <view v-if="pkLoading" class="empty-tip">加载中…</view>
          <view v-else-if="!pickerGoods.length" class="empty-tip">暂无商品</view>
        </scroll-view>
      </view>

      <view class="pk-foot">
        <text class="pk-foot-txt">{{ footText }}</text>
        <view class="pbtn primary" @tap="onClose">{{ doneText }}</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'
import { buyerApi } from '@/api/modules'

const props = defineProps({
  /** 弹层开关（父级持有，组件内状态跨开关保留 —— 与抽出前 cart.vue 的行为一致） */
  open: { type: Boolean, default: false },
  /** 弹层标题：草稿页「添加商品」/ 订单详情「加菜」 */
  title: { type: String, default: '添加商品' },
  /** 底部按钮文案 */
  doneText: { type: String, default: '完成' },
  /** 底部左侧文案：由调用方给（金额一律用服务端数，组件不算价） */
  footText: { type: String, default: '' },
  /** 当前各商品已选数量 { [productId]: qty }；没有的就是 0（渲染「＋」而非步进器） */
  qtyMap: { type: Object, default: () => ({}) },
})

const emit = defineEmits(['close', 'add', 'dec'])

/** 金额一律渲染服务端给的数（salePrice），前端不算价 */
const money = (v) => (Number(v) || 0).toFixed(2)

const qtyOf = (id) => Number(props.qtyMap[id]) || 0

const onClose = () => emit('close')
const onAdd = (g) => emit('add', g)
const onDec = (g) => emit('dec', g)

const categories = ref([])
const pickerGoods = ref([])
const pkCate = ref(0)
const pkKeyword = ref('')
const pkLoading = ref(false)

const loadPkGoods = async () => {
  pkLoading.value = true
  // ⚠️ 只传有值的字段：小程序端会把 undefined 序列化成字符串 "undefined"，导致后端误当搜索词
  const params = { page: 1, pageSize: 50 }
  if (pkCate.value) params.categoryId = pkCate.value
  if (pkKeyword.value) params.keyword = pkKeyword.value
  try {
    const data = await buyerApi.getGoods(params)
    pickerGoods.value = data.list || []
  } catch (e) {
    pickerGoods.value = []
  }
  pkLoading.value = false
}

const switchPkCate = (id) => { pkCate.value = id; loadPkGoods() }

// 打开时按需拉一次分类与商品（与抽出前 openPicker 的条件完全一致：空才拉）
watch(
  () => props.open,
  (v) => {
    if (!v) return
    if (!categories.value.length) {
      buyerApi
        .getCategories()
        .then((list) => { categories.value = list || [] })
        .catch(() => { categories.value = [] })
    }
    if (!pickerGoods.value.length) loadPkGoods()
  },
)
</script>

<style lang="scss" scoped>
/* 卡BC：原 cart.vue 弹层样式整段搬来（scoped 只作用于本组件内部，父级样式管不到子元素）。
   z-index 必须高于自定义 tabBar（999），否则底部「完成」条会被压住 */
.pk-mask {
  position: fixed; top: 0; right: 0; bottom: 0; left: 0; background: rgba(0, 0, 0, .45);
  z-index: 1000; display: flex; align-items: flex-end;
}
.pk-sheet {
  width: 100%; height: 76vh; background: #fff; border-radius: 14px 14px 0 0;
  display: flex; flex-direction: column; overflow: hidden;
}
.pk-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid #F5F6F8; flex: 0 0 auto; }
.pk-title { font-size: 15px; font-weight: 700; color: $text-title; }
.pk-close { display: inline; color: $text-placeholder; font-size: 16px; padding: 0 4px; }
.pk-search { display: flex; align-items: center; gap: 8px; padding: 8px 14px; flex: 0 0 auto; }
.pk-input { flex: 1; background: $bg-page; border-radius: 16px; padding: 7px 13px; font-size: 12.5px; }
.pk-search-btn { display: inline; font-size: 13px; color: $brand; font-weight: 600; flex-shrink: 0; }
.pk-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }
.pk-cate { width: 82px; background: #F7F8FA; height: 100%; flex-shrink: 0; }
.pk-cate-item { padding: 12px 6px; font-size: 12px; color: $text-second; text-align: center; }
.pk-cate-item.on { background: #fff; color: $brand; font-weight: 700; }
.pk-list { flex: 1; min-width: 0; height: 100%; padding: 4px 12px; box-sizing: border-box; }
.pk-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #F5F6F8; }
.pk-info { flex: 1; min-width: 0; }
.pk-name { font-size: 13px; font-weight: 600; color: $text-title; }
.pk-spec { font-size: 10px; color: $text-second; margin-top: 2px; overflow: hidden; white-space: nowrap; }
.pk-price { font-size: 12px; color: $danger; font-weight: 700; margin-top: 2px; }
.pk-stepper { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
.st-btn {
  width: 24px; height: 24px; border-radius: 50%; border: 1px solid $border-strong; background: #fff;
  font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; color: $text-body;
}
.pk-qty { min-width: 20px; text-align: center; font-size: 12.5px; font-weight: 700; color: $text-title; }
.pk-add {
  width: 26px; height: 26px; border-radius: 50%; background: $brand; color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
}
.pk-foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid $border; flex: 0 0 auto; }
.pk-foot-txt { flex: 1; font-size: 12px; color: $text-second; }
.pbtn { flex: none; border-radius: 10px; padding: 9px 20px; text-align: center; font-size: 13.5px; font-weight: 700; }
.pbtn.primary { background: $brand; color: #fff; }
.empty-tip { text-align: center; color: $text-placeholder; padding: 24px 0; font-size: 13px; }
</style>
