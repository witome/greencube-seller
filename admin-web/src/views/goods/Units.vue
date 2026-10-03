<template>
  <div>
    <el-card shadow="never">
      <div class="toolbar">
        <span>
          计量单位
          <span class="head-tip">共 {{ list.length }} 条 · 停用后不再出现在新建商品与供应商端，老商品与历史订单照常显示原单位</span>
        </span>
        <el-button type="primary" @click="openCreate">＋ 新增单位</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe row-key="id">
        <el-table-column prop="sort" label="排序" width="80" align="center" />
        <el-table-column prop="name" label="单位名称" min-width="160" />
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.statusText }}</el-tag>
          </template>
        </el-table-column>
        <!-- ⚠️ 只有 上移 / 下移 / 停用(启用) —— 口径：单位用过就停用，不真删，所以**没有删除** -->
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row, $index }">
            <el-button link type="primary" :disabled="$index === 0" @click="move(row, $index, -1)">上移</el-button>
            <el-button link type="primary" :disabled="$index === list.length - 1" @click="move(row, $index, 1)">下移</el-button>
            <el-button
              link
              :type="row.status === 1 ? 'info' : 'warning'"
              :loading="busyId === row.id"
              @click="toggle(row)"
            >{{ row.status === 1 ? '停用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="foot-tip">
        <b>口径：</b>① 单位只<b>停用不删除</b> —— 用过的单位一旦删掉，老商品与历史订单就会显示成空白。<br>
        ② 停用后：<b>新建商品与供应商端不再出现</b>该单位；<b>老商品与历史订单照常显示原单位</b>，不受影响。<br>
        ③ 排序决定供应商端 chip 的<b>平铺顺序</b>；预置的是新表初始化数据，不动任何现有商品。
      </div>
    </el-card>

    <!-- ＋ 新增单位 -->
    <el-dialog v-model="dialog" title="新增单位" width="460px" @closed="dupErr = ''">
      <el-form label-width="88px">
        <el-form-item label="单位名称" required>
          <el-input
            v-model="form.name"
            placeholder="如：瓶"
            maxlength="20"
            @input="dupErr = ''"
          />
          <!-- 重名 → 红字，且**不提交**（同名含已停用的一律拦） -->
          <div v-if="dupErr" class="dup-err">{{ dupErr }}</div>
          <div v-else class="field-tip">保存后按当前排序追加到列表末尾，供应商端立即可选</div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="1" :controls="false" placeholder="留空则追加到末尾" />
          <div class="field-tip">数字越小越靠前；留空则追加到末尾</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio :value="1">启用</el-radio>
            <el-radio :value="0">停用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { unitAdminApi } from '../../api/modules'

const list = ref([])
const loading = ref(false)
const busyId = ref(null)

const dialog = ref(false)
const submitting = ref(false)
const dupErr = ref('')
const form = ref({ name: '', sort: null, status: 1 })

async function load() {
  loading.value = true
  try {
    list.value = await unitAdminApi.listAll()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function openCreate() {
  dupErr.value = ''
  form.value = { name: '', sort: null, status: 1 }
  dialog.value = true
}

async function submit() {
  const name = (form.value.name || '').trim()
  if (!name) { dupErr.value = '请填写单位名称'; return }
  // 重名（**含已停用项**）→ 红字「该单位已存在，请换一个」，**不提交**
  if (list.value.some((u) => u.name === name)) {
    dupErr.value = '该单位已存在，请换一个'
    return
  }
  submitting.value = true
  try {
    await unitAdminApi.create({
      name,
      ...(form.value.sort != null && form.value.sort !== '' ? { sort: Number(form.value.sort) } : {}),
      status: form.value.status,
    })
    ElMessage.success('已新增')
    dialog.value = false
    load()
  } catch (e) {
    // 兜底：并发下库层唯一键撞车 → 后端同一句文案，红字回显到输入框下方
    if (e && e.message && e.message.indexOf('已存在') >= 0) dupErr.value = '该单位已存在，请换一个'
  } finally {
    submitting.value = false
  }
}

/// 上移 / 下移：与相邻行**交换 sort**，写库后再整表刷新（刷新后仍生效）
async function move(row, index, delta) {
  const target = list.value[index + delta]
  if (!target) return
  busyId.value = row.id
  try {
    await unitAdminApi.update(row.id, { sort: target.sort })
    await unitAdminApi.update(target.id, { sort: row.sort })
    load()
  } catch (e) { /* 已提示 */ } finally {
    busyId.value = null
  }
}

/// 停用 / 启用（口径：只停用不删除 —— 老商品与历史订单照常显示原单位）
async function toggle(row) {
  busyId.value = row.id
  try {
    await unitAdminApi.update(row.id, { status: row.status === 1 ? 0 : 1 })
    ElMessage.success(row.status === 1 ? '已停用' : '已启用')
    load()
  } catch (e) { /* 已提示 */ } finally {
    busyId.value = null
  }
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 14px; font-weight: 600; }
.head-tip { font-size: 12px; color: #909399; font-weight: 400; margin-left: 8px; }
.field-tip { font-size: 12px; color: #909399; line-height: 1.7; margin-top: 4px; }
.dup-err { font-size: 12px; color: #f56c6c; line-height: 1.7; margin-top: 4px; }
.foot-tip { font-size: 12px; color: #909399; line-height: 1.95; margin-top: 12px; }
.foot-tip b { color: #4e5969; }
</style>
