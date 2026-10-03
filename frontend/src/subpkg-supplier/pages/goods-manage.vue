<template>
  <view class="page">
    <!-- 权限边界提示 -->
    <view class="notice">📝 新商品与商品信息变更均需运营审核后生效；日可供量可快速调整、即时生效。销售价由平台维护，您不可见</view>

    <!-- 搜索 + 状态筛选 -->
    <view class="card">
      <input
        v-model="keyword"
        class="ipt"
        placeholder="🔍 搜索我的商品（名称）"
        confirm-type="search"
        @confirm="load"
      />
      <view class="chip-group filter-chips">
        <view
          v-for="f in filters"
          :key="f.key"
          class="chip"
          :class="{ on: f.key === activeFilter }"
          @tap="switchFilter(f.key)"
        >{{ f.label }}</view>
      </view>
    </view>

    <!-- 提交新商品：展开/收起 -->
    <view class="row-btns">
      <view class="pbtn primary" @tap="showForm = !showForm">
        {{ showForm ? '收起表单' : '＋ 提交新商品' }}
      </view>
    </view>
    <view v-if="showForm" class="card">
      <view class="card-title">🆕 提交新商品</view>
      <view class="form-row form-top">
        <view class="fr-l">封面图</view>
        <view class="fr-r">
          <!-- 卡BU：空态拆成两个按钮，来源各自写死（直接拍进相机 / 直接进相册），省掉"选来源"一步 -->
          <view v-if="!formCover && !coverPicking" class="cover-empty">
            <view class="chip-group">
              <view class="chip" @tap="pickFormCover(['camera'])">📷 直接拍</view>
              <view class="chip" @tap="pickFormCover(['album'])">🖼 从相册选</view>
            </view>
            <small>建议实拍：光线好、菜新鲜、别带包装袋</small>
          </view>
          <view v-else>
            <view class="cover-picked">
              <view class="cover-thumb">
                <image v-if="formCover" :src="fullUrl(formCover)" mode="aspectFill" class="cover-thumb-img" />
                <view v-else class="cover-thumb-img cover-loading"></view>
                <view class="cam-badge lg">📷</view>
              </view>
              <view class="cover-meta">
                <view class="cover-meta-t">{{ coverPicking ? '上传中…' : '已选 1 张' }}</view>
                <view class="cover-meta-d">随申请一起提交，走运营审核</view>
              </view>
            </view>
            <!-- 卡BU：已有封面图时，缩略图下方两个入口（重拍=camera / 换一张=album），不再点整块 -->
            <view class="chip-group" style="margin-top: 8px;">
              <view class="chip" @tap="pickFormCover(['camera'])">📷 重拍</view>
              <view class="chip" @tap="pickFormCover(['album'])">🖼 换一张</view>
            </view>
          </view>
          <!-- 卡BP：拍照后 AI 自动识别（loading/成功/失败三态，失败不阻断、留空手填） -->
          <view v-if="aiState === 'loading'" class="ai-flash"><view class="ai-spin"></view>AI 正在识别照片，约 2~3 秒…</view>
          <view v-else-if="aiState === 'done'" class="ai-flash"><text>✨</text> AI 已识别，已帮你填好下面 3 项，请核对</view>
          <view v-else-if="aiState === 'fail'" class="muted" style="margin-top:6px;">AI 没认出这张照片，手动填写也一样能提交</view>
        </view>
      </view>
      <!-- 卡BP：名称 AI 绿底可改；识别后自动预填 -->
      <view class="form-row"><view class="fr-l">商品名称</view><view class="fr-r"><input v-model="form.name" class="ipt" :class="{ 'ipt-ai': aiFilled.name }" placeholder="如：山东大姜（老姜）" @input="aiFilled.name = false" /></view></view>
      <view class="form-row">
        <view class="fr-l">商品分类</view>
        <view class="fr-r">
          <view v-if="catNames.length" class="chip-group">
            <view
              v-for="c in cats"
              :key="c.id"
              class="chip"
              :class="{ on: form.categoryId === c.id }"
              @tap="selectCat(c)"
            >{{ c.name }}</view>
          </view>
          <view v-else class="muted">暂无授权分类，请联系运营开通</view>
          <!-- 卡BP：AI 选中的分类给一句可核对提示（原型口径：认错了点别的分类即可） -->
          <view v-if="aiFilled.category && aiSuggest && form.categoryId === aiSuggest.categoryId" class="muted">AI 选的是「{{ aiSuggest.categoryName }}」，认错了点别的分类即可</view>
        </view>
      </view>
      <view class="form-row">
        <view class="fr-l">计量方式</view>
        <view class="fr-r">
          <view class="chip-group">
            <!-- 卡BV-2（大辉 2026-10-03 拍板 ①B 版）：去掉写死的「斤」—— 计量方式只管怎么卖，单位另起一行选 -->
            <view class="chip" :class="{ on: form.weighType === 1 }" @tap="form.weighType = 1; aiFilled.weigh = false">称重</view>
            <view class="chip" :class="{ on: form.weighType === 2 }" @tap="form.weighType = 2; aiFilled.weigh = false">固定规格</view>
          </view>
        </view>
      </view>
      <!-- 卡BV-2（2026-10-03）：单位（平铺 chip，照「商品分类 / 计量方式」同款样式；
           禁止下拉、禁止 picker、无「其他/手填」—— 单位由后台「计量单位」页维护） -->
      <view class="form-row form-top">
        <view class="fr-l">单位</view>
        <view class="fr-r">
          <view class="chip-group">
            <view
              v-for="u in unitOptions"
              :key="u.name"
              class="chip"
              :class="{ on: form.unit === u.name }"
              @tap="form.unit = u.name"
            >{{ u.name }}<text v-if="u.off" class="chip-off">（已停用）</text></view>
          </view>
          <view class="muted">单位由平台维护，只能从上面选；选好后下面的价格与日供量按单位填</view>
        </view>
      </view>
      <!-- 卡BU：商品备注（≤12 字，随申请走运营审核，显示在买家商品名下方灰字位，与规格说明抢同一行） -->
      <view class="form-row form-top">
        <view class="fr-l">商品备注</view>
        <view class="fr-r">
          <textarea v-model="form.remark" class="ipt ta-remark" :maxlength="12" placeholder="如：今天刚到的老姜，辣味足（可不填）" />
          <view class="muted remark-meta">会显示在采购方商品名下方（灰字），可不填；最多 12 字<text class="remark-count">{{ (form.remark || '').length }}/12</text></view>
        </view>
      </view>
      <!-- 卡BV-2：placeholder 随单位联动（示例值：瓶 → 120 / 50，其余沿用 2.20 / 200） -->
      <view class="form-row"><view class="fr-l">供货价</view><view class="fr-r"><input v-model="form.supplyPrice" class="ipt" type="digit" :placeholder="pricePh" /></view></view>
      <view class="form-row"><view class="fr-l">日可供量</view><view class="fr-r"><input v-model="form.dailySupply" class="ipt" type="digit" :placeholder="supplyPh" /></view></view>
      <!-- 卡Z1：封面图（一期一张，点选可重选）+ 资质证明（真上传，上限5张） -->
      <view class="form-row form-top">
        <view class="fr-l">资质证明</view>
        <view class="fr-r">
          <view class="pic-grid">
            <view v-for="(p, i) in formQual" :key="i" class="pic">
              <image :src="fullUrl(p)" mode="aspectFill" class="pic-img" @tap="previewPhotos(formQual, p)" />
              <view class="pic-x" @tap.stop="formQual.splice(i, 1)">✕</view>
            </view>
            <view v-if="formQual.length < 5" class="pic-add" @tap="addQual">＋</view>
          </view>
          <view class="muted" style="font-size:11px;margin-top:4px;">营业执照、检疫合格证等（肉类/水产必填，最多 5 张，点图可查看）</view>
        </view>
      </view>
      <view class="row-btns">
        <view class="pbtn primary" @tap="submit">提交申请</view>
      </view>
    </view>

    <!-- 我的商品列表 -->
    <view class="section-title">我的商品（{{ goods.length }}）</view>
    <view v-for="g in goods" :key="g.id" class="list-item">
      <!-- 卡Z1：封面缩略图（有 cover 显真图，无 cover 回退 emoji；点相机角标换图，免审即时） -->
      <view class="li-thumb" @tap.stop="onTapCover(g)">
        <image v-if="g.cover" :src="fullUrl(g.cover)" mode="aspectFill" class="li-img" />
        <view v-else class="li-ico" :style="{ background: icoBg(g.status) }">{{ iconOf(g.status) }}</view>
        <view v-if="coverUploadingId === g.id" class="thumb-spin"></view>
        <view class="cam-badge">📷</view>
      </view>
      <view class="li-main">
        <view class="li-t">
          {{ g.name }}
          <!-- 卡Z2：已下架 → 编辑/改库存置灰（点了只给提示，后端本来也会拒）；
               卡BQ：待审核/已驳回两行编辑点亮（绿底描边，照原型屏4），点了走「编辑待审商品」弹层 -->
          <view class="act-link" :class="{ dim: g.status === 'off_shelf', lit: g.status === 'pending' || g.status === 'rejected' }" @tap="tapEdit(g)">✏️ 编辑</view>
          <view class="act-stock" :class="{ dim: g.status === 'off_shelf' }" @tap="tapStock(g)">⚡ 改库存</view>
          <!-- 卡Z2：在售/变更中 → 下架；已下架 → 重新上架；待审核/已驳回（申请态）→ 删除 -->
          <view
            v-if="g.status === 'on_sale' || g.status === 'changing' || g.status === 'off_shelf'"
            class="act-down"
            :class="{ disabled: statusBusyId === g.id }"
            @tap="askToggle(g)"
          >{{ statusBusyId === g.id ? '处理中…' : (g.status === 'off_shelf' ? '⬆ 重新上架' : '⬇ 下架') }}</view>
          <view
            v-else
            class="act-del"
            :class="{ disabled: statusBusyId === g.id }"
            @tap="askDelete(g)"
          >🗑 删除</view>
        </view>
        <view class="li-d">
          供货价 ¥{{ g.supplyPrice }}/{{ g.unit }} · 日供 {{ g.dailySupply }}{{ g.unit }}
          <text v-if="g.changeInfo" style="color:#FF8F1F;"> · 变更中</text>
          <text v-if="g.rejectReason" style="color:#FA5151;"> · {{ g.rejectReason }}</text>
        </view>
      </view>
      <view class="tag" :class="tagType(g.status)">{{ g.statusText }}</view>
    </view>
    <view v-if="!loading && !goods.length" class="empty">暂无商品，点上方「提交新商品」添加</view>

    <!-- 卡Z2：下架/上架/删除 二次确认抽屉（文案照原型④⑥） -->
    <view v-if="confirmTarget" class="mask" @tap="confirmTarget = null">
      <view class="sheet" @tap.stop>
        <view class="sheet-title">
          <template v-if="confirmTarget.type === 'del'">删除这条申请？</template>
          <template v-else-if="confirmTarget.type === 'off'">下架「{{ confirmTarget.goods.name }}」？</template>
          <template v-else>重新上架「{{ confirmTarget.goods.name }}」？</template>
        </view>
        <view class="sheet-body">
          <template v-if="confirmTarget.type === 'del'">删除后无法恢复<br>（这条申请会被撤掉）</template>
          <template v-else-if="confirmTarget.type === 'off'">下架后买家看不到这个菜；<b>历史订单不受影响</b>，随时可以重新上架</template>
          <template v-else>重新上架后买家可以立刻看到这个菜，商品资料原样保留</template>
        </view>
        <view class="row-btns">
          <view class="pbtn ghost" @tap="confirmTarget = null">再想想</view>
          <view
            class="pbtn"
            :class="{ danger: confirmTarget.type === 'del', primary: confirmTarget.type !== 'del', disabled: statusBusyId === confirmTarget.goods.id }"
            @tap="doConfirm"
          >{{ confirmTarget.type === 'del' ? '确认删除' : confirmTarget.type === 'off' ? '确认下架' : '确认上架' }}</view>
        </view>
      </view>
    </view>

    <!-- 快速改库存弹层（免审核即时生效） -->
    <view v-if="stockTarget" class="mask" @tap="stockTarget = null">
      <view class="modal" @tap.stop>
        <view class="card-title">⚡ 快速调整日可供量</view>
        <view class="muted" style="margin-bottom:12px;">{{ stockTarget.name }}（库存调整不涉价格规格，免审核，保存即生效）</view>
        <input v-model="stockValue" class="ipt" type="digit" placeholder="输入新的日可供量，如 300" />
        <view class="row-btns">
          <view class="pbtn ghost" @tap="stockTarget = null">取消</view>
          <view class="pbtn primary" @tap="saveStock">保存</view>
        </view>
      </view>
    </view>

    <!-- 编辑商品弹层（走变更审核） -->
    <view v-if="editTarget" class="mask" @tap="editTarget = null">
      <view class="modal" @tap.stop>
        <view class="card-title">✏️ 编辑商品（提交后走运营审核）</view>
        <view class="muted" style="margin-bottom:12px;">{{ editTarget.name }}（变更审核期间原信息继续在售）</view>
        <view class="form-row"><view class="fr-l">商品名称</view><view class="fr-r"><input v-model="editForm.name" class="ipt" placeholder="不改则留空" /></view></view>
        <!-- 卡BV-2：单位（同一套平铺 chip，打开时回显当前值；改了随变更走运营审核） -->
        <view class="form-row form-top">
          <view class="fr-l">单位</view>
          <view class="fr-r">
            <view class="chip-group">
              <view
                v-for="u in editUnitOptions"
                :key="u.name"
                class="chip"
                :class="{ on: editForm.unit === u.name }"
                @tap="editForm.unit = u.name"
              >{{ u.name }}<text v-if="u.off" class="chip-off">（已停用）</text></view>
            </view>
            <view class="muted">不改单位就不用动</view>
          </view>
        </view>
        <view class="form-row"><view class="fr-l">供货价</view><view class="fr-r"><input v-model="editForm.supplyPrice" class="ipt" type="digit" placeholder="不改则留空" /></view></view>
        <view class="form-row"><view class="fr-l">日可供量</view><view class="fr-r"><input v-model="editForm.dailySupply" class="ipt" type="digit" placeholder="不改则留空（也可用⚡改库存）" /></view></view>
        <!-- 卡BP：商品备注可改（随变更走运营审核） -->
        <view class="form-row form-top">
          <view class="fr-l">商品备注</view>
          <view class="fr-r">
            <textarea v-model="editForm.remark" class="ipt ta-remark" :maxlength="12" placeholder="最多 12 字，显示在买家商品名下方（灰字）" />
            <view class="muted remark-meta">改动后随变更一起走运营审核<text class="remark-count">{{ (editForm.remark || '').length }}/12</text></view>
          </view>
        </view>
        <view class="row-btns">
          <view class="pbtn ghost" @tap="editTarget = null">取消</view>
          <view class="pbtn primary" @tap="submitEdit">提交变更</view>
        </view>
      </view>
    </view>

    <!-- 卡BQ（2026-10-03）：编辑待审商品弹层（照原型屏4-2）——
         编辑的是待审核/已驳回那条申请本身：原地改，改完仍是这一条，不会多出一条待审 -->
    <view v-if="pendingEditTarget" class="mask" @tap="pendingEditTarget = null">
      <view class="modal" @tap.stop>
        <view class="card-title">✏️ 编辑待审商品</view>
        <view class="pending-sub">还没审核通过，改完仍是这一条，不会多出一条待审</view>
        <view class="form-row"><view class="fr-l">商品名称</view><view class="fr-r"><input v-model="pendingEditForm.name" class="ipt" placeholder="商品名称" /></view></view>
        <view class="form-row form-top">
          <view class="fr-l">商品分类</view>
          <view class="fr-r">
            <view class="chip-group">
              <view
                v-for="c in cats"
                :key="c.id"
                class="chip"
                :class="{ on: pendingEditForm.categoryId === c.id }"
                @tap="pendingEditForm.categoryId = c.id"
              >{{ c.name }}</view>
            </view>
            <view class="muted">只能选已授权分类</view>
          </view>
        </view>
        <view class="form-row">
          <view class="fr-l">计量方式</view>
          <view class="fr-r">
            <view class="chip-group">
              <!-- 卡BV-2（拍板① B 版）：同主表单，去掉写死的「斤」 -->
              <view class="chip" :class="{ on: pendingEditForm.weighType === 1 }" @tap="pendingEditForm.weighType = 1">称重</view>
              <view class="chip" :class="{ on: pendingEditForm.weighType === 2 }" @tap="pendingEditForm.weighType = 2">固定规格</view>
            </view>
          </view>
        </view>
        <!-- 卡BV-2：单位（同一套平铺 chip，打开时回显当前值） -->
        <view class="form-row form-top">
          <view class="fr-l">单位</view>
          <view class="fr-r">
            <view class="chip-group">
              <view
                v-for="u in pendingUnitOptions"
                :key="u.name"
                class="chip"
                :class="{ on: pendingEditForm.unit === u.name }"
                @tap="pendingEditForm.unit = u.name"
              >{{ u.name }}<text v-if="u.off" class="chip-off">（已停用）</text></view>
            </view>
          </view>
        </view>
        <!-- 卡BV-2：placeholder 随单位联动 -->
        <view class="form-row"><view class="fr-l">供货价</view><view class="fr-r"><input v-model="pendingEditForm.supplyPrice" class="ipt" type="digit" :placeholder="'元/' + pendingEditForm.unit + '，提交后审核'" /></view></view>
        <view class="form-row"><view class="fr-l">日可供量</view><view class="fr-r"><input v-model="pendingEditForm.dailySupply" class="ipt" type="digit" :placeholder="pendingEditForm.unit" /></view></view>
        <view class="form-row form-top">
          <view class="fr-l">商品备注</view>
          <view class="fr-r">
            <textarea v-model="pendingEditForm.remark" class="ipt ta-remark" :maxlength="12" placeholder="如：今早现摘，带花带刺（可不填）" />
            <view class="muted remark-meta">会显示在采购方商品名下方（灰字），可不填；最多 12 字<text class="remark-count">{{ (pendingEditForm.remark || '').length }}/12</text></view>
          </view>
        </view>
        <view class="form-row form-top">
          <view class="fr-l">封面图</view>
          <view class="fr-r">
            <view v-if="!pendingEditCover && !pendingCoverPicking" class="cover-empty" @tap="pickPendingCover">📷 点击选封面图<small>建议实拍：光线好、菜新鲜</small></view>
            <view v-else class="cover-picked" @tap="pickPendingCover">
              <view class="cover-thumb">
                <image v-if="pendingEditCover" :src="fullUrl(pendingEditCover)" mode="aspectFill" class="cover-thumb-img" />
                <view v-else class="cover-thumb-img cover-loading"></view>
                <view class="cam-badge lg">📷</view>
              </view>
              <view class="cover-meta">
                <view class="cover-meta-t">{{ pendingCoverPicking ? '上传中…' : '已选 1 张 · 点击可重选' }}</view>
                <view class="cover-meta-d">随申请一起提交，走运营审核</view>
              </view>
            </view>
          </view>
        </view>
        <view class="row-btns">
          <view class="pbtn ghost" @tap="pendingEditTarget = null">取消</view>
          <view class="pbtn primary" :class="{ disabled: pendingEditBusy }" @tap="submitPendingEdit">{{ pendingEditBusy ? '提交中…' : '提交修改' }}</view>
        </view>
      </view>
    </view>

    <!-- 底部固定语音入口（卡W：真·按住录音，松手落语音报价页确认页 —— 做法 A）：
         有插件（真机）= 真·按住 + 录音浮层 + 「⌨️ 打字报量」切换（形态①，真机保留打字入口）；
         插件不可用（H5 / 未声明 WechatSI）= 整条语音按钮不出现，只剩打字入口（现状保持） -->
    <view class="voice-bar">
      <view class="voice-hint">例：「西红柿三块八，今天有两百斤」</view>
      <template v-if="voiceReady">
        <view
          v-if="!voiceTyping"
          class="voice-btn"
          :class="{ rec: recording }"
          @touchstart.prevent="onMicStart"
          @touchmove.prevent="onMicMove"
          @touchend.prevent="onMicStop"
          @touchcancel="onMicStop"
        >
          <view class="voice-btn-t">🎤 按住说话 改价 / 报量</view>
          <view class="voice-btn-d">说完会念给你确认，认错了可以改</view>
        </view>
        <view v-else class="voice-typing">
          <input v-model="voiceText" class="voice-ipt" placeholder="打字报量 / 改价，如：西红柿三块八，今天有两百斤" confirm-type="send" @confirm="goVoiceByText" />
          <view class="voice-send" :class="{ disabled: !voiceText.trim() }" @tap="goVoiceByText">解析</view>
        </view>
        <view class="voice-swap" @tap="voiceTyping = !voiceTyping">{{ voiceTyping ? '🎤 改用按住说话' : '⌨️ 打字报量' }}</view>
      </template>
      <view v-else class="voice-typing">
        <input v-model="voiceText" class="voice-ipt" placeholder="打字报量 / 改价，如：西红柿三块八，今天有两百斤" confirm-type="send" @confirm="goVoiceByText" />
        <view class="voice-send" :class="{ disabled: !voiceText.trim() }" @tap="goVoiceByText">解析</view>
      </view>
    </view>

    <!-- 录音浮层（与语音报价页同一形态：从底部升起，显示实时识别文字） -->
    <view v-if="recording" class="rec-mask" @touchmove.stop.prevent>
      <view class="rec-panel">
        <view class="rec-wave">
          <i v-for="(h, i) in waveBars" :key="i" :style="{ height: h + 'px' }"></i>
        </view>
        <view class="rec-heard">{{ recText || '正在听您说…' }}<text class="dim">（正在听）</text></view>
        <view class="rec-hint">松手结束 · 最长 30 秒 · 说慢点、说清「哪个菜、多少钱、有多少」</view>
      </view>
    </view>
    <!-- 确认/结果抽屉（卡X：松手/打字后就地升起，不跳页；确认→三选一→提交→结果→关闭全在抽屉内） -->
    <VoiceConfirm
      v-if="drawerOpen"
      :raw-text="confirmData.rawText"
      :draft="confirmData.draft"
      :unmatched-details="confirmData.unmatchedDetails"
      :candidates="confirmData.candidates"
      :question="confirmData.question"
      @close="onDrawerClose"
      @submitted="onDrawerSubmitted"
      @resay="onDrawerResay"
    />
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import { supplierApi, unitApi } from '@/api/modules'
import { post, put, del, fullUrl } from '@/api/request'
import { pickPhotos, uploadPhoto, previewPhotos } from '@/utils/photo-upload'
import { createVoiceHold } from '@/utils/voice-record'
import VoiceConfirm from '@/components/VoiceConfirm.vue'

