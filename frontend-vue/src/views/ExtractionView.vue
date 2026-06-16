<template>
  <div class="extraction-layout">
    <!-- Sidebar -->
    <aside class="sidebar">
      <section class="panel">
        <h2 class="panel-title">📤 上传报关资料</h2>
        <UploadZone @files-selected="onFiles" />
        <div class="file-list" v-if="store.uploadedFiles.length">
          <FileChip v-for="(f, i) in store.uploadedFiles" :key="f.file_id" :file="f" @remove="store.removeFile(i)" />
        </div>
        <!-- Mode badge -->
        <div v-if="store.uploadedFiles.length" class="mode-badge" :class="store.extractionMode">
          <span v-if="store.extractionMode === 'set'">📋 资料集模式 — 将综合抽取22个报关字段</span>
          <span v-else>📄 单据模式</span>
        </div>
      </section>

      <section class="panel collapsible-panel">
        <h2 class="panel-title clickable" @click="samplePanelOpen = !samplePanelOpen">
          📋 示例资料
          <span class="collapse-arrow">{{ samplePanelOpen ? '▲' : '▼' }}</span>
        </h2>
        <template v-if="samplePanelOpen">
          <div v-if="!store.sampleFolders.length" class="no-history">加载中...</div>
          <div v-for="folder in store.sampleFolders" :key="folder.name" class="sample-folder">
            <div class="folder-header" :class="{ active: store.currentFolder?.name === folder.name }" @click="selectSampleFolder(folder)">
              <span class="folder-icon">{{ expandedFolders.has(folder.name) ? '📂' : '📁' }}</span>
              <span class="folder-name">{{ folder.name }}</span>
              <span class="folder-count">{{ folder.files.length }} 个文件</span>
            </div>
            <div v-if="expandedFolders.has(folder.name)" class="folder-files">
              <div v-for="file in folder.files" :key="file" class="folder-file-item">
                <span class="file-icon">{{ getFileIcon(file) }}</span>
                <span class="file-name">{{ file }}</span>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section class="panel">
        <h2 class="panel-title">⚙️ 抽取配置</h2>
        <div class="form-g">
          <label>抽取模板</label>
          <select v-model="store.templateId" class="select">
            <option v-for="t in store.templates" :key="t.id" :value="t.id">{{ t.name }} ({{ t.field_count || 0 }}个字段)</option>
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
          🔍 {{ extractBtnText }}
        </button>
        <StatusBadge :message="store.statusMsg" :type="store.statusType" />
      </section>

      <section class="panel">
        <h2 class="panel-title">📜 抽取任务</h2>
        <!-- Running tasks -->
        <template v-if="store.tasks.length">
          <div v-for="t in store.tasks" :key="t.id" class="history-item" :class="{ active: store.currentResult?._taskId === t.id, running: t.status === 'running' }" @click="onTaskClick(t)">
            <div class="hi-header">
              <span class="hi-file" :title="t.input?.filename">{{ t.input?.filename || t.id }}</span>
              <span class="hi-method" :class="t.status">{{ t.status === 'running' ? '运行中' : t.status === 'complete' ? '完成' : '失败' }}</span>
            </div>
            <div class="hi-meta">
              <span v-if="t.status === 'running'" class="running-progress">{{ t.progress || '处理中...' }}</span>
              <span v-else>{{ t.method }}</span>
              <span>{{ fmtTime(t.created_at) }}</span>
            </div>
            <span v-if="t.status === 'running'" class="task-spinner"></span>
            <button class="hi-del" @click.stop="delTask(t.id)" title="删除">×</button>
          </div>
        </template>
        <div v-else class="no-history">暂无任务</div>
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

    <!-- Content: Document Viewer + Field Panel -->
    <section class="content">
      <div v-if="!store.isProcessing && (store.currentResult?.fields?.length || store.currentResult?.markdown || store.documentPreview || store.folderFiles.length)" class="viewer-layout">
        <!-- Document Viewer -->
        <div class="doc-viewer">
          <div class="doc-viewer-header">
            <div class="doc-title-area">
              <h2>📄 原始文档</h2>
              <span class="doc-filename">{{ store.documentPreview?.filename || store.currentResult?.filename || '' }}</span>
            </div>
            <!-- Folder file tabs -->
            <div v-if="store.folderFiles.length > 0" class="folder-file-tabs">
              <button
                v-for="(file, fi) in store.folderFiles" :key="fi"
                class="folder-file-tab" :class="{ active: store.activeFolderFileIdx === fi }"
                @click="switchFolderFile(fi)"
              >
                <span class="tab-icon">{{ getFileIcon(file.name) }}</span>
                <span class="tab-name">{{ file.name }}</span>
              </button>
            </div>
            <!-- Sheet tabs for XLSX -->
            <div v-else-if="store.documentPreview?.file_type === 'xlsx' && store.documentPreview.sheets.length > 1" class="sheet-tabs">
              <button
                v-for="(sheet, si) in store.documentPreview.sheets" :key="si"
                class="sheet-tab" :class="{ active: activeSheet === si }"
                @click="activeSheet = si"
              >{{ sheet.name }}</button>
            </div>
          </div>

          <div class="doc-viewer-body" ref="docBodyRef" :key="previewKey">
            <!-- XLSX: Spreadsheet-like view -->
            <template v-if="store.documentPreview?.file_type === 'xlsx'">
              <div class="spreadsheet-wrapper">
                <table class="spreadsheet">
                  <!-- Column header row (A, B, C...) -->
                  <thead>
                    <tr>
                      <th class="row-header corner"></th>
                      <th v-for="c in currentSheet.max_col" :key="c" class="col-header">{{ colLetter(c) }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in currentSheet.max_row" :key="r">
                      <td class="row-header">{{ r }}</td>
                      <td
                        v-for="c in currentSheet.max_col" :key="c"
                        :id="`cell-${activeSheet}-${r}-${c}`"
                        class="sp-cell"
                        :class="{ highlighted: isCellHighlighted(activeSheet, r, c), 'has-value': !!getCellValue(currentSheet, r, c) }"
                      >{{ getCellValue(currentSheet, r, c) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <!-- PDF: PDF.js viewer with highlight support -->
            <template v-else-if="store.documentPreview?.file_type === 'pdf'">
              <PdfViewer ref="pdfViewerRef" :src="store.documentPreview.serve_url" />
            </template>

            <!-- Image: img embed -->
            <template v-else-if="store.documentPreview?.file_type === 'image'">
              <div class="image-viewer">
                <img :src="store.documentPreview.serve_url" :alt="store.documentPreview.filename" />
              </div>
            </template>

            <!-- Text file viewer -->
            <template v-else-if="store.documentPreview?.file_type === 'text'">
              <div class="text-viewer">
                <pre class="text-content">{{ store.documentPreview.content }}</pre>
              </div>
            </template>

            <!-- Fallback: empty -->
            <div v-else class="empty-state">
              <p>暂无文档预览</p>
            </div>
          </div>
        </div>

        <!-- Fixed Field Panel (right side) -->
        <aside class="field-panel">
          <div class="field-panel-header">
            <h3>📋 提取结果</h3>
            <span class="field-count" v-if="parsedFields.length">{{ parsedFields.length }} 个字段</span>
          </div>
          <div class="field-panel-list">
            <!-- Clickable fields view (structured or parsed from markdown) -->
            <template v-if="parsedFields.length">
              <template v-for="(f, i) in parsedFields" :key="f.name + i">
                <!-- Line items: multi-row field -->
                <div v-if="f.type === 'lineItems'" class="field-row field-row-lineitems" :class="{ expanded: lineItemsExpanded }">
                  <div class="field-row-header" @click="lineItemsExpanded = !lineItemsExpanded">
                    <div class="field-row-label">📦 {{ f.name }}</div>
                    <div class="field-row-value">{{ f.value }}</div>
                    <span class="expand-toggle">{{ lineItemsExpanded ? '▲' : '▼' }}</span>
                  </div>
                  <div v-if="lineItemsExpanded" class="lineitems-table-wrapper">
                    <table class="lineitems-table">
                      <thead>
                        <tr><th v-for="h in f.headers" :key="h">{{ h }}</th></tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, ri) in f.rows" :key="ri">
                          <td v-for="h in f.headers" :key="h">{{ row[h] || '' }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <!-- Normal field -->
                <div
                  v-else
                  class="field-row"
                  :class="{ active: store.highlightedField === f.name }"
                  @click="highlightField(f)"
                >
                  <div class="field-row-label">{{ f.label || f.name }}</div>
                  <div class="field-row-value" :class="{ empty: !f.value }">{{ f.value || '未识别' }}</div>
                  <div class="field-row-meta">
                    <span class="conf-dot" :class="f.confidence"></span>
                    <span v-if="f.location" class="field-loc-badge">📍 {{ f.location }}</span>
                  </div>
                </div>
              </template>
            </template>
            <!-- Fallback: raw markdown view -->
            <template v-else-if="store.currentResult?.markdown">
              <div class="markdown-result" v-html="renderMarkdown(store.currentResult.markdown)"></div>
            </template>
            <template v-else>
              <div class="empty-fields">暂无提取结果</div>
            </template>
          </div>
        </aside>
      </div>

      <!-- Empty state -->
      <div v-else class="content-empty">
        <div v-if="store.isProcessing" class="processing-state">
          <div class="processing-spinner"></div>
          <h2>正在抽取中</h2>
          <p class="processing-msg">{{ store.statusMsg || '正在处理...' }}</p>
          <div class="processing-steps">
            <div class="step-item" :class="{ active: store.statusMsg?.includes('Excel') || store.statusMsg?.includes('PDF') || store.statusMsg?.includes('解析') }">
              <span class="step-dot"></span>文档解析
            </div>
            <div class="step-item" :class="{ active: store.statusMsg?.includes('MinerU') }">
              <span class="step-dot"></span>MinerU 转换
            </div>
            <div class="step-item" :class="{ active: store.statusMsg?.includes('提取') || store.statusMsg?.includes('模板') }">
              <span class="step-dot"></span>智能提取
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon">📊</div>
          <h2>报关资料抽取</h2>
          <p>上传单据或整套报关资料，系统将自动识别模式并提取关键字段</p>
          <p class="empty-sub">支持拖放多个文件或从示例资料中选择</p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { marked } from 'marked'
import { useExtractionStore } from '../stores/extraction.js'
import UploadZone from '../components/UploadZone.vue'
import FileChip from '../components/FileChip.vue'
import StatusBadge from '../components/StatusBadge.vue'
import PdfViewer from '../components/PdfViewer.vue'

function renderMarkdown(md) {
  if (!md) return ''
  return marked.parse(md)
}

// ─── Parse markdown tables into structured fields ─────────────────────────────
function parseMarkdownFields(markdown) {
  if (!markdown) return []
  const fields = []
  const lines = markdown.split('\n')
  let inTable = false
  let headers = []
  let lastHeading = ''
  let isLineItemTable = false
  let lineItemHeaders = []
  let lineItemRows = []
  // Column indices for dynamic header detection
  let nameCol = 0
  let valueCol = 1
  let confCol = 2

  for (const line of lines) {
    const trimmed = line.trim()
    // Track headings to detect 商品明细 section
    if (trimmed.startsWith('#')) {
      lastHeading = trimmed.replace(/^#+\s*/, '')
      continue
    }
    // Detect table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim())
      // Skip separator rows (---)
      if (cells.every(c => /^[-:]+$/.test(c))) {
        inTable = true
        // Detect if this is a line-items table
        const hasProductCol = headers.some(h => h === '产品编号' || h === '料号' || h === 'P/N')
        const hasPriceCol = headers.some(h => h === '单价' || h === '金额')
        const isDetailHeading = /商品明细|产品明细|细项/.test(lastHeading)
        if ((hasProductCol && hasPriceCol) || isDetailHeading) {
          isLineItemTable = true
          lineItemHeaders = headers
          lineItemRows = []
        } else {
          isLineItemTable = false
          // Detect column layout from headers
          if (headers.length > 0) {
            const fieldIdx = headers.findIndex(h => h === '字段' || h === '字段名' || h === '字段名称')
            const valueIdx = headers.findIndex(h => h === '值' || h === '字段值' || h === '提取值')
            const confIdx = headers.findIndex(h => h === '置信度' || h === '可信度')
            if (fieldIdx >= 0 && valueIdx >= 0) {
              nameCol = fieldIdx
              valueCol = valueIdx
              confCol = confIdx >= 0 ? confIdx : -1
            } else {
              nameCol = 0
              valueCol = 1
              confCol = 2
            }
          }
        }
        continue
      }
      // If we have no headers yet, this is the header row
      if (!inTable) {
        headers = cells
        continue
      }
      // Line items table: collect rows
      if (isLineItemTable) {
        const row = {}
        const cleanCell = c => c.replace(/\*\*/g, '').replace(/`/g, '').trim()
        lineItemHeaders.forEach((h, idx) => { row[h] = cleanCell(cells[idx] || '') })
        // Skip aggregate/total rows
        const firstVal = cleanCell(cells[0] || '')
        if (!firstVal.startsWith('合计') && firstVal !== '-' && !firstVal.startsWith('**合计')) {
          lineItemRows.push(row)
        }
        continue
      }
      // Normal field table: parse into a field
      if (cells.length > Math.max(nameCol, valueCol)) {
        const name = cells[nameCol].replace(/\*\*/g, '').replace(/`/g, '').trim()
        const value = cells[valueCol].replace(/\*\*/g, '').replace(/`/g, '').trim()
        const confidence = (confCol >= 0 && cells[confCol]) ? cells[confCol].replace(/\*\*/g, '').replace(/`/g, '').trim() : ''
        // Skip aggregate/total rows and null-only rows
        if (name && value && value !== 'null' && !name.startsWith('合计') && name !== '-') {
          fields.push({ name, value, confidence: mapConfidence(confidence) })
        }
      }
    } else {
      // Leaving a table
      if (inTable) {
        // If we just finished a line-items table, push it as a special field
        if (isLineItemTable && lineItemRows.length > 0) {
          fields.push({
            name: '商品明细',
            type: 'lineItems',
            headers: lineItemHeaders,
            rows: lineItemRows,
            value: `${lineItemRows.length} 项明细`,
            confidence: 'high',
          })
        }
        inTable = false
        headers = []
        isLineItemTable = false
        lineItemHeaders = []
        lineItemRows = []
        nameCol = 0
        valueCol = 1
        confCol = 2
      }
    }
  }
  // Handle case where markdown ends inside a line-items table
  if (isLineItemTable && lineItemRows.length > 0) {
    fields.push({
      name: '商品明细',
      type: 'lineItems',
      headers: lineItemHeaders,
      rows: lineItemRows,
      value: `${lineItemRows.length} 项明细`,
      confidence: 'high',
    })
  }
  return fields
}

function mapConfidence(str) {
  if (!str) return 'medium'
  const s = str.toLowerCase()
  if (s === '高' || s === 'high') return 'high'
  if (s === '低' || s === 'low') return 'low'
  return 'medium'
}

const store = useExtractionStore()
const docBodyRef = ref(null)
const activeSheet = ref(0)
const pdfViewerRef = ref(null)
const lineItemsExpanded = ref(true)
const samplePanelOpen = ref(true)

// Extraction button text (adapts to mode)
const extractBtnText = computed(() => {
  if (store.extractionMode === 'set') {
    const count = store.uploadedFiles.length
    return `开始抽取 (资料集 ${count} 个文件)`
  }
  if (store.extractionMode === 'single') {
    return '开始抽取 (1个文件)'
  }
  return '请上传文件或选择示例资料'
})

// Parsed fields from markdown (computed)
const parsedFields = computed(() => {
  if (store.currentResult?.fields?.length) return store.currentResult.fields
  if (store.currentResult?.markdown) return parseMarkdownFields(store.currentResult.markdown)
  return []
})

const previewKey = computed(() => [
  store.currentResult?._taskId || store.currentResult?._historyId || '',
  store.documentPreview?.serve_url || store.documentPreview?.filename || '',
  store.activeFolderFileIdx,
].join('|'))

const methods = [
  // { value: 'agent', label: 'Agent 模式', desc: 'AI Agent 智能提取（适合复杂文档）' },
  { value: 'standard', label: '常规模式', desc: 'Qwen 快速抽取（更快）' },
]

// ─── Folder tree state ─────────────────────────────────────────────────

const expandedFolders = ref(new Set())

function selectSampleFolder(folder) {
  // Toggle expand/collapse
  if (expandedFolders.value.has(folder.name)) {
    expandedFolders.value.delete(folder.name)
  } else {
    expandedFolders.value.add(folder.name)
  }
  // Select this folder for extraction (also populates uploadedFiles for unified flow)
  store.selectFolder(folder)
}

function getFileIcon(filename) {
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return '📊'
  if (filename.endsWith('.txt')) return '📄'
  if (filename.endsWith('.pdf')) return '📄'
  return '📄'
}

async function switchFolderFile(idx) {
  await store.loadFolderFilePreview(idx)
}

// ─── Spreadsheet helpers ─────────────────────────────────────────────────────

const currentSheet = computed(() => {
  if (!store.documentPreview?.sheets?.length) return { max_row: 0, max_col: 0, cells: [] }
  return store.documentPreview.sheets[activeSheet.value] || store.documentPreview.sheets[0]
})

function colLetter(col) {
  let s = ''
  while (col > 0) {
    col--
    s = String.fromCharCode(65 + (col % 26)) + s
    col = Math.floor(col / 26)
  }
  return s
}

function getCellValue(sheet, row, col) {
  const cell = sheet.cells.find(c => c.row === row && c.col === col)
  return cell ? cell.value : ''
}

// ─── Highlight logic ─────────────────────────────────────────────────────────

const highlightedCells = ref(new Set())

function isCellHighlighted(sheetIdx, row, col) {
  return highlightedCells.value.has(`${sheetIdx}-${row}-${col}`)
}

function highlightField(field) {
  store.setHighlightedField(field.name)
  highlightedCells.value = new Set()

  const searchValue = (field.value || '').trim()
  if (!searchValue) return

  // PDF type: use PdfViewer highlight
  if (store.documentPreview?.file_type === 'pdf') {
    if (pdfViewerRef.value) {
      pdfViewerRef.value.highlight(searchValue)
    }
    return
  }

  // XLSX type: cell-level highlighting
  if (store.documentPreview?.file_type !== 'xlsx') return
  if (!store.documentPreview?.sheets?.length) return

  let foundCell = null
  for (let si = 0; si < store.documentPreview.sheets.length; si++) {
    const sheet = store.documentPreview.sheets[si]
    for (const cell of sheet.cells) {
      const cellVal = (cell.value || '').trim()
      if (cellVal && (cellVal.includes(searchValue) || searchValue.includes(cellVal))) {
        highlightedCells.value.add(`${si}-${cell.row}-${cell.col}`)
        if (!foundCell) foundCell = { si, row: cell.row, col: cell.col }
      }
    }
  }

  // Word-level fallback
  if (!foundCell && searchValue.length > 2) {
    const words = searchValue.split(/[\s,\n]+/).filter(w => w.length > 2)
    for (const word of words.slice(0, 3)) {
      for (let si = 0; si < store.documentPreview.sheets.length; si++) {
        const sheet = store.documentPreview.sheets[si]
        for (const cell of sheet.cells) {
          if (cell.value && cell.value.includes(word)) {
            highlightedCells.value.add(`${si}-${cell.row}-${cell.col}`)
            if (!foundCell) foundCell = { si, row: cell.row, col: cell.col }
          }
        }
      }
      if (foundCell) break
    }
  }

  // Switch to sheet and scroll
  if (foundCell) {
    activeSheet.value = foundCell.si
    nextTick(() => {
      const el = document.getElementById(`cell-${foundCell.si}-${foundCell.row}-${foundCell.col}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    })
  }
}

// ─── File handling ───────────────────────────────────────────────────────────

function onFiles(files) {
  if (files.length > 1) {
    // Multi-file upload: upload as a set
    store.uploadDocumentSet(files).then(() => {
      // Files are now in currentFolder; also populate uploadedFiles for display
      if (store.currentFolder) {
        store.uploadedFiles = store.currentFolder.files.map(name => ({
          file_id: `set_${store.currentFolder.name}_${name}`,
          filename: name,
          file_path: `${store.currentFolder.path}/${name}`,
          document_type: name.toUpperCase().includes('_IV') ? 'invoice' : name.toUpperCase().includes('_PL') ? 'packing_list' : 'unknown',
          vendor: 'generic',
          size: 0,
          _isSet: true,
        }))
      }
    })
  } else {
    // Single file upload
    for (const f of files) store.uploadFile(f)
  }
}

async function runExtraction() {
  await store.runExtraction()
  // Load document preview after extraction
  if (store.extractionMode !== 'set') {
    if (store.currentResult?.filename) {
      await store.loadDocumentPreview(store.currentResult.filename)
    } else if (store.uploadedFiles.length > 0) {
      await store.loadDocumentPreview(store.uploadedFiles[0].filename)
    }
  }
}

async function loadHistory(id) {
  highlightedCells.value = new Set()
  activeSheet.value = 0
  store.setHighlightedField(null)
  try { await store.loadHistoryEntry(id) } catch (e) { /* ignore */ }
}

async function delHistory(id) {
  if (!confirm('确定删除这条历史记录？')) return
  await store.deleteHistory(id)
}

async function delTask(id) {
  if (!confirm('确定删除这个抽取任务？')) return
  highlightedCells.value = new Set()
  activeSheet.value = 0
  store.setHighlightedField(null)
  await store.deleteTask(id)
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso.slice(0, 16) }
}

onMounted(() => { store.initializeData() })

async function onTaskClick(task) {
  highlightedCells.value = new Set()
  activeSheet.value = 0
  store.setHighlightedField(null)
  if (task.status === 'complete') {
    await store.loadTaskResult(task.id)
  }
}
</script>

<style scoped>
.extraction-layout { display: grid; grid-template-columns: 320px 1fr; flex: 1; min-height: 0; }
.sidebar { background: white; border-right: 1px solid var(--c-gray-200); padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
.content { overflow: hidden; display: flex; flex-direction: column; }

/* ─── Viewer Layout ───────────────────────────── */
.viewer-layout { display: grid; grid-template-columns: 1fr 320px; flex: 1; min-height: 0; overflow: hidden; }

/* ─── Document Viewer ─────────────────────────── */
.doc-viewer { display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: #f8f9fa; }
.doc-viewer-header { display: flex; flex-direction: column; padding: 10px 16px; border-bottom: 1px solid var(--c-gray-200); background: white; flex-shrink: 0; gap: 8px; }
.doc-title-area { display: flex; align-items: center; gap: 10px; }
.doc-title-area h2 { font-size: 15px; font-weight: 700; margin: 0; }
.doc-filename { font-size: 11px; color: var(--c-gray-400); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }

/* Sheet tabs (Excel-like) */
.sheet-tabs { display: flex; gap: 2px; }
.sheet-tab { padding: 4px 14px; font-size: 11px; border: 1px solid var(--c-gray-200); border-bottom: none; border-radius: 4px 4px 0 0; background: var(--c-gray-50); color: var(--c-gray-600); cursor: pointer; transition: all .1s; }
.sheet-tab.active { background: white; color: var(--c-primary); font-weight: 600; border-color: var(--c-gray-300); }
.sheet-tab:hover:not(.active) { background: var(--c-gray-100); }

/* Folder file tabs */
.folder-file-tabs { display: flex; gap: 2px; flex-wrap: wrap; }
.folder-file-tab { display: flex; align-items: center; gap: 4px; padding: 5px 12px; font-size: 11px; border: 1px solid var(--c-gray-200); border-bottom: none; border-radius: 6px 6px 0 0; background: var(--c-gray-50); color: var(--c-gray-600); cursor: pointer; transition: all .15s; white-space: nowrap; }
.folder-file-tab.active { background: white; color: var(--c-primary); font-weight: 600; border-color: var(--c-primary); border-bottom: 2px solid var(--c-primary); }
.folder-file-tab:hover:not(.active) { background: var(--c-gray-100); color: var(--c-gray-800); }
.folder-file-tab .tab-icon { font-size: 12px; }
.folder-file-tab .tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

.doc-viewer-body { flex: 1; overflow: auto; }

/* ─── Spreadsheet (XLSX) ──────────────────────── */
.spreadsheet-wrapper { padding: 0; min-width: fit-content; }
.spreadsheet { border-collapse: collapse; font-size: 12px; font-family: -apple-system, 'Segoe UI', sans-serif; background: white; }
.spreadsheet thead { position: sticky; top: 0; z-index: 2; }
.col-header { background: #f0f0f0; border: 1px solid #d4d4d4; padding: 3px 6px; text-align: center; font-weight: 600; font-size: 10px; color: #333; min-width: 64px; position: sticky; top: 0; }
.row-header { background: #f0f0f0; border: 1px solid #d4d4d4; padding: 2px 8px; text-align: center; font-weight: 500; font-size: 10px; color: #555; min-width: 36px; position: sticky; left: 0; z-index: 1; }
.corner { background: #e8e8e8; position: sticky; left: 0; top: 0; z-index: 3; }
.sp-cell { border: 1px solid #e2e2e2; padding: 3px 6px; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; min-height: 22px; color: #222; transition: background .15s; }
.sp-cell.has-value { background: white; }
.sp-cell:not(.has-value) { background: #fafafa; }
.sp-cell.highlighted { background: #fff3cd !important; outline: 2px solid #f59e0b; z-index: 1; position: relative; }

/* ─── PDF Viewer ──────────────────────────────── */
.pdf-viewer { width: 100%; height: 100%; border: none; }

/* ─── Folder Preview ─────────────────────────────── */
.folder-preview { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 40px; text-align: center; color: var(--c-gray-600); }
.folder-preview-icon { font-size: 56px; margin-bottom: 12px; }
.folder-preview h3 { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: var(--c-gray-700); }
.folder-preview p { font-size: 13px; color: var(--c-gray-500); margin: 4px 0; }
.folder-preview-name { font-size: 14px; font-weight: 600; color: var(--c-primary); margin-top: 12px; background: var(--c-primary-light); padding: 6px 16px; border-radius: 20px; }

/* ─── Text Viewer ────────────────────────────────── */
.text-viewer { padding: 16px 20px; height: 100%; overflow: auto; background: #fafbfc; }
.text-content { font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; color: var(--c-gray-800); margin: 0; padding: 12px 16px; background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius); }

/* ─── Image Viewer ────────────────────────────── */
.image-viewer { display: flex; align-items: center; justify-content: center; padding: 20px; height: 100%; overflow: auto; background: #f1f1f1; }
.image-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid var(--c-gray-200); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.1); }

/* ─── Field Panel ─────────────────────────────── */
.field-panel { display: flex; flex-direction: column; border-left: 1px solid var(--c-gray-200); background: white; min-height: 0; overflow: hidden; }
.field-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--c-gray-200); flex-shrink: 0; }
.field-panel-header h3 { font-size: 14px; font-weight: 700; margin: 0; }
.field-count { font-size: 11px; color: var(--c-gray-400); background: var(--c-gray-100); padding: 2px 8px; border-radius: 10px; }
.field-panel-list { flex: 1; overflow-y: auto; padding: 6px; }

.field-row { padding: 10px 12px; border-radius: var(--radius); cursor: pointer; transition: all .12s; border: 1px solid transparent; margin-bottom: 2px; }
.field-row:hover { background: var(--c-gray-50); border-color: var(--c-gray-200); }
.field-row.active { background: #fffbeb; border-color: #f59e0b; }
.field-row-label { font-size: 11px; font-weight: 600; color: var(--c-gray-500); text-transform: uppercase; letter-spacing: .3px; margin-bottom: 2px; }
.field-row-value { font-size: 13px; font-weight: 600; color: var(--c-gray-900); word-break: break-all; line-height: 1.4; }
.field-row-value.empty { color: var(--c-gray-400); font-style: italic; font-weight: 400; }
.field-row-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
.conf-dot { width: 7px; height: 7px; border-radius: 50%; }
.conf-dot.high { background: var(--c-success); }
.conf-dot.medium { background: var(--c-warning); }
.conf-dot.low { background: var(--c-danger); }
.field-loc-badge { font-size: 10px; color: var(--c-gray-400); }

.line-items-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--c-gray-200); }
.line-items-section h4 { font-size: 12px; font-weight: 600; color: var(--c-gray-500); margin-bottom: 8px; }

/* ─── Line Items Field Row ──────────────────────── */
.field-row-lineitems { padding: 0; cursor: default; border: 1px solid var(--c-gray-200); border-radius: var(--radius-lg); overflow: hidden; margin-bottom: 6px; }
.field-row-lineitems:hover { background: transparent; border-color: var(--c-gray-300); }
.field-row-lineitems .field-row-header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; background: var(--c-gray-50); border-bottom: 1px solid var(--c-gray-200); transition: background .1s; }
.field-row-lineitems .field-row-header:hover { background: var(--c-gray-100); }
.field-row-lineitems .field-row-label { font-size: 12px; font-weight: 700; color: var(--c-gray-700); margin-bottom: 0; flex-shrink: 0; text-transform: none; }
.field-row-lineitems .field-row-value { font-size: 11px; font-weight: 500; color: var(--c-primary); flex: 1; }
.expand-toggle { font-size: 10px; color: var(--c-gray-400); flex-shrink: 0; }
.lineitems-table-wrapper { overflow-x: auto; max-height: 400px; overflow-y: auto; }
.lineitems-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.lineitems-table th { background: var(--c-gray-50); padding: 6px 8px; text-align: left; font-weight: 600; color: var(--c-gray-600); border-bottom: 1px solid var(--c-gray-200); white-space: nowrap; position: sticky; top: 0; z-index: 1; }
.lineitems-table td { padding: 5px 8px; border-bottom: 1px solid var(--c-gray-100); color: var(--c-gray-800); white-space: nowrap; }
.lineitems-table tr:hover td { background: #fffbeb; }
.field-row-lineitems.expanded { border-color: var(--c-primary); }

/* ─── Markdown Result ───────────────────────── */
.markdown-result { padding: 12px 14px; font-size: 13px; line-height: 1.6; color: var(--c-gray-800); }
.markdown-result :deep(h1) { font-size: 16px; font-weight: 700; margin: 12px 0 8px; }
.markdown-result :deep(h2) { font-size: 15px; font-weight: 700; margin: 12px 0 6px; }
.markdown-result :deep(h3) { font-size: 14px; font-weight: 700; margin: 10px 0 6px; }
.markdown-result :deep(h4) { font-size: 13px; font-weight: 600; margin: 8px 0 4px; color: var(--c-gray-600); }
.markdown-result :deep(p) { margin: 4px 0; }
.markdown-result :deep(table) { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
.markdown-result :deep(th) { background: var(--c-gray-100); padding: 6px 8px; border: 1px solid var(--c-gray-200); text-align: left; font-weight: 600; white-space: nowrap; }
.markdown-result :deep(td) { padding: 5px 8px; border: 1px solid var(--c-gray-200); word-break: break-all; }
.markdown-result :deep(tr:hover td) { background: #fffbeb; }
.markdown-result :deep(code) { background: var(--c-gray-100); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.markdown-result :deep(strong) { font-weight: 700; }
.markdown-result :deep(hr) { border: none; border-top: 1px solid var(--c-gray-200); margin: 12px 0; }
.markdown-result :deep(ul), .markdown-result :deep(ol) { padding-left: 18px; margin: 4px 0; }
.markdown-result :deep(li) { margin: 2px 0; }
.empty-fields { text-align: center; padding: 40px 20px; color: var(--c-gray-400); font-size: 13px; }

/* ─── Empty State ─────────────────────────────── */
.content-empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-state { text-align: center; padding: 80px 20px; color: var(--c-gray-400); }
.empty-icon { font-size: 56px; margin-bottom: 12px; }
.empty-state h2 { font-size: 20px; font-weight: 700; color: var(--c-gray-600); margin-bottom: 8px; }
.empty-state p { font-size: 14px; }
.empty-sub { font-size: 12px; color: var(--c-gray-300); margin-top: 4px; }

/* ─── Processing State ────────────────────────── */
.processing-state { text-align: center; padding: 60px 20px; }
.processing-state h2 { font-size: 20px; font-weight: 700; color: var(--c-gray-700); margin: 16px 0 8px; }
.processing-msg { font-size: 14px; color: var(--c-primary); font-weight: 500; min-height: 20px; }
.processing-spinner { width: 48px; height: 48px; border: 4px solid var(--c-gray-200); border-top-color: var(--c-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
@keyframes spin { to { transform: rotate(360deg); } }
.processing-steps { display: flex; gap: 24px; justify-content: center; margin-top: 28px; }
.step-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--c-gray-400); transition: all .2s; }
.step-item.active { color: var(--c-primary); font-weight: 600; }
.step-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c-gray-300); transition: all .2s; }
.step-item.active .step-dot { background: var(--c-primary); box-shadow: 0 0 6px rgba(99, 102, 241, .4); }

/* ─── Sidebar Components ──────────────────────── */
.panel { background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius-lg); padding: 14px; }
.panel-title { font-size: 13px; font-weight: 600; color: var(--c-gray-700); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.file-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.form-g { margin-bottom: 10px; }
.form-g label { display: block; font-size: 11px; font-weight: 600; color: var(--c-gray-500); text-transform: uppercase; margin-bottom: 4px; letter-spacing: .5px; }
.select { width: 100%; padding: 7px 10px; border: 1px solid var(--c-gray-300); border-radius: var(--radius); font-size: 13px; background: white; }
.radio-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid var(--c-gray-200); border-radius: var(--radius); cursor: pointer; transition: all .15s; margin-bottom: 5px; }
.radio-item:has(input:checked) { border-color: var(--c-primary); background: var(--c-primary-light); }
.radio-item input[type="radio"] { margin-top: 3px; accent-color: var(--c-primary); }
.radio-item strong { display: block; font-size: 12px; color: var(--c-gray-800); }
.radio-item small { font-size: 10px; color: var(--c-gray-500); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 20px; border-radius: var(--radius); font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.btn.primary { background: var(--c-primary); color: white; }
.btn.primary:hover { background: var(--c-primary-dark); }
.btn.primary:disabled { background: var(--c-gray-300); color: var(--c-gray-500); cursor: not-allowed; }
.btn.full { width: 100%; }
.sample-btn { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: none; border: none; border-radius: var(--radius); cursor: pointer; font-size: 12px; color: var(--c-gray-700); text-align: left; width: 100%; transition: all .15s; }
.sample-btn:hover { background: var(--c-gray-100); }
.sample-badge { width: 24px; height: 18px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: white; }
.sample-badge.invoice { background: var(--c-primary); }
.sample-badge.packing { background: var(--c-success); }
.no-history { font-size: 12px; color: var(--c-gray-400); padding: 12px 0; text-align: center; }
.history-item { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: var(--radius); cursor: pointer; font-size: 12px; transition: all .1s; position: relative; }
.history-item:hover { background: var(--c-gray-100); }
.history-item.active { background: var(--c-primary-light); }
.hi-header { flex: 1; min-width: 0; }
.hi-file { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.hi-method { font-size: 9px; color: var(--c-primary); background: var(--c-primary-light); padding: 1px 5px; border-radius: 6px; }
.hi-meta { display: flex; gap: 6px; font-size: 10px; color: var(--c-gray-400); }
.hi-del { background: none; border: none; color: var(--c-gray-400); cursor: pointer; font-size: 14px; opacity: 0; transition: opacity .1s; }
.history-item:hover .hi-del { opacity: 1; }
.hi-del:hover { color: var(--c-danger); }

/* ─── Task status ───────────────────────────── */
.history-item.running { border-left: 3px solid var(--c-primary); }
.hi-method.running { background: #dbeafe; color: #1d4ed8; }
.hi-method.complete { background: #dcfce7; color: #15803d; }
.hi-method.failed { background: #fef2f2; color: #b91c1c; }
.running-progress { color: var(--c-primary); font-style: italic; }
.task-spinner { width: 12px; height: 12px; border: 2px solid var(--c-gray-200); border-top-color: var(--c-primary); border-radius: 50%; animation: spin .8s linear infinite; flex-shrink: 0; }

/* ─── Folder Tree ───────────────────────────── */
.sample-folder { margin-bottom: 4px; }
.folder-header { display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: var(--radius); cursor: pointer; transition: all .12s; }
.folder-header:hover { background: var(--c-gray-100); }
.folder-header.active { background: var(--c-primary-light); border: 1px solid var(--c-primary); }
.folder-icon { font-size: 14px; }
.folder-name { font-size: 12px; font-weight: 600; color: var(--c-gray-800); flex: 1; }
.folder-count { font-size: 10px; color: var(--c-gray-400); background: var(--c-gray-100); padding: 1px 6px; border-radius: 8px; }
.folder-files { padding-left: 20px; margin-top: 2px; }
.folder-file-item { display: flex; align-items: center; gap: 5px; padding: 3px 6px; font-size: 11px; color: var(--c-gray-600); }
.file-icon { font-size: 12px; }
.file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder-action { margin-top: 8px; }

/* Mode Badge */
.mode-badge { margin-top: 10px; padding: 8px 12px; border-radius: var(--radius); font-size: 11px; font-weight: 600; text-align: center; }
.mode-badge.set { background: #ede9fe; color: #6d28d9; border: 1px solid #c4b5fd; }
.mode-badge.single { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }

/* Collapsible Panel */
.collapsible-panel .panel-title.clickable { cursor: pointer; user-select: none; }
.collapse-arrow { margin-left: auto; font-size: 10px; color: var(--c-gray-400); }

@media (max-width: 1200px) {
  .extraction-layout { grid-template-columns: 280px 1fr; }
  .viewer-layout { grid-template-columns: 1fr 280px; }
}
@media (max-width: 900px) {
  .extraction-layout { grid-template-columns: 1fr; }
  .viewer-layout { grid-template-columns: 1fr; }
  .sidebar { border-right: none; border-bottom: 1px solid var(--c-gray-200); }
}
</style>
