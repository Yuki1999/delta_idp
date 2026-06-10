import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useExtractionStore = defineStore('extraction', () => {
  const uploadedFiles = ref([])
  const currentResult = ref(null)
  const templates = ref([])
  const templateTree = ref([])
  const history = ref([])
  const docType = ref('auto')
  const method = ref('mineru')
  const templateId = ref('auto')
  const isProcessing = ref(false)
  const statusMsg = ref('')
  const statusType = ref('') // 'loading' | 'success' | 'error'

  const canExtract = computed(() => uploadedFiles.value.length > 0 && !isProcessing.value)

  async function uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    const resp = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!resp.ok) throw new Error('Upload failed')
    const data = await resp.json()
    uploadedFiles.value.push(data)
    if (data.document_type !== 'unknown' && docType.value === 'auto') {
      docType.value = data.document_type
    }
    return data
  }

  function removeFile(index) {
    uploadedFiles.value.splice(index, 1)
  }

  async function loadTemplates() {
    const resp = await fetch('/api/templates')
    const data = await resp.json()
    templates.value = data.templates || []
    try {
      const treeResp = await fetch('/api/templates/tree')
      const treeData = await treeResp.json()
      templateTree.value = treeData.tree || []
    } catch (e) {
      console.warn('Template tree load failed:', e)
    }
  }

  /**
   * Run extraction via pi agent SSE streaming.
   * onDelta is called for each text chunk, onDone when complete.
   */
  async function runExtraction({ onDelta, onDone, onError } = {}) {
    if (!canExtract.value) return
    isProcessing.value = true
    statusMsg.value = '正在抽取中...'
    statusType.value = 'loading'

    try {
      const file = uploadedFiles.value[0]
      const detectedType = file.document_type === 'unknown' ? docType.value : file.document_type
      const body = {
        file_path: file.file_path,
        method: method.value,
        document_type: detectedType === 'auto' ? 'invoice' : detectedType,
        vendor: file.vendor || 'generic',
      }

      const resp = await fetch('/api/agent/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!resp.ok) throw new Error(`Server error: ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullReply = ''

      let reviewId = null
      let extraction = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.delta) {
              fullReply += data.delta
              onDelta?.(data.delta, fullReply)
            }
            if (data.message) {
              statusMsg.value = data.message
            }
            if (data.review_id) {
              reviewId = data.review_id
            }
            if (data.extraction) {
              extraction = data.extraction
            }
          } catch { /* skip */ }
        }
      }

      currentResult.value = {
        fields: extraction?.fields || [],
        line_items: extraction?.line_items || [],
        markdown: fullReply,
        method: method.value,
        reviewId,
      }
      statusMsg.value = '✓ 抽取完成'
      statusType.value = 'success'
      onDone?.(fullReply)

      // Reload history after extraction
      await loadHistory()
    } catch (e) {
      statusMsg.value = `抽取失败: ${e.message}`
      statusType.value = 'error'
      onError?.(e)
    } finally {
      isProcessing.value = false
      setTimeout(() => { if (statusType.value !== 'error') statusMsg.value = '' }, 5000)
    }
  }

  async function loadHistory() {
    try {
      const resp = await fetch('/api/history')
      const data = await resp.json()
      history.value = data.history || []
    } catch (e) { console.warn('History load failed:', e) }
  }

  async function loadHistoryEntry(id) {
    const resp = await fetch(`/api/history/${id}`)
    if (!resp.ok) throw new Error('Not found')
    const data = await resp.json()
    currentResult.value = {
      fields: data.fields || [],
      line_items: data.line_items || [],
      method: data.method || '',
      markdown: data.markdown || '',
      _fromHistory: true,
      _historyId: data.id,
    }
  }

  async function deleteHistory(id) {
    await fetch(`/api/history/${id}`, { method: 'DELETE' })
    await loadHistory()
  }

  return {
    uploadedFiles, currentResult, templates, templateTree, history,
    docType, method, templateId, isProcessing,
    statusMsg, statusType, canExtract,
    uploadFile, removeFile, loadTemplates, runExtraction,
    loadHistory, loadHistoryEntry, deleteHistory,
  }
})