const goods = ref([])
const loading = ref(false)
const keyword = ref('')
const activeFilter = ref('all')

const filters = [
  { key: 'all', label: '全部' },
  { key: 'on_sale', label: '在售' },
  { key: 'changing', label: '变更中' },
  { key: 'pending', label: '待审核' },
  { key: 'rejected', label: '已驳回' },
  { key: 'off_shelf', label: '已下架' },
]

// 分类（提交新品用）
const cats = ref([])
const catNames = ref([])
const form = ref({ name: '', categoryId: null, categoryName: '', weighType: 1, unit: '斤', supplyPrice: '', dailySupply: '', remark: '' })

// ── 卡BV-2（2026-10-03）：计量单位（GET /units，只启用中，按 sort） ──
// 单位由后台「计量单位」页维护，供应商端只能从 chip 里选：**没有「其他 / 手填」入口**。
const units = ref([])

/// 三个表单各自的 chip 选项。老商品的单位若已被停用：GET /units 里已没有它，
/// 这里**保留该项并标注「（已停用）」** —— 否则编辑页一打开单位就是空白，保存会把单位洗掉。
function unitOptionsFor(current) {
  const list = units.value.map((u) => ({ name: u.name, off: false }))
  if (current && !list.some((u) => u.name === current)) {
    list.push({ name: current, off: units.value.length > 0 })
  }
  return list
}
const unitOptions = computed(() => unitOptionsFor(form.value.unit))
const editUnitOptions = computed(() => unitOptionsFor(editForm.value.unit))
const pendingUnitOptions = computed(() => unitOptionsFor(pendingEditForm.value.unit))

