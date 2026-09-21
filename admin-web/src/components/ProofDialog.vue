<!--
  收款凭证查看弹窗（只读）
  卡T（2026-09-21）：从 OrderFulfill.vue 原样抽出为共享组件，
  履约页「已送达」与每日对账页「当天订单清单」共用同一套实现，避免两处各写一份。
  用法：<ProofDialog v-model="show" :order-id="row.orderId" :pay-proof="row.payProof" />
  上传返回的是相对路径 /uploads/xxx：开发走 vite 代理、生产与 API 同源（api.hsfresh.com），直接用即可
-->
<template>
  <el-dialog :model-value="modelValue" :title="`订单 #${orderId} 收款凭证`" width="520px" @update:model-value="(v) => emit('update:modelValue', v)">
    <div v-if="photos.length" class="proof-grid">
      <el-image
        v-for="(p, i) in photos"
        :key="i"
        :src="p"
        :preview-src-list="photos"
        :initial-index="i"
        fit="cover"
        class="proof-img"
      />
    </div>
    <div v-else style="color:#909399;text-align:center;padding:16px 0;">未留证</div>
    <div v-if="payProof?.paidAt" style="margin-top:10px;font-size:12px;color:#909399;">
      收款时间：{{ fmtTime(payProof.paidAt) }}（配送员确认收款时拍摄）
    </div>
  </el-dialog>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  orderId: { type: [Number, String], default: '' },
  payProof: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

const photos = computed(() => props.payProof?.photos || [])

function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<style scoped>
.proof-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.proof-img {
  width: 220px;
  height: 220px;
  border-radius: 8px;
  cursor: zoom-in;
}
</style>
