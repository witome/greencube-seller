<template>
  <div>
    <el-card shadow="never">
      <div class="toolbar">
        <span>共 {{ list.length }} 个一级分类</span>
        <el-button type="primary" @click="openCreate">＋ 新增分类</el-button>
      </div>
      <el-table :data="list" v-loading="loading" stripe row-key="id" default-expand-all>
        <el-table-column prop="name" label="分类名称" min-width="180">
          <template #default="{ row }">
            <span class="cat-name">{{ row.name }}</span>
            <span v-if="row.children?.length" class="sub-count">（{{ row.children.length }} 个子类）</span>
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="80" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="confirmDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialog" :title="editing ? '编辑分类' : '新增分类'" width="420px">
      <el-form label-width="80px">
        <el-form-item label="分类名称">
          <el-input v-model="form.name" placeholder="如：时令蔬菜" maxlength="50" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" />
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
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { categoryAdminApi } from '../../api/modules'

const list = ref([])
const loading = ref(false)
const submitting = ref(false)
const dialog = ref(false)
const editing = ref(null)
const form = reactive({ name: '', sort: 0 })

async function load() {
  loading.value = true
  try {
    list.value = await categoryAdminApi.getCategories()
  } catch (e) { /* 已提示 */ } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.name = ''
  form.sort = 0
  dialog.value = true
}

function openEdit(row) {
  editing.value = row
  form.name = row.name
  form.sort = row.sort
  dialog.value = true
}

async function submit() {
  if (!form.name.trim()) { ElMessage.warning('请填写分类名称'); return }
  submitting.value = true
  try {
    if (editing.value) {
      await categoryAdminApi.updateCategory(editing.value.id, { name: form.name.trim(), sort: form.sort })
      ElMessage.success('已更新')
    } else {
      await categoryAdminApi.createCategory({ name: form.name.trim(), sort: form.sort })
      ElMessage.success('已新增')
    }
    dialog.value = false
    load()
  } catch (e) { /* 已提示 */ } finally {
    submitting.value = false
  }
}

async function confirmDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除分类「${row.name}」？`, '提示', { type: 'warning' })
  } catch (e) { return }
  await categoryAdminApi.deleteCategory(row.id)
  ElMessage.success('已删除')
  load()
}

onMounted(load)
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.cat-name { font-weight: 600; }
.sub-count { color: #909399; font-size: 12px; }
</style>