/// placeholder 示例值（原型口径：瓶 → 120 / 50，其余沿用现状 2.20 / 200）
const UNIT_EXAMPLE = { 瓶: { price: '120', supply: '50' } }
const pricePh = computed(() => `如 ${(UNIT_EXAMPLE[form.value.unit] || {}).price || '2.20'}（元/${form.value.unit}，提交后审核）`)
const supplyPh = computed(() => `如 ${(UNIT_EXAMPLE[form.value.unit] || {}).supply || '200'}（${form.value.unit}）`)

async function loadUnits() {
  try {
    units.value = (await unitApi.listEnabled()) || []
  } catch (e) {
    units.value = [] // 取不到就只留当前值兜底项，不阻塞表单
  }
  // 单位表里有数据、而当前值是空的（首次进入）→ 默认选中第一个启用单位（预置首项＝斤）
  if (units.value.length && !form.value.unit) form.value.unit = units.value[0].name
}

const showForm = ref(false)

// ── 卡BP：拍照快速上架 · AI 识别（2026-10-02）──
// 封面上传成功 → POST /ai/supplier/recognize-goods → 预填 名称/分类/计量 三项（绿底可改）。
// 🔒 AI 只做表单预填，绝不直接落库；供货价/日可供量一律手填。
// 识别失败/超时/返回无效结果 → aiState='fail'，表单留空按现状手填，绝不报错阻断。
const aiState = ref('idle') // idle | loading | done | fail
const aiSuggest = ref(null) // AI 原始建议（用于「AI 选的是 xx」提示文案）
const aiFilled = ref({ name: false, category: false, weigh: false }) // 哪些字段是 AI 填的（绿底标识，用户一动就撤）

