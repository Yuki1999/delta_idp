<template>
  <div class="tm-layout">
    <aside class="tm-sidebar">
      <div class="tm-sidebar-header">
        <h2><Layers :size="16" :stroke-width="2" style="vertical-align:-3px" /> 抽取模板</h2>
        <button class="btn sm primary" @click="createNew"><Plus :size="13" :stroke-width="2" /> 新建</button>
      </div>
      <div class="tm-list">
        <div
          v-for="tpl in store.tree" :key="tpl.id"
          class="tm-item" :class="{ active: selectedId === tpl.id }"
          @click="onSelect(tpl)"
        >
          <div class="tm-item-name">{{ tpl.name }}</div>
          <div class="tm-item-meta">
            <span class="tm-field-count">{{ tpl.field_count || 0 }} 个字段</span>
          </div>
          <div class="tm-item-actions">
            <button class="btn-icon" @click.stop="onDuplicate(tpl)" title="复制" aria-label="复制模板"><Copy :size="13" :stroke-width="1.5" /></button>
            <button class="btn-icon danger" @click.stop="onDelete(tpl)" title="删除" aria-label="删除模板"><Trash2 :size="13" :stroke-width="1.5" /></button>
          </div>
        </div>
        <div v-if="!store.tree.length" class="tm-empty">暂无模板</div>
      </div>
    </aside>
    <section class="tm-content">
      <TemplateEditor
        :template="editingTemplate"
        :is-new="isNew"
        :is-saving="store.isSaving"
        @save="onSave"
        @cancel="cancelEdit"
      />
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTemplateStore } from '../stores/templates.js'
import TemplateEditor from '../components/TemplateEditor.vue'
import { Layers, Plus, Copy, Trash2 } from '../components/icons.js'

const store = useTemplateStore()
const selectedId = ref(null)
const isNew = ref(false)

const editingTemplate = computed(() => {
  if (!selectedId.value) return null
  if (isNew.value) return { id: '', name: '', description: '', extraction_fields: [], line_item_fields: [] }
  return store.currentTemplate
})

async function onSelect(tpl) {
  selectedId.value = tpl.id
  isNew.value = false
  try { await store.loadTemplate(tpl.id) } catch (e) { /* ignore */ }
}

async function onDuplicate(tpl) {
  try {
    await store.duplicateTemplate(tpl.id)
    alert('模板已复制')
  } catch (e) { alert('复制失败: ' + e.message) }
}

async function onDelete(tpl) {
  if (!confirm(`确定删除模板 "${tpl.name}"？`)) return
  try {
    await store.deleteTemplate(tpl.id)
    if (selectedId.value === tpl.id) selectedId.value = null
  } catch (e) { alert('删除失败: ' + e.message) }
}

function createNew() {
  selectedId.value = 'new'
  isNew.value = true
}

async function onSave(data) {
  try {
    if (isNew.value) {
      await store.createTemplate(data)
      isNew.value = false
      selectedId.value = data.id || data.name.replace(/\s+/g, '_').toLowerCase()
    } else {
      await store.updateTemplate(selectedId.value, data)
      await store.loadTemplate(selectedId.value)
    }
  } catch (e) { alert('保存失败: ' + e.message) }
}

function cancelEdit() {
  selectedId.value = null
  isNew.value = false
}

onMounted(() => { store.loadTree() })
</script>

<style scoped>
.tm-layout { display: grid; grid-template-columns: 300px 1fr; flex: 1; min-height: 0; }
.tm-sidebar { background: white; border-right: 1px solid var(--c-gray-200); padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }
.tm-sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.tm-sidebar-header h2 { font-size: 16px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; }
.tm-list { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.tm-item { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius); cursor: pointer; transition: all var(--t-fast); border: 1px solid transparent; }
.tm-item:hover { background: var(--c-gray-50); border-color: var(--c-gray-200); }
.tm-item.active { background: var(--c-primary-light); border-color: var(--c-primary); }
.tm-item-name { flex: 1; font-size: 13px; font-weight: 600; color: var(--c-gray-800); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-item-meta { font-size: 10px; color: var(--c-gray-400); white-space: nowrap; }
.tm-field-count { background: var(--c-gray-100); padding: 2px 6px; border-radius: 8px; }
.tm-item-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--t-fast); }
.tm-item:hover .tm-item-actions { opacity: 1; }
.tm-empty { text-align: center; padding: 40px 20px; color: var(--c-gray-400); font-size: 13px; }
.tm-content { padding: 24px; overflow-y: auto; }

.btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 8px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all var(--t-normal); }
.btn.sm { padding: 6px 12px; font-size: 12px; }
.btn.primary { background: var(--c-primary); color: white; box-shadow: var(--shadow-sm); }
.btn.primary:hover { background: var(--c-primary-dark); box-shadow: var(--shadow-md); }
.btn.primary:active { transform: scale(.98); }
.btn-icon { background: none; border: none; cursor: pointer; padding: 4px; border-radius: 4px; transition: all var(--t-fast); display: inline-flex; align-items: center; color: var(--c-gray-500); }
.btn-icon:hover { background: var(--c-gray-100); color: var(--c-gray-800); }
.btn-icon.danger:hover { background: var(--c-danger-light); color: var(--c-danger); }
</style>
