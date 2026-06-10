<template>
  <div class="review-layout">
    <!-- Left Panel: Review List -->
    <aside class="review-list-panel">
      <h2 class="panel-header">📋 审核中心</h2>

      <div class="list-section">
        <h3 class="sec-label">⏳ 待审核 <span class="count-badge">{{ store.pendingItems.length }}</span></h3>
        <div v-if="!store.pendingItems.length" class="empty-hint">暂无待审核项</div>
        <div
          v-for="item in store.pendingItems" :key="item.id"
          class="review-card" :class="{ active: store.currentItem?.id === item.id }"
          @click="selectItem(item.id)"
        >
          <div class="rc-header">
            <span class="rc-file">{{ item.filename }}</span>
            <span class="rc-badge" :class="item.document_type">{{ item.document_type === 'invoice' ? '发票' : '装箱单' }}</span>
          </div>
          <div class="rc-meta">
            <span class="rc-source" :class="item.source">{{ item.source === 'agent' ? '🤖 Agent' : '📑 抽取' }}</span>
            <span>{{ item.fields?.length || 0 }} 字段</span>
            <span>{{ fmtTime(item.created_at) }}</span>
          </div>
        </div>
      </div>

      <div class="list-section">
        <h3 class="sec-label">✅ 已审核 <span class="count-badge done">{{ store.confirmedItems.length }}</span></h3>
        <div v-if="!store.confirmedItems.length" class="empty-hint">暂无已审核项</div>
        <div
          v-for="item in store.confirmedItems.slice(0, 20)" :key="item.id"
          class="review-card done"
          @click="selectItem(item.id)"
        >
          <div class="rc-header">
            <span class="rc-file">{{ item.filename }}</span>
            <span class="rc-status">{{ item.status === 'modified' ? '已修改' : '已确认' }}</span>
          </div>
          <div class="rc-meta">
            <span class="rc-source" :class="item.source">{{ item.source === 'agent' ? '🤖 Agent' : '📑 抽取' }}</span>
            <span>{{ item.fields?.length || 0 }} 字段</span>
            <span>{{ fmtTime(item.updated_at) }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Right Panel: Review Detail -->
    <section class="review-detail" v-if="store.currentItem">
      <div class="detail-header">
        <div>
          <h1>{{ store.currentItem.filename }}</h1>
          <div class="detail-tags">
            <span class="tag">{{ store.currentItem.document_type === 'invoice' ? '商业发票' : '装箱单' }}</span>
            <span class="tag">{{ store.currentItem.vendor === 'samsung' ? '三星' : '通用' }}</span>
            <span class="tag" :class="store.currentItem.source">{{ store.currentItem.source === 'agent' ? '🤖 Agent' : '📑 单据抽取' }}</span>
            <span class="tag">{{ store.currentItem.method }}</span>
            <span class="tag" :class="store.currentItem.status">{{ statusLabel }}</span>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn primary" @click="confirmItem" :disabled="store.isSaving">
            ✅ 全部确认
          </button>
          <button class="btn outline" @click="saveEdits" :disabled="store.isSaving">
            💾 保存修改
          </button>
        </div>
      </div>

      <div class="detail-body">
        <!-- Left: Field Editor Table -->
        <div class="field-editor">
          <h3>📝 提取字段</h3>
          <table class="field-table">
            <thead>
              <tr>
                <th style="width:22%">字段名</th>
                <th style="width:38%">提取值</th>
                <th style="width:8%">置信度</th>
                <th style="width:10%">位置参考</th>
                <th style="width:22%">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(f, i) in editableFields" :key="f.name">
                <td class="field-name">{{ f.label || f.name }}</td>
                <td>
                  <input
                    v-model="f.value"
                    class="field-input"
                    :class="{ modified: f._modified }"
                    @input="f._modified = true"
                  />
                </td>
                <td>
                  <span class="conf-badge" :class="f.confidence">{{ confLabel(f.confidence) }}</span>
                </td>
                <td class="field-loc" :title="f.location">{{ f.location || '—' }}</td>
                <td>
                  <button
                    class="action-btn confirm" title="确认此字段"
                    @click="f._confirmed = !f._confirmed"
                    :class="{ active: f._confirmed }"
                  >✓</button>
                  <button class="action-btn edit" title="标记需修改" @click="focusField(i)">✏</button>
                </td>
              </tr>
            </tbody>
          </table>

          <button class="btn-dashed" @click="addField">+ 添加字段</button>

          <!-- Markdown result preview -->
          <div v-if="store.currentItem.markdown" class="markdown-preview">
            <h3>📄 原始提取结果</h3>
            <div class="markdown-body" v-html="renderedMarkdown"></div>
          </div>
        </div>

        <!-- Right: Original Document Preview -->
        <div class="doc-preview">
          <h3>📎 原始文档</h3>
          <div class="doc-placeholder">
            <div class="doc-icon">📊</div>
            <p>{{ store.currentItem.filename }}</p>
            <p class="doc-hint">原始文件路径：{{ store.currentItem.file_path }}</p>
            <p class="doc-hint">请在本机打开原始文件对照审核</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Empty state -->
    <section class="review-detail empty" v-else>
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h2>审核中心</h2>
        <p>从左侧列表选择一个待审核项，开始对照原始文档审核提取结果。</p>
        <p class="empty-sub">单据抽取和智能助手 Agent 的提取结果会自动进入审核队列。</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { marked } from 'marked'
import { useReviewStore } from '../stores/review.js'

marked.setOptions({ breaks: true, gfm: true })

const store = useReviewStore()
const editableFields = ref([])

const statusLabel = computed(() => {
  const m = { pending: '待审核', confirmed: '已确认', modified: '已修改' }
  return m[store.currentItem?.status] || ''
})

const renderedMarkdown = computed(() => {
  const md = store.currentItem?.markdown
  if (!md) return ''
  try { return marked.parse(md) } catch { return md }
})

function confLabel(c) {
  const m = { high: '高', medium: '中', low: '低' }
  return m[c] || c || '—'
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso.slice(0, 16) }
}