async function aiRecognize(url) {
  aiState.value = 'loading'
  aiFilled.value = { name: false, category: false, weigh: false }
  try {
    const res = await post('/ai/supplier/recognize-goods', { image: url })
    // parser='none'（降级/没认出来）或三项全空 → 按失败口径，不弹「识别成功」
    if (res && res.parser === 'vl' && (res.name || res.categoryId || res.weighType)) {
      aiSuggest.value = res
      if (res.name) { form.value.name = res.name; aiFilled.value.name = true }
      // 分类只能从已授权分类中选：服务端已硬校验丢弃越权值，这里再兜一层
      if (res.categoryId && cats.value.some((c) => c.id === res.categoryId)) {
        form.value.categoryId = res.categoryId
        form.value.categoryName = res.categoryName || ''
        aiFilled.value.category = true
      }
      if (res.weighType) { form.value.weighType = res.weighType; aiFilled.value.weigh = true }
      aiState.value = 'done'
    } else {
      aiState.value = 'fail'
    }
  } catch (e) {
    aiState.value = 'fail' // 网络异常也不阻断：表单留空，手填链路与现状一致
  }
}

// 快速改库存
const stockTarget = ref(null)
const stockValue = ref('')

// 编辑（变更审核）
const editTarget = ref(null)
const editForm = ref({ name: '', unit: '', supplyPrice: '', dailySupply: '', remark: '' })

