<template>
  <div class="editor-panel" v-if="template">
    <div class="editor-header">
      <h3>{{ isNew ? '新建抽取模板' : '编辑抽取模板' }}</h3>
      <div class="editor-actions">
        <button class="btn sm outline" @click="$emit('cancel')">取消</button>
        <button class="btn sm primary" @click="save" :disabled="isSaving">{{ isSaving ? '保存中...' : '保存' }}</button>
      </div>
    </div>
    <div class="editor-body">
      <!-- Basic Info -->
      <div class="form-row">
        <label>基本信息</label>
        <div class="inline-fields">
          <div class="if-item">
            <span class="if-label">模板名称</span>
            <input v-model="form.name" class="input" placeholder="例如：进料加工报关单" />
          </div>
          <div class="if-item" v-if="isNew">
            <span class="if-label">模板 ID</span>
            <input v-model="form.id" class="input" placeholder="template_id (英文标识)" />
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>描述</label>
        <textarea v-model="form.description" class="input" rows="2" placeholder="模板适用场景及说明"></textarea>
      </div>

      <!-- Extraction Fields -->
      <div class="form-row">
        <label>提取字段 ({{ extractFields.length }})</label>
        <div class="field-list">
          <div class="field-header">
            <span>标签</span>
            <span>数据来源</span>
            <span></span>
          </div>
          <div v-for="(f, i) in extractFields" :key="i" class="field-row">
            <input v-model="f.label" class="sm-input" placeholder="字段标签" />
            <input v-model="f.data_source" class="sm-input" placeholder="数据来源说明" />
            <div class="act-col">
              <button class="btn-icon danger" @click="extractFields.splice(i, 1)" title="删除">&times;</button>
            </div>
          </div>
          <button class="btn sm outline" @click="addField">+ 添加字段</button>
        </div>
      </div>

      <!-- Line Item Toggle -->
      <div class="form-row">
        <label>商品明细</label>
        <label class="toggle-label">
          <input type="checkbox" v-model="form.enable_line_items" />
          <span>需要识别商品明细行</span>
        </label>
      </div>

      <!-- ═══ Prompt Config (Structured Rule Builder) ═══ -->
      <div class="form-row">
        <label>抽取配置</label>
        <div class="config-section">
          <!-- Role -->
          <div class="config-row">
            <span class="config-label">角色设定</span>
            <input v-model="promptConfig.role" class="input" placeholder="专业报关员" />
          </div>
          <!-- Doc types -->
          <div class="config-row">
            <span class="config-label">资料类型</span>
            <input v-model="promptConfig.doc_types" class="input" placeholder="客户委托邮件、商业发票、装箱单..." />
          </div>
        </div>
      </div>

      <!-- Rules -->
      <div class="form-row">
        <label>抽取规则</label>
        <div class="rules-list">
          <div v-for="(rule, i) in promptConfig.rules" :key="i" class="rule-item">
            <label class="rule-toggle">
              <input type="checkbox" v-model="rule.enabled" />
              <span class="rule-text">{{ rule.label }}</span>
            </label>
            <div class="rule-actions">
              <button class="btn-icon" @click="editRule(i)" title="编辑">✎</button>
              <button class="btn-icon danger" @click="promptConfig.rules.splice(i, 1)" title="删除">&times;</button>
            </div>
          </div>
          <button class="btn sm outline" @click="addRule">+ 添加规则</button>
        </div>
      </div>

      <!-- Format -->
      <div class="form-row">
        <label>数值精度</label>
        <div class="format-grid">
          <div class="fmt-item">
            <span>重量小数位</span>
            <input type="number" v-model.number="promptConfig.format.weight_decimals" min="0" max="6" class="num-input" />
          </div>
          <div class="fmt-item">
            <span>体积小数位</span>
            <input type="number" v-model.number="promptConfig.format.volume_decimals" min="0" max="6" class="num-input" />
          </div>
          <div class="fmt-item">
            <span>金额小数位</span>
            <input type="number" v-model.number="promptConfig.format.amount_decimals" min="0" max="6" class="num-input" />
          </div>
        </div>
      </div>

      <!-- Additional notes -->
      <div class="form-row">
        <label>附加说明</label>
        <textarea v-model="promptConfig.additional_notes" class="input" rows="3" placeholder="可选：补充业务规则或特殊要求"></textarea>
      </div>

      <!-- Advanced toggle -->
      <div class="form-row">
        <label class="toggle-label" @click="showAdvanced = !showAdvanced" style="cursor:pointer">
          <span class="adv-toggle">{{ showAdvanced ? '▼' : '▶' }} 高级模式（查看原始提示词）</span>
        </label>
        <div v-if="showAdvanced" class="advanced-section">
          <p class="adv-hint">以下为系统根据上方配置自动生成的提示词预览（只读）。如需完全自定义，可清空上方"抽取配置"部分后直接编辑原始模板。</p>
          <textarea :value="generatedPromptPreview" class="input mono" rows="14" readonly></textarea>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="editor-empty">
    <p>请从左侧列表选择一个模板进行编辑，或点击"新建模板"</p>
  </div>
