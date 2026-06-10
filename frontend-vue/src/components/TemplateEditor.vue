<template>
  <div class="editor-panel" v-if="template">
    <div class="editor-header">
      <h3>{{ isNew ? '新建模板' : '编辑模板' }}</h3>
      <div class="editor-actions">
        <button class="btn sm outline" @click="$emit('cancel')">取消</button>
        <button class="btn sm primary" @click="save" :disabled="isSaving">{{ isSaving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
    <div class="editor-body">
      <div class="form-row">
        <label>模板名称</label>
        <input v-model="form.name" class="input" placeholder="模板名称" />
      </div>
      <div class="form-row">
        <label>模板 ID</label>
        <input v-model="form.id" class="input" placeholder="template_id" :disabled="!isNew" />
      </div>
      <div class="form-row">
        <label>文档类型</label>
        <select v-model="form.document_type" class="input">
          <option value="invoice">发票 (Invoice)</option>
          <option value="packing_list">装箱单 (Packing List)</option>
        </select>
      </div>
      <div class="form-row">
        <label>厂商</label>
        <input v-model="form.vendor" class="input" placeholder="generic / samsung / ..." />
      </div>
      <div class="form-row">
        <label>描述</label>
        <textarea v-model="form.description" class="input" rows="2" placeholder="模板描述"></textarea>
      </div>
      <div class="form-row">
        <label>提取字段 ({{ extractFields.length }})</label>
        <div class="field-list">
          <div class="field-header">
            <span class="fh-col">字段名</span>
            <span class="fh-col">中文标签</span>
            <span class="fh-col fh-wide">搜索模式</span>
            <span class="fh-col">说明</span>
            <span class="fh-col fh-type">类型</span>
            <span class="fh-del"></span>
          </div>
          <div v-for="(f, i) in extractFields" :key="i" class="field-row">
            <input v-model="f.name" class="sm-input" placeholder="英文标识" title="字段英文标识，如 invoice_no" />
            <input v-model="f.label" class="sm-input" placeholder="中文标签" title="中文显示名，如 发票号码" />
            <input v-model="f.search_patterns_str" class="sm-input flex2" placeholder="关键词，逗号分隔" title="在文档中搜索的关键词，逗号分隔" />
            <input v-model="f.description" class="sm-input" placeholder="字段说明" title="字段含义及在单据中的位置" />
            <select v-model="f.data_type" class="sm-input fh-type">
              <option value="string">文本</option>
              <option value="date">日期</option>
              <option value="number">数值</option>
              <option value="array">数组</option>
            </select>
            <button class="btn sm danger-outline" @click="extractFields.splice(i, 1)">&times;</button>
          </div>
          <button class="btn sm outline" @click="extractFields.push({ name:'', label:'', search_patterns_str:'', description:'', data_type:'string' })">+ 添加字段</button>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="editor-empty">
    <p>请从左侧树中选择一个模板进行编辑，或点击"新建模板"</p>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'

const props = defineProps({ template: Object, isNew: Boolean, isSaving: Boolean })
const emit = defineEmits(['save', 'cancel'])

const form = ref({ name: '', id: '', document_type: 'invoice', vendor: 'generic', description: '', extraction_fields: [] })

watch(() => props.template, (t) => {
  if (t) {
    const fields = (t.extraction_fields || []).map(f => ({
      ...f,
      description: f.description || '',
      search_patterns_str: (f.search_patterns || []).join(', '),
    }))
    form.value = { ...t, extraction_fields: fields }
  } else {
    form.value = { name: '', id: '', document_type: 'invoice', vendor: 'generic', description: '', extraction_fields: [] }
  }
}, { immediate: true })

const extractFields = computed({
  get: () => form.value.extraction_fields || [],
  set: (v) => { form.value.extraction_fields = v },
})

function save() {
  const data = {
    ...form.value,
    extraction_fields: (form.value.extraction_fields || []).map(f => ({
      ...f,
      search_patterns: (f.search_patterns_str || '').split(',').map(s => s.trim()).filter(Boolean),
      search_patterns_str: undefined,
    })),
  }
  emit('save', data)
}
</script>

<style scoped>
.editor-panel { background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius-lg); overflow: hidden; }
.editor-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--c-gray-200); }
.editor-header h3 { font-size: 16px; }
.editor-actions { display: flex; gap: 8px; }
.editor-body { padding: 20px; }
.form-row { margin-bottom: 14px; }
.form-row label { display: block; font-size: 12px; font-weight: 600; color: var(--c-gray-500); text-transform: uppercase; margin-bottom: 4px; }
.input { width: 100%; padding: 8px 12px; border: 1px solid var(--c-gray-300); border-radius: var(--radius); font-size: 14px; font-family: inherit; }
.input:focus { outline: none; border-color: var(--c-primary); }
.sm-input { padding: 6px 8px; border: 1px solid var(--c-gray-300); border-radius: 4px; font-size: 13px; font-family: inherit; }
.sm-input:focus { outline: none; border-color: var(--c-primary); }
.flex2 { flex: 2; }
.field-list { display: flex; flex-direction: column; gap: 6px; }
.field-header { display: flex; gap: 6px; align-items: center; padding: 4px 0; }
.fh-col { flex: 1; font-size: 10px; font-weight: 700; color: var(--c-gray-400); text-transform: uppercase; letter-spacing: .3px; }
.fh-wide { flex: 2; }
.fh-type { flex: .6; }
.fh-del { width: 28px; flex-shrink: 0; }
.field-row { display: flex; gap: 6px; align-items: center; }
.editor-empty { text-align: center; padding: 80px 40px; color: var(--c-gray-400); }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn.sm { padding: 6px 12px; font-size: 12px; }
.btn.primary { background: var(--c-primary); color: white; }
.btn.primary:hover { background: var(--c-primary-dark); }
.btn.primary:disabled { background: var(--c-gray-300); cursor: not-allowed; }
.btn.outline { background: white; color: var(--c-primary); border: 1px solid var(--c-primary); }
.btn.outline:hover { background: var(--c-primary-light); }
.btn.danger-outline { background: none; color: var(--c-danger); border: none; font-size: 16px; cursor: pointer; }
.btn.danger-outline:hover { background: var(--c-danger-light); }
</style>
