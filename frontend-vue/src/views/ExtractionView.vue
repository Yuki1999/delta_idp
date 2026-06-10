<template>
  <div class="extraction-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <section class="panel">
        <h2 class="panel-title">📤 上传单据</h2>
        <UploadZone @files-selected="onFiles" />
        <div class="file-list">
          <FileChip v-for="(f, i) in store.uploadedFiles" :key="f.file_id" :file="f" @remove="store.removeFile(i)" />
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">⚙️ 抽取配置</h2>
        <div class="form-g">
          <label>文档类型</label>
          <select v-model="store.docType" class="select">
            <option value="auto">自动识别</option>
            <option value="invoice">发票 (Invoice)</option>
            <option value="packing_list">装箱单 (Packing List)</option>
          </select>
        </div>
        <div class="form-g">
          <label>提取模板</label>
          <select v-model="store.templateId" class="select">
            <option value="auto">自动选择模板</option>
            <option v-for="t in store.templates" :key="t.id" :value="t.id">{{ t.name }} {{ t.vendor !== 'generic' ? '(厂商专用)' : '(通用)' }}</option>
          </select>
        </div>
        <div class="form-g">
          <label>技术路径</label>
          <label v-for="m in methods" :key="m.value" class="radio-item">
            <input type="radio" :value="m.value" v-model="store.method" />
            <span><strong>{{ m.label }}</strong><small>{{ m.desc }}</small></span>
          </label>
        </div>
        <button class="btn primary full" @click="runExtraction" :disabled="!store.canExtract">
          🔍 {{ store.uploadedFiles.length ? `开始抽取 (${store.uploadedFiles.length} 个文件)` : '请先上传文件' }}
        </button>
        <StatusBadge :message="store.statusMsg" :type="store.statusType" />
      </section>

      <section class="panel">
        <h2 class="panel-title">📋 示例单据</h2>
        <button v-for="s in samples" :key="s.file" class="sample-btn" @click="loadSample(s.file)">
          <span class="sample-badge" :class="s.type">{{ s.type === 'invoice' ? 'IV' : 'PL' }}</span>
          {{ s.label }}
        </button>
      </section>

      <section class="panel">
        <h2 class="panel-title">📜 抽取历史</h2>
        <div v-if="!store.history.length" class="no-history">暂无历史记录</div>
        <div v-for="h in store.history" :key="h.id" class="history-item" :class="{ active: store.currentResult?._historyId === h.id }" @click="loadHistory(h.id)">
          <div class="hi-header">
            <span class="hi-file" :title="h.filename">{{ h.filename }}</span>
            <span class="hi-method">{{ h.method }}</span>
          </div>
          <div class="hi-meta">
            <span>{{ h.field_count || 0 }} 个字段</span>
            <span>{{ fmtTime(h.created_at) }}</span>
          </div>
          <button class="hi-del" @click.stop="delHistory(h.id)" title="删除">×</button>
        </div>
      </section>
    </aside>

    <!-- Content -->
    <section class="content">
      <div class="content-header">
        <h1>提取结果</h1>
        <div class="header-actions">
          <button
            v-if="store.currentResult?.reviewId"
            class="btn outline sm"
            @click="$router.push('/review')"
          >📋 前往审核</button>
          <ResultTabs v-model="activeTab" :tabs="tabs" />
        </div>
      </div>

      <div v-show="activeTab === 'cards'" class="result-area">
        <div v-if="store.currentResult?.fields?.length" class="result-grid">
          <FieldCard v-for="f in store.currentResult.fields" :key="f.name" :field="f" />
        </div>
        <div v-if="store.currentResult?.line_items?.length" style="margin-top: 16px">
          <h3 style="margin-bottom: 8px; font-size: 14px; color: var(--c-gray-500)">📦 商品明细</h3>
          <LineItemTable :items="store.currentResult.line_items" />
        </div>
        <div v-if="!store.currentResult?.fields?.length && !store.isProcessing" class="empty-state">
          <p>请上传单据并点击"开始抽取"</p>
        </div>
        <div v-if="store.isProcessing" class="empty-state">
          <p>⏳ 正在抽取中...</p>
        </div>
      </div>

      <div v-show="activeTab === 'raw'">
        <pre class="raw-code">{{ store.currentResult?.markdown || '请先执行抽取' }}</pre>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useExtractionStore } from '../stores/extraction.js'
import UploadZone from '../components/UploadZone.vue'
import FileChip from '../components/FileChip.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ResultTabs from '../components/ResultTabs.vue'
import FieldCard from '../components/FieldCard.vue'
import LineItemTable from '../components/LineItemTable.vue'

const store = useExtractionStore()
const activeTab = ref('cards')

const tabs = [
  { key: 'cards', label: '字段信息' },
  { key: 'raw', label: '原始数据' },
]

const methods = [
  { value: 'mineru', label: 'MinerU 解析', desc: 'MinerU 文档解析 + pi Agent 提取' },
  { value: 'qwen', label: 'Qwen3.6-27B', desc: '端到端视觉提取' },
]