// ── 换封面（卡Z1：免审即时生效，走 PUT /supplier-goods/:id/cover）──
const coverUploadingId = ref(null) // 正在上传的商品 id：盖转圈 + 防重复点击

function onTapCover(g) {
  if (coverUploadingId.value) return // 上传中整页只允许一个在传，防连点并发写
  uni.showActionSheet({
    itemList: ['拍照', '从相册选择'],
    success: ({ tapIndex }) => changeCover(g, tapIndex === 0 ? ['camera'] : ['album']),
    fail: () => {}, // 用户点了取消
  })
}

async function changeCover(g, sourceType) {
  try {
    const paths = await pickPhotos({ count: 1, sourceType })
    const path = paths && paths[0]
    if (!path) return
    coverUploadingId.value = g.id
    try {
      const url = await uploadPhoto(path) // 压缩（≤300KB）→ POST /upload/image
      await put(`/supplier-goods/${g.id}/cover`, { cover: url })
      g.cover = url // 就地替换缩略图，不整页刷新
      uni.showToast({ title: '封面已更新（已生效）', icon: 'none' })
    } finally {
      coverUploadingId.value = null
    }
  } catch (e) {
    coverUploadingId.value = null
    if (e && e.cancelled) return // 用户取消选图
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' }) // 网络/图片过大等可读提示；业务错误 request 层已 toast
  }
}

// ── 下架/重新上架/删除（卡Z2，免审即时，接口 PUT :id/status 与 DELETE apply/:applyId）──
const confirmTarget = ref(null) // { type: 'off' | 'on' | 'del', goods, applyId }
const statusBusyId = ref(null) // 防连点：操作进行中的行 id，该行按钮禁用 + 确认按钮禁用

function askToggle(g) {
  if (statusBusyId.value === g.id) return // 该行操作进行中 → 禁用
  confirmTarget.value = { type: g.status === 'off_shelf' ? 'on' : 'off', goods: g }
}

function askDelete(g) {
  if (statusBusyId.value === g.id) return
  confirmTarget.value = { type: 'del', goods: g, applyId: g.applyId }
}

async function doConfirm() {
  const t = confirmTarget.value
  if (!t || statusBusyId.value === t.goods.id) return // 防连点：进行中直接忽略
  statusBusyId.value = t.goods.id
  try {
    if (t.type === 'del') {
      await del(`/supplier-goods/apply/${t.applyId}`)
      goods.value = goods.value.filter((x) => x.id !== t.goods.id) // 删除成功该行就地消失
      uni.showToast({ title: '申请已删除', icon: 'none' })
    } else {
      const next = t.type === 'off' ? 0 : 1
      await put(`/supplier-goods/${t.goods.id}/status`, { status: next })
      // 成功后就地更新该行（不整页刷新）
      t.goods.status = next === 0 ? 'off_shelf' : 'on_sale'
      t.goods.statusText = next === 0 ? '已下架' : '在售'
      uni.showToast({ title: next === 0 ? '已下架（免审即时）' : '已重新上架（免审即时）', icon: 'none' })
    }
    confirmTarget.value = null
  } catch (e) {
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' }) // 后端业务错误文案透出
  } finally {
    statusBusyId.value = null
  }
}

// 已下架的行：编辑/改库存置灰，点了给可读提示（后端 quickStock/applyChange 本来也会拒）
// 卡BQ：待审核/已驳回两行编辑点亮 → 走「编辑待审商品」弹层（原地改申请，不走变更）
function tapEdit(g) {
  if (g.status === 'off_shelf') { uni.showToast({ title: '商品已下架，请先重新上架再改价/改名', icon: 'none' }); return }
  if (g.status === 'pending' || g.status === 'rejected') { openPendingEdit(g); return }
  openEdit(g)
}
function tapStock(g) {
  if (g.status === 'off_shelf') { uni.showToast({ title: '商品已下架，请先重新上架再改价/改名', icon: 'none' }); return }
  openStock(g)
}

// ── 卡BQ（2026-10-03）：编辑待审/已驳回商品（PUT /supplier-goods/apply/:applyId，原地改不新增申请） ──
const pendingEditTarget = ref(null)
const pendingEditForm = ref({ name: '', categoryId: null, weighType: 1, unit: '斤', supplyPrice: '', dailySupply: '', remark: '' })
const pendingEditCover = ref('')
const pendingCoverPicking = ref(false)
const pendingEditBusy = ref(false)

function openPendingEdit(g) {
  pendingEditTarget.value = g
  pendingEditForm.value = {
    name: g.name || '',
    categoryId: g.categoryId ?? null,
    weighType: g.weighType || 1,
    unit: g.unit || '斤', // 卡BV-2：回显当前单位（已停用的也会保留在 chip 里并标注）
    supplyPrice: String(g.supplyPrice ?? ''),
    dailySupply: String(g.dailySupply ?? ''),
    remark: g.remark || '',
  }
  pendingEditCover.value = g.cover || ''
}

async function pickPendingCover() {
  if (pendingCoverPicking.value) return
  try {
    const paths = await pickPhotos({ count: 1 })
    if (!paths || !paths[0]) return
    pendingCoverPicking.value = true
    try {
      pendingEditCover.value = await uploadPhoto(paths[0])
    } finally {
      pendingCoverPicking.value = false
    }
  } catch (e) {
    pendingCoverPicking.value = false
    if (e && e.cancelled) return // 用户取消选图
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  }
}

async function submitPendingEdit() {
  const g = pendingEditTarget.value
  if (!g || pendingEditBusy.value) return
  const f = pendingEditForm.value
  if (!f.name.trim()) { uni.showToast({ title: '请填写商品名称', icon: 'none' }); return }
  if (!f.categoryId) { uni.showToast({ title: '请选择商品分类', icon: 'none' }); return }
  const price = Number(f.supplyPrice)
  const supply = Number(f.dailySupply)
  if (!price || price <= 0) { uni.showToast({ title: '请填写正确的供货价', icon: 'none' }); return }
  if (isNaN(supply) || supply < 0) { uni.showToast({ title: '请填写正确的日可供量', icon: 'none' }); return }
  pendingEditBusy.value = true
  try {
    const res = await put(`/supplier-goods/apply/${g.applyId}`, {
      name: f.name.trim(),
      categoryId: f.categoryId,
      weighType: f.weighType,
      unit: f.unit, // 卡BV-2：单位随申请一起提交（后端按「启用 ∪ 当前值」校验）
      supplyPrice: price,
      dailySupply: supply,
      remark: (f.remark || '').trim(), // 传空串 = 显式清空备注
      ...(pendingEditCover.value ? { cover: pendingEditCover.value } : {}),
    })
    pendingEditTarget.value = null
    // 三种提交反馈照原型屏4-3：待审态改完仍在等待审核；已驳回态改完重新进待审；
    // 兜底态（提交瞬间刚好被通过）→ 后端业务错在 catch 里原样透出
    if (res && res.resubmitted) {
      uni.showToast({ title: '已重新提交审核', icon: 'none' })
    } else {
      uni.showToast({ title: '已更新，仍在等待审核', icon: 'none' })
    }
    load()
  } catch (e) {
    // 兜底态：「该商品已审核通过，请用「变更申请」修改」等后端文案原样给到供应商
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  } finally {
    pendingEditBusy.value = false
  }
}

