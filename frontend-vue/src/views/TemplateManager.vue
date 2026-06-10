<template>
  <div class="tm-layout">
    <aside class="tm-sidebar">
      <div class="tm-sidebar-header">
        <h2>📁 模板管理</h2>
        <button class="btn sm primary" @click="createNew">+ 新建</button>
      </div>
      <ul class="tree-root">
        <TemplateTreeNode
          v-for="node in store.tree" :key="node.id"
          :node="node" :depth="0" :selected-id="selectedId"
          @select="onSelect"
          @edit="onEdit"
          @duplicate="onDuplicate"
          @delete="onDelete"
        />
      </ul>
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
import TemplateTreeNode from '../components/TemplateTreeNode.vue'
import TemplateEditor from '../components/TemplateEditor.vue'

const store = useTemplateStore()
const selectedId = ref(null)
const isNew = ref(false)

const editingTemplate = computed(() => {
  if (!selectedId.value) return null
  if (isNew.value) return { id: '', name: '', document_type: 'invoice', vendor: 'generic', description: '', extraction_fields: [], line_item_fields: [] }
  return store.currentTemplate
})

async function onSelect(node) {
  if (node.is_group) return
  selectedId.value = node.id
  isNew.value = false
  try { await store.loadTemplate(node.id) } catch (e) { /* ignore */ }
}

async function onEdit(node) {
  selectedId.value = node.id
  isNew.value = false
  try { await store.loadTemplate(node.id) } catch (e) { /* ignore */ }
}

async function onDuplicate(node) {
  try {
    await store.duplicateTemplate(node.id)
    alert('模板已复制')
  } catch (e) { alert('复制失败: ' + e.message) }
}

async function onDelete(node) {
  if (!confirm(`确定删除模板 "${node.name}"？`)) return
  try {
    await store.deleteTemplate(node.id)
    selectedId.value = null
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
.tm-sidebar { background: white; border-right: 1px solid var(--c-gray-200); padding: 20px; overflow-y: auto; }
.tm-sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.tm-sidebar-header h2 { font-size: 16px; font-weight: 700; }
.tree-root { padding: 0; margin: 0; list-style: none; }
.tm-content { padding: 24px; overflow-y: auto; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn.sm { padding: 6px 12px; font-size: 12px; }
.btn.primary { background: var(--c-primary); color: white; }
.btn.primary:hover { background: var(--c-primary-dark); }
</style>