const samples = [
  { file: 'DS12650253_IV(1).xlsx', label: 'DS12650253 发票', type: 'invoice' },
  { file: 'DS12650253_PL(1).xlsx', label: 'DS12650253 装箱单', type: 'packing' },
  { file: 'ES12651000_IV(1).xlsx', label: 'ES12651000 发票', type: 'invoice' },
  { file: 'ES12651000_PL(1).xlsx', label: 'ES12651000 装箱单', type: 'packing' },
  { file: 'ES12651008_IV(1).xlsx', label: 'ES12651008 发票', type: 'invoice' },
  { file: 'ES12651008_PL(1).xlsx', label: 'ES12651008 装箱单', type: 'packing' },
]

function onFiles(files) {
  for (const f of files) store.uploadFile(f)
}

async function loadSample(filename) {
  if (store.uploadedFiles.find(f => f.filename === filename)) return
  store.uploadedFiles.splice(0, store.uploadedFiles.length)
  try {
    const resp = await fetch(`/api/samples/${filename}`)
    if (!resp.ok) throw new Error('Not found')
    const blob = await resp.blob()
    const file = new File([blob], filename)
    await store.uploadFile(file)
  } catch (e) {
    alert('示例文件加载失败，请通过上传区域选择文件。文件位于项目根目录。')
  }
}

async function runExtraction() {
  await store.runExtraction()
}

async function loadHistory(id) {
  try { await store.loadHistoryEntry(id) } catch (e) { /* ignore */ }
}

async function delHistory(id) {
  if (!confirm('确定删除这条历史记录？')) return
  await store.deleteHistory(id)
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso.slice(0, 16) }
}

onMounted(() => { store.loadTemplates(); store.loadHistory() })
</script>

<style scoped>
.extraction-layout { display: grid; grid-template-columns: 360px 1fr; flex: 1; min-height: 0; }
.sidebar { background: white; border-right: 1px solid var(--c-gray-200); padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.content { padding: 24px 32px; overflow-y: auto; }
.content-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.content-header h1 { font-size: 22px; font-weight: 700; }
.header-actions { display: flex; align-items: center; gap: 12px; }
.result-area { min-height: 200px; }
.result-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.btn.outline.sm { padding: 6px 14px; font-size: 13px; }
.panel { background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius-lg); padding: 16px; }
.panel-title { font-size: 14px; font-weight: 600; color: var(--c-gray-700); margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.file-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.form-g { margin-bottom: 12px; }
.form-g label { display: block; font-size: 12px; font-weight: 600; color: var(--c-gray-500); text-transform: uppercase; margin-bottom: 4px; letter-spacing: .5px; }
.select { width: 100%; padding: 8px 12px; border: 1px solid var(--c-gray-300); border-radius: var(--radius); font-size: 14px; background: white; }
.radio-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--c-gray-200); border-radius: var(--radius); cursor: pointer; transition: all .15s; margin-bottom: 6px; }
.radio-item:has(input:checked) { border-color: var(--c-primary); background: var(--c-primary-light); }
.radio-item input[type="radio"] { margin-top: 3px; accent-color: var(--c-primary); }
.radio-item strong { display: block; font-size: 13px; color: var(--c-gray-800); }
.radio-item small { font-size: 11px; color: var(--c-gray-500); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn.primary { background: var(--c-primary); color: white; }
.btn.primary:hover { background: var(--c-primary-dark); }
.btn.primary:disabled { background: var(--c-gray-300); color: var(--c-gray-500); cursor: not-allowed; }
.btn.full { width: 100%; }
.sample-btn { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: none; border: none; border-radius: var(--radius); cursor: pointer; font-size: 13px; color: var(--c-gray-700); text-align: left; width: 100%; transition: all .15s; }
.sample-btn:hover { background: var(--c-gray-100); }
.sample-badge { width: 28px; height: 20px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: white; }
.sample-badge.invoice { background: var(--c-primary); }
.sample-badge.packing { background: var(--c-success); }
.raw-code {background: #1e1e2e; color: #cdd6f4; padding: 20px; border-radius: var(--radius-lg); font-family: var(--font-mono); font-size: 13px; line-height: 1.7; overflow-x: auto; max-height: 600px; overflow-y: auto; }
.empty-state { text-align: center; padding: 80px 20px; color: var(--c-gray-400); }
.no-history { font-size: 12px; color: var(--c-gray-400); padding: 12px 0; text-align: center; }
.history-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius); cursor: pointer; font-size: 12px; transition: all .1s; position: relative; }
.history-item:hover { background: var(--c-gray-100); }
.history-item.active { background: var(--c-primary-light); }
.hi-header { flex: 1; min-width: 0; }
.hi-file { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hi-method { font-size: 10px; color: var(--c-primary); background: var(--c-primary-light); padding: 1px 6px; border-radius: 8px; }
.hi-meta { display: flex; gap: 8px; font-size: 10px; color: var(--c-gray-400); }
.hi-del { background: none; border: none; color: var(--c-gray-400); cursor: pointer; font-size: 14px; opacity: 0; transition: opacity .1s; }
.history-item:hover .hi-del { opacity: 1; }
.hi-del:hover { color: var(--c-danger); }
@media (max-width: 1024px) { .extraction-layout { grid-template-columns: 1fr; } .sidebar { border-right: none; border-bottom: 1px solid var(--c-gray-200); } }
</style>