// ── 新商品表单：封面 + 资质证明（卡Z1：把「＋ 上传检疫合格证」死文案接上真上传）──
const formCover = ref('') // 相对地址 /uploads/xxx
const formQual = ref([])
const coverPicking = ref(false)
const qualUploading = ref(false)

/// 卡BU：sourceType 由按钮写死传入（['camera'] 直接拍 / ['album'] 从相册选），
/// 省掉微信「先选来源、再点完成」两步；其余（上传 → aiRecognize 触发 → 三态 → 绿底预填）一字不动
async function pickFormCover(sourceType = ['camera', 'album']) {
  if (coverPicking.value) return
  try {
    const paths = await pickPhotos({ count: 1, sourceType })
    if (!paths || !paths[0]) return
    coverPicking.value = true
    try {
      formCover.value = await uploadPhoto(paths[0])
    } finally {
      coverPicking.value = false
    }
    // 卡BP：封面就位 → 自动触发 AI 识别（不 await 阻断选图流程，识别态由 aiState 驱动）
    if (formCover.value) aiRecognize(formCover.value)
  } catch (e) {
    coverPicking.value = false
    if (e && e.cancelled) return
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  }
}

async function addQual() {
  if (qualUploading.value) return
  const remain = 5 - formQual.value.length
  if (remain <= 0) { uni.showToast({ title: '资质证明最多 5 张', icon: 'none' }); return }
  try {
    const paths = await pickPhotos({ count: remain })
    if (!paths || !paths.length) return
    qualUploading.value = true
    try {
      for (const p of paths) formQual.value.push(await uploadPhoto(p))
    } finally {
      qualUploading.value = false
    }
  } catch (e) {
    qualUploading.value = false
    if (e && e.cancelled) return
    if (e && e.msg) uni.showToast({ title: e.msg, icon: 'none' })
  }
}

// ── 底部语音入口（卡W：真·按住录音，共享实现 utils/voice-record.js，全仓唯一）──
// 卡X：松手/打字不再跳页 —— 就地解析后升起 VoiceConfirm 抽屉（确认→提交→结果→关闭全在本页）
const voiceText = ref('')
const voiceTyping = ref(false) // 形态①：打字是次选入口，点「⌨️ 打字报量」切换显示
const parsing = ref(false)
const drawerOpen = ref(false)
const confirmData = ref({ rawText: '', draft: [], unmatchedDetails: [], candidates: [], question: '' })

const voice = createVoiceHold({
  onDone: (text) => {
    const t = String(text || '').trim()
    if (t) parseText(t) // 卡X：松手 → 就地解析开抽屉（不再 setStorageSync 跳页）
  },
  onFail: (msg, meta) => {
    // 识别空/失败：不跳页，就地兜底（文案由共享实现给）；连说两次没听清 → 就地切到打字（卡W 行为保留）
    uni.showToast({ title: msg, icon: 'none' })
    if (meta && meta.escalated) voiceTyping.value = true
  },
})
const voiceReady = voice.ready
const recording = voice.recording
const recText = voice.partial
const waveBars = voice.waveBars
const onMicStart = () => { if (parsing.value || drawerOpen.value) return; voice.handleStart() }
const onMicStop = voice.handleStop
const onMicMove = voice.handleMove
onHide(() => voice.stopForLeave())
onUnload(() => voice.stopForLeave())

// ── 解析（走 /ai/supplier-parse；确认态计算在 VoiceConfirm 组件内，本页不碰）──
async function parseText(text) {
  const t = (text || '').trim()
  if (!t || parsing.value) return
  parsing.value = true
  try {
    const res = await post('/ai/supplier-parse', { text: t })
    if (!(res.draft || []).length && !(res.unmatchedDetails || []).length && !(res.unmatched || []).length && !res.needClarify) {
      uni.showToast({ title: '没认出可改的内容，试试「菜名 + 价格 / 数量」', icon: 'none' })
      return
    }
    confirmData.value = {
      rawText: res.rawText || t,
      draft: res.draft || [],
      unmatchedDetails: res.unmatchedDetails || [],
      candidates: res.candidates || [],
      question: res.needClarify || '',
    }
    drawerOpen.value = true
  } catch (e) {
    /* 错误已由 request.js 统一提示 */
  } finally {
    parsing.value = false
  }
}

function goVoiceByText() {
  const t = voiceText.value.trim()
  if (!t) { uni.showToast({ title: '先输入报量 / 改价内容', icon: 'none' }); return }
  voiceText.value = ''
  parseText(t) // 卡X：就地抽屉，不跳页
}

// ── 抽屉事件（卡X：关闭后刷新列表，改量后立刻看到新数字）──
function onDrawerClose() {
  drawerOpen.value = false
  load()
}
function onDrawerSubmitted() { /* 结果在组件内展示；关闭时统一刷新 */ }
function onDrawerResay() {
  drawerOpen.value = false
  voiceTyping.value = false // 回到按住说话状态（就地）
  load() // 结果轮「再报一条」走这里，把已提交的数字刷进列表
}

const iconOf = (s) => ({ on_sale: '🥬', changing: '🥬', pending: '🫚', rejected: '🥬', off_shelf: '📦' }[s] || '🥬')
const icoBg = (s) => ({ on_sale: '#E6F9F0', changing: '#E6F9F0', pending: '#FFF3E6', rejected: '#FFEDED', off_shelf: '#F0F1F3' }[s] || '#E6F9F0')
const tagType = (s) => ({ on_sale: 'g', changing: 'o', pending: 'o', rejected: 'r', off_shelf: 'gray' }[s] || 'gray')

onShow(() => {
})

async function load() {
  loading.value = true
  try {
    const params = {}
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    if (activeFilter.value !== 'all') params.status = activeFilter.value
    const data = await supplierApi.getMyGoods(params)
    goods.value = data.list || []
  } catch (e) {
    /* 已提示 */
  } finally {
    loading.value = false
  }
}

function switchFilter(key) {
  activeFilter.value = key
  load()
}

async function loadCats() {
  try {
    const roots = await supplierApi.getMyCategories()
    cats.value = roots
    catNames.value = roots.map((c) => c.name)
  } catch (e) { /* 忽略，无授权分类时提交会校验 */ }
}

function selectCat(c) {
  if (c) {
    form.value.categoryId = c.id
    form.value.categoryName = c.name
    aiFilled.value.category = false // 用户手选 → 撤 AI 绿底提示
  }
}