</template>

<script setup>
import { ref, watch, computed, reactive } from 'vue'

const props = defineProps({ template: Object, isNew: Boolean, isSaving: Boolean })
const emit = defineEmits(['save', 'cancel'])

const form = ref({ name: '', id: '', description: '', extraction_fields: [], enable_line_items: false })
const showAdvanced = ref(false)

const defaultPromptConfig = () => ({
  role: '专业报关员',
  doc_types: '',
  rules: [],
  format: { weight_decimals: 3, volume_decimals: 4, amount_decimals: 2 },
  additional_notes: '',
})

const promptConfig = ref(defaultPromptConfig())

watch(() => props.template, (t) => {
  if (t) {
    const fields = (t.extraction_fields || []).map(f => ({
      label: f.label || '',
      data_source: f.data_source || '',
      _orig_name: f.name || '',
    }))
    const hasLineItems = (t.line_item_fields && t.line_item_fields.length > 0) || false
    form.value = {
      ...t,
      extraction_fields: fields,
      enable_line_items: hasLineItems,
    }
    // Load prompt_config
    if (t.prompt_config) {
      promptConfig.value = {
        role: t.prompt_config.role || '专业报关员',
        doc_types: t.prompt_config.doc_types || '',
        rules: (t.prompt_config.rules || []).map(r => ({ ...r })),
        format: { ...defaultPromptConfig().format, ...(t.prompt_config.format || {}) },
        additional_notes: t.prompt_config.additional_notes || '',
      }
    } else {
      promptConfig.value = defaultPromptConfig()
    }
  } else {
    form.value = { name: '', id: '', description: '', extraction_fields: [], enable_line_items: false }
    promptConfig.value = defaultPromptConfig()
  }
}, { immediate: true })

const extractFields = computed({
  get: () => form.value.extraction_fields || [],
  set: (v) => { form.value.extraction_fields = v },
})

function addField() {
  extractFields.value.push({ label: '', data_source: '', _orig_name: '' })
}

function addRule() {
  const label = prompt('输入新规则描述：')
  if (label && label.trim()) {
    promptConfig.value.rules.push({ key: `custom_${Date.now()}`, label: label.trim(), enabled: true })
  }
}

function editRule(index) {
  const rule = promptConfig.value.rules[index]
  const newLabel = prompt('编辑规则描述：', rule.label)
  if (newLabel !== null && newLabel.trim()) {
    rule.label = newLabel.trim()
  }
}

/** Auto-generate a snake_case field name from label */
function generateName(label, index) {
  if (!label) return `field_${index + 1}`
  const ascii = label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, ' ').trim()
  if (/^[a-zA-Z]/.test(ascii)) {
    return ascii.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
  }
  return `field_${index + 1}`
}

/** Generate a preview of the prompt that would be assembled */
const generatedPromptPreview = computed(() => {
  const cfg = promptConfig.value
  const fields = extractFields.value
  const fieldCount = fields.length

  let parts = []
  parts.push(`你是一位${cfg.role}，请从以下整套报关资料中综合提取报关单所需的${fieldCount}个字段信息。`)
  if (cfg.doc_types) {
    parts.push(`\n这套资料包含：${cfg.doc_types}。`)
    parts.push('请交叉引用所有文件内容，准确填写每个字段。')
  }

  parts.push(`\n## 需要提取的${fieldCount}个字段：\n`)
  parts.push('| 序号 | 字段 | 数据来源 |')
  parts.push('|------|------|----------|')
  fields.forEach((f, i) => {
    parts.push(`| ${i + 1} | ${f.label || ''} | ${f.data_source || ''} |`)
  })

  const enabled = cfg.rules.filter(r => r.enabled)
  if (enabled.length) {
    parts.push('\n## 抽取规则：\n')
    enabled.forEach((r, i) => parts.push(`${i + 1}. ${r.label}`))
  }

  parts.push('\n## 输出格式要求：\n')
  parts.push('1. 先输出「报关单主要信息」表格（序号|字段|值|置信度|数据来源）')
  parts.push('2. 再输出「商品明细」表格')
  parts.push(`3. 重量保留${cfg.format.weight_decimals}位小数，体积保留${cfg.format.volume_decimals}位小数，金额保留${cfg.format.amount_decimals}位小数`)
  parts.push('4. **绝对禁止省略、合并、截断明细行**')

  if (cfg.additional_notes) {
    parts.push(`\n## 附加说明：\n${cfg.additional_notes}`)
  }

  parts.push('\n## 整套报关资料内容如下：\n{content}')
  return parts.join('\n')
})

