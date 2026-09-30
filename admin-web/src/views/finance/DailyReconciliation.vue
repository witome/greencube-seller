<template>
  <div class="admin-dailyrec-page">
    <!-- 面包屑 -->
    <div class="admin-dailyrec-crumb">资金结算 / 每日对账</div>

    <!-- 日期选择 -->
    <el-card shadow="never" class="admin-dailyrec-filter-card">
      <div class="admin-dailyrec-filter">
        <span class="admin-dailyrec-filter-lbl">对账日期（按送达日）</span>
        <el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          style="width: 160px"
          @change="load"
        />
        <el-button type="primary" style="margin-left: 12px" :loading="loading" @click="load">查询</el-button>
        <el-button @click="shiftDay(-1)">前一天</el-button>
        <el-button @click="shiftDay(1)">后一天</el-button>
        <span class="admin-dailyrec-filter-tip">口径：今天送的货，今天该收的钱（只统计已送达/已完成的订单）</span>
      </div>
    </el-card>

    <!-- 五张汇总卡 -->
    <div class="admin-dailyrec-cards">
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">应收</div>
        <div class="admin-dailyrec-card-num">¥{{ fmt(data?.summary?.receivable) }}</div>
        <div class="admin-dailyrec-card-sub">{{ data?.summary?.orderCount ?? 0 }} 单（已送达/已完成）</div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">实收</div>
        <div class="admin-dailyrec-card-num admin-dailyrec-num-green">¥{{ fmt(data?.summary?.received) }}</div>
        <!-- 卡S2：汇总口径与新三档一致（字段名 wechatPaidCount/codPaidCount 沿用，语义 = 新三档计数） -->
        <div class="admin-dailyrec-card-sub">已付款·微信直接支付 {{ data?.summary?.wechatPaidCount ?? 0 }} 单 · 已付款·扫码付款 {{ data?.summary?.codPaidCount ?? 0 }} 单</div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">未收</div>
        <div class="admin-dailyrec-card-num admin-dailyrec-num-red">¥{{ fmt(data?.summary?.unpaid) }}</div>
        <div class="admin-dailyrec-card-sub">待收款（COD 已送达未收）{{ data?.summary?.codUnpaidCount ?? 0 }} 单</div>
        <!-- 卡AH（2026-09-30）：只是「为什么没收」的**注解** —— 🔴 不进上面的未收金额（钱一分不动） -->
        <div
          class="admin-dailyrec-card-sub"
          :class="data?.summary?.unpaidMarkedCount ? 'admin-dailyrec-sub-red' : ''"
        >
          🔴 其中配送员已标记未收款 {{ data?.summary?.unpaidMarkedCount ?? 0 }} 单 · ¥{{ fmt(data?.summary?.unpaidMarkedAmount) }}
        </div>
      </div>
      <div class="admin-dailyrec-card">
        <div class="admin-dailyrec-card-lbl">应付供应商（参考值）</div>
        <div class="admin-dailyrec-card-num">¥{{ fmt(data?.summary?.supplierPayable) }}</div>
        <div class="admin-dailyrec-card-sub">Σ 验收数量 × 供货价 · 正式结算仍按月</div>
      </div>
      <div class="admin-dailyrec-card">
        <!-- 毛利粗算口径（2026-09-19 拍板修正）：原口径=实收−应付供应商，当天款没收回必然为负
             （线上实测 -84.84），易误读成亏钱；改为 应收−应付供应商，不随收款进度变化 -->
        <div class="admin-dailyrec-card-lbl">毛利粗算（应收 − 应付供应商）</div>
        <div class="admin-dailyrec-card-num" :class="(data?.summary?.grossProfit ?? 0) >= 0 ? 'admin-dailyrec-num-green' : 'admin-dailyrec-num-red'">
          ¥{{ fmt(data?.summary?.grossProfit) }}
        </div>
        <div class="admin-dailyrec-card-sub">未扣配送成本/平台服务费/退款</div>
      </div>
    </div>

    <!-- 口径说明 -->
    <el-alert type="info" :closable="false" show-icon class="admin-dailyrec-notice"
      title="口径说明：应收 = amountFinal（未核单时回退 amountOrdered + 运费）；实收 = 已支付微信流水 + 有收款凭证的货到付款单；毛利粗算 = 应收 − 应付供应商参考值（未扣配送成本/平台服务费/退款）；应付供应商与毛利为参考值，正式结算以按月结算单为准。"
    />

    <!-- 当天订单清单（卡T 2026-09-21：由「未收款清单」升级——默认显示全部当天订单，
         每行可就地看收款状态与收款凭证照片，不必再切到履约页） -->
    <el-card shadow="never" class="admin-dailyrec-table-card">
      <template #header>
        <div class="admin-dailyrec-cardhead">
          <span>当天订单清单（已送达 / 已完成）</span>
          <div class="admin-dailyrec-cardhead-right">
            <el-checkbox v-model="onlyUnpaid" class="admin-dailyrec-onlyunpaid">只看未收款</el-checkbox>
            <!-- 卡AH：只看已标记未收款（标记仍生效、未被线上到账覆盖） -->
            <el-checkbox v-model="onlyMarked" class="admin-dailyrec-onlyunpaid">只看已标记未收款</el-checkbox>
            <el-button size="small" @click="copyList">复制清单</el-button>
            <el-button size="small" type="primary" @click="exportCsv">导出 CSV</el-button>
          </div>
        </div>
      </template>
      <div class="admin-dailyrec-tabletip">
        「收款状态」判定与上方『实收』同源（唯一实现 = 后端 pay-status.util，卡S2 收口为三档）：
        <b>已付款 · 微信直接支付</b>＝该单存在已支付的微信支付流水（不论下单时选的哪种付款方式；退款后自动回退）；
        <b>已付款 · 扫码付款</b>＝配送员已提交现金收款凭证（payProof.photos 非空）且无线上到账；
        <b>未收</b>＝两者都没有（COD 已送达未收的会带「待收款」子标注）。
        ⚠️ 线上到账与现金核销是<b>两条钱路</b>（前者进商户号线上账户、后者进收款码绑定账户），后台不做合并；
        同一行两条并存时会标出「可能重复收款」警示，请人工核对。
        老数据里采购方点过「我已付款」的订单只留「曾称已付（历史口径）」只读标注，<b>不代表钱已到账、不参与金额计算</b>。
        <br />
        <b>收款标记</b>（卡AH）＝配送员显式标记「<b>客户未付款</b>」：红色行 = 标记仍生效（这单当面没收到钱），
        <b>不代表已销账</b>、不进任何金额口径；客户之后线上付款 → 标记自动失效（只留历史痕迹），无需人工清理。
      </div>
      <el-table :data="shownList" v-loading="loading" stripe empty-text="这一天没有订单" :row-class-name="rowClassName">
        <el-table-column prop="orderId" label="订单号" width="90">
          <template #default="{ row }">#{{ row.orderId }}</template>
        </el-table-column>
        <el-table-column prop="shopName" label="餐馆" min-width="150" show-overflow-tooltip />
        <el-table-column prop="courierName" label="配送员" width="120" show-overflow-tooltip />
        <!-- 应收：口径与汇总卡一致 = amountFinal ?? (amountOrdered + deliveryFee) -->
        <el-table-column label="应收" width="110">
          <template #default="{ row }">¥{{ fmt(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="未收" width="110">
          <template #default="{ row }">
            <span :class="row.unpaid > 0 ? 'admin-dailyrec-num-red' : 'admin-dailyrec-num-green'">
              {{ row.unpaid > 0 ? '¥' + fmt(row.unpaid) : '已收清' }}
            </span>
          </template>
        </el-table-column>
        <!-- 收款状态（卡S2 三档收口）：tag 文案/子标注/警示文案全部来自后端，页面零判定
             卡AH（2026-09-30）：被配送员标记「客户未付款」且标记仍生效的行 → 红标 + 标记时间/备注；
             标记已被线上到账覆盖的 → 仍走正常三档，另加一行灰色历史痕迹。 -->
        <el-table-column label="收款状态" width="220">
          <template #default="{ row }">
            <template v-if="row.unpaidMarkEffective">
              <el-tag type="danger" size="small" effect="light" style="font-size: 9.5px">🔴 配送员已标记未收款</el-tag>
              <div class="admin-dailyrec-marktime">
                标记 {{ fmtTime(row.unpaidMarkedAt) }}<template v-if="row.unpaidMarkRemark"> · {{ row.unpaidMarkRemark }}</template>
              </div>
            </template>
            <template v-else>
              <el-tag :type="payTagType(row.payStatus)" size="small" effect="light">{{ row.payStatusGroupText || row.payStatusText }}</el-tag>
              <div v-if="row.payStatusSubText" class="admin-dailyrec-paynote">{{ row.payStatusSubText }}</div>
              <!-- 卡S1：货到付款单也可能在**线上**付掉（送达后「微信直接支付」）→ 直接标出线上到账金额 -->
              <div v-if="row.payMethod === 2 && row.wechatPaidAmount > 0" class="admin-dailyrec-paynote">线上到账 ¥{{ fmt(row.wechatPaidAmount) }}</div>
              <!-- 卡S2：两条钱路并存 = 可能重复收款（防重复收款是本次收口的目的之一） -->
              <div v-if="row.duplicateRisk" class="admin-dailyrec-paywarn">{{ row.duplicateWarnText }}</div>
              <!-- 卡S2：老数据「客户称已付」只留历史口径只读标注，不参与金额计算 -->
              <div v-if="row.historicClaimText" class="admin-dailyrec-paynote">{{ row.historicClaimText }}</div>
            </template>
            <!-- 卡AH：已被线上支付覆盖 → 标记自动失效，只留历史痕迹（不参与金额） -->
            <div v-if="row.unpaidMarked && row.unpaidMarkOverridden" class="admin-dailyrec-paynote">
              曾标记未收款 {{ fmtTime(row.unpaidMarkedAt) }}（已由线上支付覆盖，标记自动失效）
            </div>
          </template>
        </el-table-column>
        <!-- 收款凭证（配送员 COD 收款拍照，只读查看）：弹窗实现复用 components/ProofDialog.vue -->
        <el-table-column label="收款凭证" width="110">
          <template #default="{ row }">
            <el-button v-if="row.payProof?.photos?.length" type="primary" link @click="openProof(row)">📷 凭证({{ row.payProof.photos.length }})</el-button>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="送达" width="105">
          <template #default="{ row }">{{ row.deliveryDate }}（{{ row.timeWindow }}）</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openOrder(row)">看订单</el-button>
            <el-button link @click="goFulfill(row)">去履约页</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 按配送员汇总 -->
    <el-card shadow="never" class="admin-dailyrec-table-card">
      <template #header><span>按配送员汇总</span></template>
      <el-table :data="data?.byCourier ?? []" v-loading="loading" stripe>
        <el-table-column prop="courierName" label="配送员" min-width="130" />
        <el-table-column prop="orderCount" label="送了几单" width="110">
          <template #default="{ row }">{{ row.orderCount }} 单</template>
        </el-table-column>
        <el-table-column label="应收" width="120">
          <template #default="{ row }">¥{{ fmt(row.receivable) }}</template>
        </el-table-column>
        <el-table-column label="已收" width="120">
          <template #default="{ row }">¥{{ fmt(row.received) }}</template>
        </el-table-column>
        <el-table-column label="未收" width="120">
          <template #default="{ row }">
            <span :class="row.unpaid > 0 ? 'admin-dailyrec-num-red' : 'admin-dailyrec-num-green'">¥{{ fmt(row.unpaid) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 按餐馆汇总 -->
    <el-card shadow="never" class="admin-dailyrec-table-card">
      <template #header><span>按餐馆汇总</span></template>
      <el-table :data="data?.byShop ?? []" v-loading="loading" stripe>
        <el-table-column prop="shopName" label="餐馆" min-width="160" show-overflow-tooltip />
        <el-table-column prop="orderCount" label="订单数" width="90" />
        <el-table-column label="应收" width="120">
          <template #default="{ row }">¥{{ fmt(row.receivable) }}</template>
        </el-table-column>
        <el-table-column label="已收" width="120">
          <template #default="{ row }">¥{{ fmt(row.received) }}</template>
        </el-table-column>
        <el-table-column label="未收" width="120">
          <template #default="{ row }">
            <span :class="row.unpaid > 0 ? 'admin-dailyrec-num-red' : 'admin-dailyrec-num-green'">¥{{ fmt(row.unpaid) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 看订单：就地看该单明细（金额拆分 + 收款状态 + 凭证），数据按需拉 /admin/order/:id/detail
         卡T（2026-09-21） -->
    <el-dialog v-model="orderDialog" :title="`订单 #${orderDetail?.orderId ?? ''}`" width="680px">
      <div v-loading="orderLoading">
        <div v-if="orderDetail" class="admin-dailyrec-orderhead">
          <div>餐馆：<b>{{ orderDetail.shopName }}</b></div>
          <div>配送员：{{ orderDetail.courierName || '未指派' }}</div>
          <div>送达：{{ orderDetail.deliveryDate }}（{{ orderDetail.timeWindow }}）</div>
          <div>状态：{{ orderDetail.statusText }}</div>
        </div>
        <div v-if="orderDetail" class="admin-dailyrec-orderamount">
          商品金额 ¥{{ fmt(orderDetail.amountOrdered) }}
          <span class="op">＋</span>
          运费 ¥{{ fmt(orderDetail.deliveryFee) }}
          <span class="op">＝</span>
          应收 <b>¥{{ fmt(orderDetail.receivable) }}</b>
          <span class="note">
            {{ orderDetail.amountFinal != null ? '（已核单：取 amountFinal，已含运费）' : '（未核单：回退 商品金额＋运费）' }}
          </span>
        </div>
        <!-- 卡S2：收款状态判定/文案全部来自后端 pay-status.util（经清单行透传，弹窗不另行判定） -->
        <div v-if="orderDetail" class="admin-dailyrec-orderpay">
          收款状态：
          <el-tag :type="payTagType(orderRow?.payStatus)" size="small">{{ orderRow?.payStatusGroupText || '—' }}</el-tag>
          <span v-if="orderRow?.payStatusSubText" class="note">{{ orderRow.payStatusSubText }}</span>
          <span v-if="orderRow?.wechatPaidAmount > 0" class="note">已支付流水 ¥{{ fmt(orderRow.wechatPaidAmount) }}</span>
          <span v-if="orderRow?.historicClaimText" class="note">{{ orderRow.historicClaimText }}：{{ orderRow.buyerPaidClaimAt }}</span>
          <span v-if="orderRow?.duplicateRisk" class="paywarn">{{ orderRow.duplicateWarnText }}</span>
          <el-button v-if="orderDetail.payProof?.photos?.length" type="primary" link @click="openProof(orderDetail)">📷 看收款凭证({{ orderDetail.payProof.photos.length }})</el-button>
          <span v-else class="note">无收款凭证</span>
        </div>
        <el-table :data="orderDetail?.items || []" size="small" empty-text="暂无明细">
          <el-table-column prop="productName" label="商品" min-width="120">
            <template #default="{ row }">
              {{ row.productName }}
              <div v-if="row.supplierName" style="font-size:11px;color:#909399;">{{ row.supplierName }}</div>
            </template>
          </el-table-column>
          <el-table-column label="订购" width="80">
            <template #default="{ row }">{{ row.qtyOrdered }}{{ row.unit }}</template>
          </el-table-column>
          <el-table-column label="实交(申报)" width="100">
            <template #default="{ row }">{{ row.qtyDeclared ?? row.qtyOrdered }}{{ row.unit }}</template>
          </el-table-column>
          <el-table-column label="验收" width="100">
            <template #default="{ row }">{{ row.qtyAccepted ?? '—' }}{{ row.qtyAccepted != null ? row.unit : '' }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="orderDialog = false">关闭</el-button>
        <el-button type="primary" @click="goFulfill(orderDetail)">在履约页打开</el-button>
      </template>
    </el-dialog>

    <!-- 收款凭证弹窗（共享组件，与订单履约页同一实现） -->
    <ProofDialog v-model="proofDialog" :order-id="proofOrder?.orderId" :pay-proof="proofOrder?.payProof" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { financeAdminApi, orderAdminApi } from '../../api/modules'
// 收款凭证弹窗：与订单履约页共用同一实现（卡T 2026-09-21 由该页抽出）
import ProofDialog from '../../components/ProofDialog.vue'

const route = useRoute()
const router = useRouter()

const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
const date = ref(today())
const data = ref(null)
const loading = ref(false)

const fmt = (n) => (n == null ? '0.00' : Number(n).toFixed(2))

// ── 卡T：当天订单清单（默认全部；勾选后只看未收款 = 应收 − 已收 > 0）──
const onlyUnpaid = ref(false)
// 卡AH（2026-09-30）：只看已标记未收款（标记仍生效、未被线上到账覆盖）
const onlyMarked = ref(false)
const shownList = computed(() => {
  let rows = data.value?.orderList ?? []
  if (onlyUnpaid.value) rows = rows.filter((r) => Number(r.unpaid) > 0)
  if (onlyMarked.value) rows = rows.filter((r) => r.unpaidMarkEffective)
  return rows
})

// 卡AH：被标记未收款的行整行标红（与「收款标记 = 配送员说没收到钱」一致；不代表已销账）
function rowClassName({ row }) {
  return row?.unpaidMarkEffective ? 'marked-unpaid-row' : ''
}

// 卡AH：标记时间展示（后台统一 YYYY-MM-DD HH:mm）
function fmtTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 收款状态色（卡S2 三档）：两种「已付款」用绿（与汇总卡「实收」同色），未收/待收款用红
function payTagType(status) {
  if (status === 'paid_wechat' || status === 'paid_proof') return 'success'
  return 'danger'
}

// ── 收款凭证（只读大图，复用共享组件）──
const proofDialog = ref(false)
const proofOrder = ref(null)
function openProof(row) {
  proofOrder.value = row
  proofDialog.value = true
}

// ── 看订单（就地看该单明细/金额拆分/收款状态；数据按需拉，避免列表接口塞 items）──
const orderDialog = ref(false)
const orderLoading = ref(false)
const orderDetail = ref(null)
// 卡S2：清单行数据（收款状态判定/文案都在行上，弹窗直接引用，不另行请求判定）
const orderRow = ref(null)
async function openOrder(row) {
  orderRow.value = row || null
  orderDialog.value = true
  orderLoading.value = true
  orderDetail.value = null
  try {
    orderDetail.value = await orderAdminApi.getOrderDetail(row.orderId)
  } catch (e) {
    /* 请求封装已统一提示 */
  } finally {
    orderLoading.value = false
  }
}

// 卡T：跳到履约页（带上送达日与订单号，履约页会自动落到「已送达」视图并打开该单明细）
function goFulfill(row) {
  if (!row?.orderId) return
  router.push({
    path: '/order',
    query: { filter: 'delivered', date: date.value, orderId: String(row.orderId) },
  })
}

function shiftDay(d) {
  const dt = new Date(`${date.value}T00:00:00.000Z`)
  dt.setUTCDate(dt.getUTCDate() + d)
  date.value = dt.toISOString().slice(0, 10)
  load()
}

async function load() {
  loading.value = true
  try {
    data.value = await financeAdminApi.getDailyReconciliation({ date: date.value })
  } catch (e) {
    /* 请求封装已统一提示 */
  } finally {
    loading.value = false
  }
}

// 复制/导出都以「当前表格显示的行」为准（勾了只看未收款就只复制未收的那部分）
async function copyList() {
  const rows = shownList.value
  if (!rows.length) return ElMessage.info('当前没有可复制的订单')
  const tsv = [
    '订单号\t餐馆\t配送员\t应收\t未收\t收款状态\t收款凭证\t送达',
    ...rows.map((r) => {
      const proof = r.payProof?.photos?.length ? `凭证${r.payProof.photos.length}张` : '无'
      return `#${r.orderId}\t${r.shopName}\t${r.courierName}\t¥${fmt(r.amount)}\t¥${fmt(r.unpaid)}\t${r.payStatusText}\t${proof}\t${r.deliveryDate}（${r.timeWindow}）`
    }),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(tsv)
    ElMessage.success('清单已复制，可直接粘贴到微信/Excel')
  } catch {
    ElMessage.error('复制失败，请用导出 CSV')
  }
}

function exportCsv() {
  const rows = shownList.value
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [['订单号', '餐馆', '配送员', '应收', '未收', '收款状态', '收款凭证', '送达日', '时段'].join(',')]
  for (const r of rows) {
    const proof = r.payProof?.photos?.length ? `凭证${r.payProof.photos.length}张` : '无'
    lines.push([r.orderId, esc(r.shopName), esc(r.courierName), r.amount, r.unpaid, esc(r.payStatusText), proof, r.deliveryDate, r.timeWindow].join(','))
  }
  // 无订单时也导出汇总，方便留档
  lines.push('')
  lines.push(['汇总'].join(','))
  lines.push(['应收', data.value?.summary?.receivable].join(','))
  lines.push(['实收', data.value?.summary?.received].join(','))
  lines.push(['未收', data.value?.summary?.unpaid].join(','))
  lines.push(['应付供应商(参考值)', data.value?.summary?.supplierPayable].join(','))
  lines.push(['毛利粗算', data.value?.summary?.grossProfit].join(','))
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `每日对账_${date.value}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(() => {
  // 卡T：支持从订单履约页带 ?date= 跳进来（落到这一天，不必再选一次日期）
  const q = route.query.date
  if (typeof q === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q)) date.value = q
  load()
})
</script>

<style scoped>
.admin-dailyrec-page { padding: 0; }
.admin-dailyrec-crumb { color: #909399; font-size: 13px; margin-bottom: 14px; }
.admin-dailyrec-filter-card { margin-bottom: 14px; }
.admin-dailyrec-filter { display: flex; align-items: center; }
.admin-dailyrec-filter-lbl { font-size: 14px; color: #606266; margin-right: 10px; }
.admin-dailyrec-filter-tip { margin-left: auto; color: #c0c4cc; font-size: 12px; }
.admin-dailyrec-cards { display: flex; gap: 12px; margin-bottom: 14px; }
.admin-dailyrec-card { flex: 1; background: #fff; border: 1px solid #ebeef5; border-radius: 8px; padding: 14px 16px; }
.admin-dailyrec-card-lbl { color: #909399; font-size: 13px; margin-bottom: 6px; }
.admin-dailyrec-card-num { font-size: 22px; font-weight: 600; color: #303133; }
.admin-dailyrec-card-sub { color: #c0c4cc; font-size: 12px; margin-top: 6px; }
.admin-dailyrec-num-green { color: #07c160; }
.admin-dailyrec-num-red { color: #fa5151; }
.admin-dailyrec-notice { margin-bottom: 14px; }
.admin-dailyrec-table-card { margin-bottom: 14px; }
.admin-dailyrec-cardhead { display: flex; justify-content: space-between; align-items: center; }
/* 卡T：当天订单清单 */
.admin-dailyrec-cardhead-right { display: flex; align-items: center; gap: 8px; }
.admin-dailyrec-onlyunpaid { margin-right: 4px; }
.admin-dailyrec-tabletip {
  font-size: 12px;
  color: #909399;
  background: #f7f8fa;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
  line-height: 1.7;
}
/* 卡S2：收款状态列的子标注 / 警示 */
.admin-dailyrec-paynote { font-size: 11px; color: #909399; margin-top: 2px; line-height: 1.5; }
.admin-dailyrec-paywarn { font-size: 11px; color: #ff6b00; font-weight: 600; margin-top: 2px; line-height: 1.5; }
/* 卡AH（2026-09-30）：配送员「客户未付款」标记 */
.admin-dailyrec-sub-red { color: #f56c6c !important; font-weight: 700; }
.admin-dailyrec-marktime { font-size: 11px; color: #f56c6c; margin-top: 2px; line-height: 1.5; }
:deep(.marked-unpaid-row) td { background: #fef6f6 !important; }
.admin-dailyrec-orderhead {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 22px;
  font-size: 13px;
  color: #606266;
  margin-bottom: 10px;
}
.admin-dailyrec-orderamount {
  font-size: 13px;
  color: #606266;
  background: #f7f8fa;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 8px;
}
.admin-dailyrec-orderamount .op { color: #909399; margin: 0 4px; }
.admin-dailyrec-orderamount .note { color: #c0c4cc; font-size: 12px; margin-left: 6px; }
.admin-dailyrec-orderpay {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #606266;
  margin-bottom: 12px;
}
.admin-dailyrec-orderpay .note { color: #909399; font-size: 12px; }
.admin-dailyrec-orderpay .paywarn { color: #ff6b00; font-size: 12px; font-weight: 600; }
</style>