async function submit() {
  if (!form.value.name) { uni.showToast({ title: '请填写商品名称', icon: 'none' }); return }
  if (!form.value.categoryId) { uni.showToast({ title: '请选择商品分类', icon: 'none' }); return }
  const price = Number(form.value.supplyPrice)
  const supply = Number(form.value.dailySupply)
  if (!price || price <= 0) { uni.showToast({ title: '请填写正确的供货价', icon: 'none' }); return }
  if (isNaN(supply)) { uni.showToast({ title: '请填写日可供量', icon: 'none' }); return }

  await supplierApi.submitGoods({
    name: form.value.name,
    categoryId: form.value.categoryId,
    weighType: form.value.weighType,
    unit: form.value.unit, // 卡BV-2：提交带上单位（后端不再兜底写死「斤」）
    supplyPrice: price,
    dailySupply: supply,
    // 卡Z1：封面 + 资质证明（资质照片走 apply 已有的 images 字段，原型⑦屏口径）一并提交
    cover: formCover.value || undefined,
    images: formQual.value.length ? formQual.value : undefined,
    // 卡BU：商品备注（≤12 字，随申请走运营审核）
    remark: (form.value.remark || '').trim() || undefined,
  })
  uni.showToast({ title: '已提交，等待运营审核', icon: 'none' })
  showForm.value = false
  form.value = { name: '', categoryId: null, categoryName: '', weighType: 1, unit: '斤', supplyPrice: '', dailySupply: '', remark: '' }
  formCover.value = ''
  formQual.value = []
  aiState.value = 'idle'
  aiSuggest.value = null
  load()
}

function openStock(g) {
  stockTarget.value = g
  stockValue.value = String(g.dailySupply)
}

async function saveStock() {
  const v = Number(stockValue.value)
  if (isNaN(v) || v < 0) { uni.showToast({ title: '请输入有效数量', icon: 'none' }); return }
  await supplierApi.quickStock(stockTarget.value.id, v)
  uni.showToast({ title: '已生效（免审核）', icon: 'none' })
  stockTarget.value = null
  load()
}

function openEdit(g) {
  editTarget.value = g
  // 卡BP：备注回显当前生效值，可改（留空=清空备注）；改名/价/量仍走「不改则留空」
  // 卡BV-2：单位回显当前值（改了才随变更走审核，不改就留着当前值，不会变成空白）
  editForm.value = { name: '', unit: g.unit || '斤', supplyPrice: '', dailySupply: '', remark: g.remark || '' }
}

async function submitEdit() {
  const changes = {}
  if (editForm.value.name.trim()) changes.name = editForm.value.name.trim()
  const price = Number(editForm.value.supplyPrice)
  const supply = Number(editForm.value.dailySupply)
  if (editForm.value.supplyPrice && (!price || price <= 0)) { uni.showToast({ title: '供货价无效', icon: 'none' }); return }
  if (editForm.value.dailySupply && (isNaN(supply) || supply < 0)) { uni.showToast({ title: '日可供量无效', icon: 'none' }); return }
  if (price) changes.supplyPrice = price
  if (editForm.value.dailySupply) changes.dailySupply = supply
  // 卡BP：备注有变化才进变更（含「清空」），随变更走运营审核
  const remarkNew = (editForm.value.remark || '').trim()
  if (remarkNew !== (editTarget.value.remark || '')) changes.remark = remarkNew
  // 卡BV-2：单位改了才进变更（与 name/价/量同一口径：不改就不带）
  if (editForm.value.unit && editForm.value.unit !== editTarget.value.unit) changes.unit = editForm.value.unit

  if (!Object.keys(changes).length) { uni.showToast({ title: '未填写任何变更内容', icon: 'none' }); return }

  await supplierApi.applyChange(editTarget.value.id, { changes })
  uni.showToast({ title: '变更已提交，等待审核', icon: 'none' })
  editTarget.value = null
  load()
}

onMounted(() => {
  loadCats()
  loadUnits() // 卡BV-2：单位 chip（只读字典，失败不阻塞表单）
  load()
})
</script>