function save() {
  const data = {
    name: form.value.name,
    id: form.value.id,
    description: form.value.description || '',
    prompt_config: {
      role: promptConfig.value.role,
      doc_types: promptConfig.value.doc_types,
      rules: promptConfig.value.rules.map(r => ({ key: r.key, label: r.label, enabled: r.enabled })),
      format: { ...promptConfig.value.format },
      additional_notes: promptConfig.value.additional_notes || '',
    },
    system_prompt: `你是一位${promptConfig.value.role}，擅长从国际物流单据中提取结构化信息。`,
    prompt_template: '',
    extraction_fields: (form.value.extraction_fields || []).map((f, i) => ({
      name: f._orig_name || generateName(f.label, i),
      label: f.label,
      field_no: i + 1,
      description: '',
      data_source: f.data_source || '',
      data_type: 'string',
    })),
    line_item_fields: form.value.enable_line_items
      ? (props.template?.line_item_fields || [
          {name: 'item_no', label: '序号'},
          {name: 'product_code', label: '产品编号'},
          {name: 'product_name', label: '品名'},
          {name: 'declaration_quantity', label: '申报数量'},
          {name: 'unit', label: '单位'},
          {name: 'unit_price', label: '单价'},
          {name: 'amount', label: '金额'},
          {name: 'country_of_origin', label: '原产国'},
        ])
      : [],
  }
  emit('save', data)
}
</script>

<style scoped>
.editor-panel { background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius-lg); overflow: hidden; }
.editor-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--c-gray-200); }
.editor-header h3 { font-size: 16px; font-weight: 700; }
.editor-actions { display: flex; gap: 8px; }
.editor-body { padding: 20px; max-height: calc(100vh - 160px); overflow-y: auto; }
.form-row { margin-bottom: 18px; }
.form-row > label { display: block; font-size: 12px; font-weight: 600; color: var(--c-gray-500); text-transform: uppercase; margin-bottom: 6px; letter-spacing: .5px; }
.input { width: 100%; padding: 8px 12px; border: 1px solid var(--c-gray-300); border-radius: var(--radius); font-size: 14px; font-family: inherit; }
.input:focus { outline: none; border-color: var(--c-primary); }
.sm-input { padding: 6px 8px; border: 1px solid var(--c-gray-300); border-radius: 4px; font-size: 12px; font-family: inherit; min-width: 0; }
.sm-input:focus { outline: none; border-color: var(--c-primary); }

.field-list { display: flex; flex-direction: column; gap: 4px; }
.field-header { display: grid; grid-template-columns: 1fr 1fr 32px; gap: 6px; padding: 4px 0; font-size: 11px; font-weight: 600; color: var(--c-gray-500); }
.field-row { display: grid; grid-template-columns: 1fr 1fr 32px; gap: 6px; align-items: center; }
.act-col { display: flex; gap: 2px; }
.btn-icon { background: none; border: none; cursor: pointer; font-size: 14px; color: var(--c-gray-400); padding: 2px 4px; border-radius: 3px; transition: all .1s; }
.btn-icon:hover { background: var(--c-gray-100); color: var(--c-gray-700); }
.btn-icon.danger:hover { color: var(--c-danger); background: #fef2f2; }

.toggle-label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--c-gray-700); cursor: pointer; }
.toggle-label input { accent-color: var(--c-primary); width: 16px; height: 16px; }

/* ─── Config section ─── */
.config-section { display: flex; flex-direction: column; gap: 10px; }
.config-row { display: flex; align-items: center; gap: 10px; }
.config-label { font-size: 13px; font-weight: 500; color: var(--c-gray-600); min-width: 70px; flex-shrink: 0; }

/* ─── Rules ─── */
.rules-list { display: flex; flex-direction: column; gap: 6px; }
.rule-item { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--c-gray-50); border: 1px solid var(--c-gray-200); border-radius: var(--radius); }
.rule-toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 1; min-width: 0; }
.rule-toggle input { accent-color: var(--c-primary); width: 16px; height: 16px; flex-shrink: 0; }
.rule-text { font-size: 13px; color: var(--c-gray-700); }
.rule-actions { display: flex; gap: 2px; flex-shrink: 0; }

/* ─── Format ─── */
.format-grid { display: flex; gap: 16px; flex-wrap: wrap; }
.fmt-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-gray-600); }
.num-input { width: 52px; padding: 4px 8px; border: 1px solid var(--c-gray-300); border-radius: 4px; font-size: 13px; text-align: center; }
.num-input:focus { outline: none; border-color: var(--c-primary); }

/* ─── Advanced ─── */
.adv-toggle { font-size: 13px; color: var(--c-gray-500); user-select: none; }
.advanced-section { margin-top: 8px; }
.adv-hint { font-size: 11px; color: var(--c-gray-400); margin-bottom: 6px; }
.mono { font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.6; }

.inline-fields { display: flex; gap: 12px; }
.if-item { flex: 1; min-width: 0; }
.if-label { display: block; font-size: 11px; font-weight: 600; color: var(--c-gray-500); margin-bottom: 3px; }
.editor-empty { text-align: center; padding: 80px 40px; color: var(--c-gray-400); }

.btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn.sm { padding: 6px 12px; font-size: 12px; }
.btn.primary { background: var(--c-primary); color: white; }
.btn.primary:hover { background: var(--c-primary-dark); }
.btn.primary:disabled { background: var(--c-gray-300); cursor: not-allowed; }
.btn.outline { background: white; color: var(--c-primary); border: 1px solid var(--c-primary); }
.btn.outline:hover { background: var(--c-primary-light); }
</style>