async function selectItem(id) {
  await store.loadItem(id)
  // Deep clone fields for editing
  editableFields.value = (store.currentItem?.fields || []).map(f => ({
    ...f,
    _modified: false,
    _confirmed: false,
  }))
}

function focusField(i) {
  editableFields.value[i]._modified = true
}

function addField() {
  editableFields.value.push({
    name: '', label: '', value: '', confidence: 'low', location: '', _modified: true, _confirmed: false,
  })
}

async function confirmItem() {
  if (!store.currentItem) return
  await store.confirmItem(store.currentItem.id)
}

async function saveEdits() {
  if (!store.currentItem) return
  const fields = editableFields.value.map(({ _modified, _confirmed, ...f }) => f)
  const corrections = editableFields.value
    .filter(f => f._modified)
    .map(f => ({ name: f.name, original: store.currentItem.fields.find(of => of.name === f.name)?.value, corrected: f.value }))
  await store.saveCorrections(store.currentItem.id, fields, corrections)
  // Reset edit flags
  editableFields.value.forEach(f => { f._modified = false; f._confirmed = false })
}

onMounted(() => store.loadItems())
</script>

<style scoped>
.review-layout { display: grid; grid-template-columns: 320px 1fr; flex: 1; min-height: 0; }

/* ─── Left Panel ────────────────────────────── */
.review-list-panel { background: white; border-right: 1px solid var(--c-gray-200); overflow-y: auto; display: flex; flex-direction: column; }
.panel-header { font-size: 16px; font-weight: 700; padding: 16px 16px 12px; border-bottom: 1px solid var(--c-gray-100); }
.list-section { padding: 0 12px 12px; }
.sec-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--c-gray-400); padding: 12px 4px 8px; display: flex; align-items: center; gap: 8px; }
.count-badge { background: var(--c-warning-light); color: var(--c-warning); font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.count-badge.done { background: var(--c-success-light); color: var(--c-success); }
.empty-hint { font-size: 12px; color: var(--c-gray-400); padding: 8px 4px; }
.review-card { padding: 10px 12px; border-radius: var(--radius); cursor: pointer; transition: all .1s; margin-bottom: 4px; border: 1px solid transparent; }
.review-card:hover { background: var(--c-gray-50); }
.review-card.active { background: var(--c-primary-light); border-color: var(--c-primary); }
.review-card.done { opacity: .7; }
.rc-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rc-file { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-badge { font-size: 10px; padding: 1px 8px; border-radius: 8px; background: var(--c-primary-light); color: var(--c-primary); }
.rc-badge.packing_list { background: var(--c-success-light); color: var(--c-success); }
.rc-status { font-size: 10px; color: var(--c-success); }
.rc-meta { display: flex; gap: 12px; font-size: 11px; color: var(--c-gray-400); margin-top: 4px; }

/* ─── Right Panel ───────────────────────────── */
.review-detail { overflow-y: auto; display: flex; flex-direction: column; }
.review-detail.empty { display: flex; align-items: center; justify-content: center; }
.detail-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--c-gray-100); background: white; gap: 16px; flex-wrap: wrap; }
.detail-header h1 { font-size: 18px; font-weight: 700; }
.detail-tags { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.tag { font-size: 11px; padding: 2px 10px; border-radius: 10px; background: var(--c-gray-100); color: var(--c-gray-600); }
.tag.pending { background: var(--c-warning-light); color: var(--c-warning); }
.tag.confirmed { background: var(--c-success-light); color: var(--c-success); }
.tag.modified { background: var(--c-purple-light); color: var(--c-purple); }
.tag.agent { background: #ede9fe; color: #7c3aed; }
.tag.extraction { background: var(--c-primary-light); color: var(--c-primary); }
.rc-source { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.rc-source.agent { background: #ede9fe; color: #7c3aed; }
.rc-source.extraction { background: var(--c-primary-light); color: var(--c-primary); }
.detail-actions { display: flex; gap: 8px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn.primary { background: var(--c-primary); color: white; }
.btn.primary:hover { background: var(--c-primary-dark); }
.btn.outline { background: white; border: 1px solid var(--c-gray-300); color: var(--c-gray-700); }
.btn.outline:hover { background: var(--c-gray-50); }

.detail-body { display: grid; grid-template-columns: 1fr 320px; gap: 0; flex: 1; min-height: 0; overflow: hidden; }
.field-editor { padding: 20px 24px; overflow-y: auto; }
.field-editor h3 { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.field-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.field-table th { text-align: left; padding: 8px 10px; background: var(--c-gray-50); border-bottom: 1px solid var(--c-gray-200); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: var(--c-gray-500); }
.field-table td { padding: 6px 10px; border-bottom: 1px solid var(--c-gray-100); vertical-align: middle; }
.field-name { font-weight: 600; color: var(--c-gray-700); }
.field-input { width: 100%; padding: 6px 8px; border: 1px solid var(--c-gray-200); border-radius: 4px; font-size: 13px; font-family: inherit; }
.field-input:focus { outline: none; border-color: var(--c-primary); }
.field-input.modified { border-color: var(--c-warning); background: var(--c-warning-light); }
.field-loc { font-size: 10px; color: var(--c-gray-400); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conf-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; }
.conf-badge.high { background: var(--c-success-light); color: var(--c-success); }
.conf-badge.medium { background: var(--c-warning-light); color: var(--c-warning); }
.conf-badge.low { background: var(--c-danger-light); color: var(--c-danger); }
.action-btn { width: 28px; height: 28px; border-radius: 4px; border: 1px solid var(--c-gray-200); background: white; cursor: pointer; font-size: 12px; transition: all .1s; margin-right: 4px; }
.action-btn:hover { border-color: var(--c-gray-400); }
.action-btn.confirm.active { background: var(--c-success); color: white; border-color: var(--c-success); }
.action-btn.edit:hover { border-color: var(--c-warning); color: var(--c-warning); }
.btn-dashed { width: 100%; margin-top: 12px; padding: 10px; border: 2px dashed var(--c-gray-300); border-radius: var(--radius); background: none; cursor: pointer; font-size: 13px; color: var(--c-gray-500); transition: all .15s; }
.btn-dashed:hover { border-color: var(--c-primary); color: var(--c-primary); }

/* ─── Doc Preview ──────────────────────────── */
.doc-preview { background: var(--c-gray-50); border-left: 1px solid var(--c-gray-200); padding: 20px; overflow-y: auto; }
.doc-preview h3 { font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.doc-placeholder { text-align: center; padding: 60px 20px; color: var(--c-gray-400); }
.doc-icon { font-size: 48px; margin-bottom: 12px; }
.doc-placeholder p { font-size: 13px; margin-bottom: 4px; }
.doc-hint { font-size: 11px; color: var(--c-gray-300); }

/* ─── Markdown Preview ─────────────────────── */
.markdown-preview { margin-top: 24px; border-top: 1px solid var(--c-gray-200); padding-top: 16px; }
.markdown-preview h3 { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
.markdown-body { font-size: 14px; line-height: 1.7; }
.markdown-body :deep(table) { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.markdown-body :deep(th), .markdown-body :deep(td) { border: 1px solid var(--c-gray-200); padding: 4px 8px; text-align: left; }
.markdown-body :deep(th) { background: var(--c-gray-50); }

/* ─── Empty ────────────────────────────────── */
.empty-state { text-align: center; padding: 80px 40px; }
.empty-icon { font-size: 64px; margin-bottom: 16px; }
.empty-state h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.empty-state p { font-size: 14px; color: var(--c-gray-500); }
.empty-sub { font-size: 12px; color: var(--c-gray-400); margin-top: 4px; }

@media (max-width: 1024px) { .review-layout { grid-template-columns: 1fr; } .detail-body { grid-template-columns: 1fr; } }
</style>