<style lang="scss" scoped>
.filter-chips { margin-top: 8px; }
/* 卡BV-2：已停用单位的兜底标注（老商品当前单位被停用 → chip 保留该项 + 灰字「（已停用）」） */
.chip-off { color: #C0C4CC; font-size: 10px; margin-left: 1px; }
.act-link { display: inline; color: $brand-deep; font-size: 12px; font-weight: 600; margin-left: 8px; }
.act-stock { display: inline; color: $info; font-size: 12px; font-weight: 600; margin-left: 8px; }
/* 卡Z2：下架/重新上架 / 删除 / 置灰 */
.act-down { display: inline; color: #C87000; font-size: 12px; font-weight: 600; margin-left: 8px; }
.act-del { display: inline; color: #FA5151; font-size: 12px; font-weight: 600; margin-left: 8px; }
.act-link.dim, .act-stock.dim { color: #C0C6CC; }
/* 卡BQ：待审核/已驳回行编辑点亮（绿底绿字描边，照原型屏4，观感与在售行一致可点） */
.act-link.lit {
  color: #00B96B;
  background: #F2FBF7;
  border: 1px solid #B6E4CF;
  border-radius: 6px;
  padding: 1px 7px;
  margin-left: 6px;
  box-shadow: 0 0 0 1.5px rgba(0, 185, 107, 0.25);
}
/* 卡BQ：编辑待审商品弹层副标题（橙色小字，照原型屏4-2） */
.pending-sub { font-size: 11px; color: #FF8F1F; margin: -6px 0 10px; line-height: 1.5; }
.act-down.disabled, .act-del.disabled, .pbtn.disabled { opacity: 0.45; pointer-events: none; }
.form-row { display: flex; align-items: center; padding: 12px 0; font-size: 14px; }
.fr-l { width: 76px; color: $text-second; flex-shrink: 0; }
.fr-r { flex: 1; margin-left: 12px; min-width: 0; }
.ipt { width: 100%; min-height: 40px; height: 40px; line-height: 40px; text-align: left; font-size: 14px; color: $text-body; }
.picker-val { color: $color-primary; }
.muted { color: $text-placeholder; font-size: 12px; }
.empty { text-align: center; color: $text-placeholder; padding: 60px 0; font-size: 13px; }

/* ── 封面缩略图（卡Z1）：有 cover 显真图，无 cover 回退 emoji；点角标换图 ── */
.li-thumb {
  width: 46px; height: 46px; border-radius: 9px; flex-shrink: 0;
  position: relative; overflow: visible; margin-right: 12px;
}
.li-img { width: 46px; height: 46px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.cam-badge {
  position: absolute; right: -4px; bottom: -4px; width: 18px; height: 18px; border-radius: 50%;
  background: rgba(17, 17, 17, 0.78); color: #fff; font-size: 9px; line-height: 1;
  display: flex; align-items: center; justify-content: center; border: 2px solid #fff; z-index: 2;
}
.cam-badge.lg { width: 24px; height: 24px; font-size: 12px; right: -6px; bottom: -6px; }
.thumb-spin {
  position: absolute; left: 0; top: 0; width: 46px; height: 46px; border-radius: 9px;
  background: rgba(255, 255, 255, 0.72); z-index: 3; overflow: hidden;
}
.thumb-spin::after {
  content: ''; position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
  border-radius: 50%; border: 3px solid #E6F9F0; border-top-color: #00B96B;
  animation: cover-spin 0.9s linear infinite;
}
@keyframes cover-spin { to { transform: rotate(360deg); } }

/* 新商品表单：封面区 + 资质网格（原型⑦屏） */
.form-top { align-items: flex-start; }
.cover-empty {
  border: 1.5px dashed #C9D2DA; border-radius: 9px; padding: 18px 12px; text-align: center;
  color: #8A9099; font-size: 13px; display: flex; flex-direction: column; gap: 4px;
}
.cover-empty small { font-size: 11px; color: #B3B9C2; }
.cover-picked { display: flex; align-items: center; gap: 10px; }
.cover-thumb { width: 52px; height: 52px; border-radius: 9px; position: relative; flex-shrink: 0; }
.cover-thumb-img { width: 52px; height: 52px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.cover-thumb-img.cover-loading { background: #F0F1F3; }
.cover-meta-t { font-size: 13px; font-weight: 600; color: $text-title; }
.cover-meta-d { font-size: 10.5px; color: #8A9099; margin-top: 2px; }
.pic-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.pic { width: 52px; height: 52px; border-radius: 9px; position: relative; }
.pic-img { width: 52px; height: 52px; border-radius: 9px; display: block; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06); }
.pic-x {
  position: absolute; top: -6px; right: -6px; width: 17px; height: 17px; border-radius: 50%;
  background: rgba(17, 17, 17, 0.78); color: #fff; font-size: 10px;
  display: flex; align-items: center; justify-content: center; border: 2px solid #fff;
}
.pic-add {
  width: 52px; height: 52px; border-radius: 9px; border: 1.5px dashed #C9D2DA;
  display: flex; align-items: center; justify-content: center; font-size: 20px; color: #B3B9C2;
}

/* ── 卡BP（2026-10-02）：拍照识别三态 + AI 绿底预填 + 备注框 ── */
.ipt-ai { border: 1px solid #00B96B; background: #F2FBF7; border-radius: 8px; padding: 0 9px; box-sizing: border-box; }
.ai-flash {
  display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #00995A;
  background: #E6F9F0; border-radius: 8px; padding: 7px 10px; margin-top: 8px;
}
.ai-spin {
  width: 12px; height: 12px; flex-shrink: 0;
  border: 2px solid #B6E4CF; border-top-color: #00B96B; border-radius: 50%;
  animation: ai-rot 0.8s linear infinite;
}
@keyframes ai-rot { to { transform: rotate(360deg); } }
.ta-remark { min-height: 52px; height: auto; line-height: 1.5; padding: 8px 9px; background: $bg-soft; border-radius: 8px; width: 100%; box-sizing: border-box; }
.remark-meta { display: flex; justify-content: space-between; margin-top: 4px; }
.remark-count { color: #B3B9C2; flex-shrink: 0; margin-left: 8px; }

/* 弹层 */
.mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 99;
}
.modal {
  width: 86%; background: #fff; border-radius: 12px; padding: 16px;
}
.modal .ipt {
  background: $bg-soft; border-radius: 8px; padding: 10px 12px; text-align: left; margin-bottom: 4px;
}

/* 卡Z2：底部确认抽屉（照原型④：后果说清 + 再想想/确认） */
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 100;
  background: #fff; border-radius: 24rpx 24rpx 0 0; padding: 28rpx 32rpx calc(28rpx + env(safe-area-inset-bottom));
}
.sheet-title { font-size: 30rpx; font-weight: 700; color: $text-title; margin-bottom: 14rpx; }
.sheet-body { font-size: 25rpx; color: $text-second; line-height: 1.7; margin-bottom: 24rpx; }
.sheet-body b { color: $text-title; }

/* ── 底部固定语音入口（卡U 建，卡W 改真·按住）：列表底部留白跟着加大，别让最后一行被盖住 ── */
.page { padding-bottom: 280rpx; }
.voice-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 90;
  background: #fff; border-top: 1px solid #EEF1F4;
  padding: 16rpx 24rpx calc(20rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -8rpx 28rpx rgba(0, 0, 0, 0.05);
}
.voice-hint { font-size: 20rpx; color: #8A9099; text-align: center; margin-bottom: 12rpx; }
.voice-btn {
  background: linear-gradient(120deg, #00B96B, #35C98D); color: #fff;
  border-radius: 28rpx; padding: 22rpx; text-align: center;
  box-shadow: 0 12rpx 32rpx rgba(0, 185, 107, 0.28);
}
.voice-btn.rec { background: #1F2329; box-shadow: none; opacity: 0.92; }
.voice-btn-t { font-size: 32rpx; font-weight: 700; }
.voice-btn-d { font-size: 20rpx; opacity: 0.92; margin-top: 6rpx; }
/* 形态①：打字是次选入口 —— 小切换链接（点开变输入框），不跟主按钮抢宽度 */
.voice-swap { font-size: 22rpx; color: #8A9099; text-align: center; padding: 10rpx 0 0; }
.voice-typing { display: flex; gap: 12rpx; align-items: center; }
.voice-ipt {
  flex: 1; min-height: 72rpx; height: 72rpx; line-height: 72rpx;
  background: #F5F6F8; border-radius: 16rpx; padding: 0 20rpx; font-size: 26rpx;
}
.voice-send {
  flex: none; background: #00B96B; color: #fff; font-size: 26rpx; font-weight: 600;
  padding: 16rpx 28rpx; border-radius: 16rpx;
}
.voice-send.disabled { opacity: 0.5; }

/* 录音浮层（与语音报价页 voice-report.vue 同一套值：从底部升起） */
.rec-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 99;
  background: rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end;
}
.rec-panel {
  width: 100%; background: #1F2329; color: #fff;
  padding: 40rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  display: flex; flex-direction: column; align-items: center; gap: 24rpx;
}
.rec-wave { display: flex; align-items: flex-end; gap: 8rpx; height: 84rpx; }
.rec-wave i { display: block; width: 10rpx; border-radius: 6rpx; background: #35C98D; }
.rec-heard { font-size: 28rpx; line-height: 1.75; text-align: center; background: rgba(255, 255, 255, 0.09); border-radius: 20rpx; padding: 18rpx 22rpx; width: 100%; box-sizing: border-box; }
.rec-heard .dim { color: #9AA3AD; font-size: 22rpx; }
.rec-hint { font-size: 22rpx; color: #C6CDD6; text-align: center; line-height: 1.7; }
</style>
