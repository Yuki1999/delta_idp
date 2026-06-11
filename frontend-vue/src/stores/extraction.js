import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useExtractionStore = defineStore('extraction', () => {
  const uploadedFiles = ref([])
  const currentResult = ref(null)
  const documentPreview = ref(null) // { filename, sheets: [{ name, max_row, max_col, cells }] }
  const highlightedField = ref(null) // currently highlighted field name
  const templates = ref([])
  const templateTree = ref([])
  const history = ref([])
  const method = ref('standard')
  const templateId = ref('customs_declaration')
  const isProcessing = ref(false)
  const statusMsg = ref('')
  const statusType = ref('') // 'loading' | 'success' | 'error'

  // Tasks (background extraction jobs)
  const tasks = ref([]) // [{ id, status, progress, method, input, created_at, completed_at }]
  let taskPollTimer = null

  // Folder-based extraction state
  const sampleFolders = ref([]) // [{ name, path, files }]
  const currentFolder = ref(null) // { name, path, files }
  const folderFiles = ref([]) // [{ name, folderName }] - files in current folder extraction
  const activeFolderFileIdx = ref(0) // currently active tab index

  // Extraction mode: auto-detected from uploaded files
  const extractionMode = computed(() => {
    if (currentFolder.value) return 'set'
    if (uploadedFiles.value.length >= 2) return 'set'
    if (uploadedFiles.value.length === 1) {
      // Check if single file is a .txt (likely part of a set, but alone = single)
      return 'single'
    }
    return 'none'
  })

  const canExtract = computed(() => {
    return (uploadedFiles.value.length > 0 || currentFolder.value) && !isProcessing.value
  })

  // ─── Upload ────────────────────────────────────────────────────────

  async function uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    const resp = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!resp.ok) throw new Error('Upload failed')
    const data = await resp.json()
    uploadedFiles.value.push(data)
    // Clear sample folder selection when user uploads their own files
    currentFolder.value = null
    return data
  }

  function removeFile(index) {
    uploadedFiles.value.splice(index, 1)
    if (uploadedFiles.value.length === 0) {
      currentFolder.value = null
    }
  }

  function clearFiles() {
    uploadedFiles.value = []
    currentFolder.value = null
    currentResult.value = null
    documentPreview.value = null
    folderFiles.value = []
    activeFolderFileIdx.value = 0
  }

  // ─── Upload document set (multi-file) ──────────────────────────────

  async function uploadDocumentSet(rawFiles) {
    const formData = new FormData()
    for (const file of rawFiles) {
      formData.append('files', file)
    }
    const resp = await fetch('/api/upload-set', { method: 'POST', body: formData })
    if (!resp.ok) throw new Error('Upload set failed')
    const data = await resp.json()
    // Set currentFolder to the uploaded set
    currentFolder.value = {
      name: data.set_id,
      path: data.folder_path,
      files: data.files,
    }
    return data
  }

  // ─── Unified extraction trigger ────────────────────────────────────

  async function runExtraction({ onDelta, onDone, onError } = {}) {
    if (!canExtract.value) return

    if (method.value === 'standard') {
      await _runStandardExtraction({ onDone, onError })
    } else if (extractionMode.value === 'set') {
      await _runFolderExtraction({ onDelta, onDone, onError })
    } else {
      await _runSingleExtraction({ onDelta, onDone, onError })
    }
  }

  // ─── Standard mode: submit to backend task system ────────────────────

  async function _runStandardExtraction({ onDone, onError } = {}) {
    isProcessing.value = true
    statusMsg.value = '已提交后台抽取任务...'
    statusType.value = 'loading'

    try {
      let input = {}
      if (extractionMode.value === 'set' && currentFolder.value) {
        input = {
          folder_path: currentFolder.value.path,
          filename: `[资料集] ${currentFolder.value.name}`,
        }
      } else if (uploadedFiles.value.length > 0) {
        const file = uploadedFiles.value[0]
        input = {
          file_path: file.file_path,
          filename: file.filename,
        }
      }

      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'standard',
          template_id: templateId.value,
          input,
        }),
      })
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`)

      statusMsg.value = '✓ 任务已提交，后台抽取中...'
      statusType.value = 'success'

      await loadTasks()
      startTaskPolling()
      onDone?.('')
    } catch (e) {
      statusMsg.value = `提交失败: ${e.message}`
      statusType.value = 'error'
      onError?.(e)
    } finally {
      isProcessing.value = false
    }
  }

  async function _runSingleExtraction({ onDelta, onDone, onError } = {}) {
    isProcessing.value = true
    statusMsg.value = '正在启动 Agent 抽取...'
    statusType.value = 'loading'
    currentResult.value = null
    documentPreview.value = null

    try {
      const file = uploadedFiles.value[0]

      // Create task on backend FIRST to guarantee task record exists
      const taskResp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent',
          template_id: templateId.value,
          input: { file_path: file.file_path, filename: file.filename },
        }),
      })
      if (!taskResp.ok) throw new Error(`Task creation failed: ${taskResp.status}`)
      const taskData = await taskResp.json()
      const taskId = taskData.task?.id || ''

      // Release UI immediately after task is created - don't wait for agent-pi
      isProcessing.value = false
      statusMsg.value = 'Agent 抽取进行中...'
      statusType.value = 'loading'

      // Show task in sidebar right away
      await loadTasks()
      startTaskPolling()

      // Fire off agent-pi request in the background (non-blocking)
      const body = {
        file_path: file.file_path,
        method: method.value,
        template_id: templateId.value,
        task_id: taskId,
      }
      fetch('/api/agent/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(resp => {
        if (resp.ok) {
          _consumeAgentSSE(resp, { filename: file.filename, onDelta, onDone, onError })
        }
      }).catch(e => {
        console.warn('Agent extract request failed:', e.message)
      })
    } catch (e) {
      statusMsg.value = `抽取失败: ${e.message}`
      statusType.value = 'error'
      isProcessing.value = false
      onError?.(e)
    }
  }

  // Background SSE stream consumer - runs without blocking the UI
  async function _consumeAgentSSE(resp, { filename, onDelta, onDone, onError } = {}) {
    try {
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
        filename: filename || '',
        reviewId,
      }
      statusMsg.value = '✓ 抽取完成'
      statusType.value = 'success'
      onDone?.(fullReply)

      await loadTasks()
      await loadHistory()
    } catch (e) {
      // Stream interrupted (user navigated away, network error, etc.)
      // Task continues on server side - user can check via task polling
      console.warn('Agent SSE stream interrupted:', e.message)
    }
  }

  async function _runFolderExtraction({ onDelta, onDone, onError } = {}) {
    // For user-uploaded sets, we need to upload them first
    if (!currentFolder.value && uploadedFiles.value.length >= 2) {
      statusMsg.value = '请使用多文件上传功能'
      statusType.value = 'error'
      return
    }

    if (!currentFolder.value) return

    isProcessing.value = true
    statusMsg.value = '正在启动资料集 Agent 抽取...'
    statusType.value = 'loading'
    currentResult.value = null
    documentPreview.value = null

    const folderName = currentFolder.value.name
    const folderPath = currentFolder.value.path
    const folderFilesList = currentFolder.value.files

    try {
      // Create task on backend FIRST to guarantee task record exists
      const taskResp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'agent',
          template_id: templateId.value,
          input: { folder_path: folderPath, filename: `[资料集] ${folderName}` },
        }),
      })
      if (!taskResp.ok) throw new Error(`Task creation failed: ${taskResp.status}`)
      const taskData = await taskResp.json()
      const taskId = taskData.task?.id || ''

      // Release UI immediately after task is created - don't wait for agent-pi
      isProcessing.value = false
      statusMsg.value = 'Agent 资料集抽取进行中...'
      statusType.value = 'loading'

      // Show task in sidebar right away
      await loadTasks()
      startTaskPolling()

      // Fire off agent-pi request in the background (non-blocking)
      const body = {
        folder_path: folderPath,
        method: method.value,
        template_id: templateId.value,
        task_id: taskId,
      }
      fetch('/api/agent/extract-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(resp => {
        if (resp.ok) {
          _consumeFolderSSE(resp, { folderName, folderFilesList, onDelta, onDone, onError })
        }
      }).catch(e => {
        console.warn('Agent folder extract request failed:', e.message)
      })
    } catch (e) {
      statusMsg.value = `抽取失败: ${e.message}`
      statusType.value = 'error'
      isProcessing.value = false
      onError?.(e)
    }
  }

  // Background SSE stream consumer for folder extraction
  async function _consumeFolderSSE(resp, { folderName, folderFilesList, onDelta, onDone, onError } = {}) {
    try {
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullReply = ''
      let reviewId = null

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
          } catch { /* skip */ }
        }
      }

      currentResult.value = {
        fields: [],
        line_items: [],
        markdown: fullReply,
        method: 'folder_extraction',
        filename: `[资料集] ${folderName}`,
        reviewId,
      }
      // Populate folder file tabs
      folderFiles.value = (folderFilesList || []).map(name => ({ name, folderName }))
      activeFolderFileIdx.value = 0
      if (folderFiles.value.length > 0) {
        await loadFolderFilePreview(0)
      }
      statusMsg.value = '✓ 资料集抽取完成'
      statusType.value = 'success'
      onDone?.(fullReply)

      await loadTasks()
      await loadHistory()
    } catch (e) {
      // Stream interrupted - task continues on server side
      console.warn('Folder SSE stream interrupted:', e.message)
    }
  }

  // ─── Tasks ──────────────────────────────────────────────────────────

  async function loadTasks() {
    try {
      const resp = await fetch('/api/tasks')
      const data = await resp.json()
      tasks.value = data.tasks || []
    } catch (e) { console.warn('Tasks load failed:', e) }
  }

  function startTaskPolling() {
    stopTaskPolling()
    taskPollTimer = setInterval(async () => {
      await loadTasks()
      // Check if any running tasks completed
      const hasRunning = tasks.value.some(t => t.status === 'running')
      if (!hasRunning) {
        stopTaskPolling()
        // Reload history when tasks complete
        await loadHistory()
      }
    }, 3000)
  }

  function stopTaskPolling() {
    if (taskPollTimer) {
      clearInterval(taskPollTimer)
      taskPollTimer = null
    }
  }

  async function loadTaskResult(taskId) {
    try {
      const resp = await fetch(`/api/tasks/${taskId}`)
      if (!resp.ok) throw new Error('Not found')
      const task = await resp.json()
      if (task.result) {
        currentResult.value = {
          fields: task.result.fields || [],
          line_items: task.result.line_items || [],
          markdown: task.result.markdown || '',
          method: task.method || '',
          filename: task.input?.filename || '',
          _fromTask: true,
          _taskId: task.id,
        }
      }
    } catch (e) { console.warn('Task load failed:', e) }
  }

  // ─── Templates & History ───────────────────────────────────────────

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
      filename: data.filename || '',
      _fromHistory: true,
      _historyId: data.id,
    }
    // Load document preview if filename available (skip for folder extractions)
    const isFolderExtraction = data.method === 'folder_extraction' || (data.filename && data.filename.startsWith('['))
    if (data.filename && !isFolderExtraction) {
      folderFiles.value = []
      activeFolderFileIdx.value = 0
      await loadDocumentPreview(data.filename)
    } else if (isFolderExtraction) {
      documentPreview.value = null
      // Extract folder name from "[资料集] DS12650253" format
      const folderName = data.filename?.replace(/^\[资料集\]\s*/, '') || ''
      await loadFolderFiles(folderName)
    } else {
      documentPreview.value = null
      folderFiles.value = []
    }
  }

  async function loadDocumentPreview(filename) {
    try {
      const resp = await fetch(`/api/document/preview?filename=${encodeURIComponent(filename)}`)
      if (!resp.ok) throw new Error('Preview load failed')
      documentPreview.value = await resp.json()
    } catch (e) {
      console.warn('Document preview load failed:', e)
      documentPreview.value = null
    }
  }

  function setHighlightedField(fieldName) {
    highlightedField.value = fieldName
  }

  async function deleteHistory(id) {
    await fetch(`/api/history/${id}`, { method: 'DELETE' })
    await loadHistory()
  }

  // ─── Sample Folders ────────────────────────────────────────────────

  async function loadSampleFolders() {
    try {
      const resp = await fetch('/api/samples')
      const data = await resp.json()
      sampleFolders.value = data.folders || []
    } catch (e) {
      console.warn('Sample folders load failed:', e)
    }
  }

  function selectFolder(folder) {
    currentFolder.value = folder
    // Represent sample folder files as virtual uploaded files for UI consistency
    uploadedFiles.value = folder.files.map(name => ({
      file_id: `sample_${folder.name}_${name}`,
      filename: name,
      file_path: `${folder.path}/${name}`,
      document_type: name.toUpperCase().includes('_IV') ? 'invoice' : name.toUpperCase().includes('_PL') ? 'packing_list' : 'unknown',
      vendor: 'samsung',
      size: 0,
      _isSample: true,
    }))
    currentResult.value = null
    documentPreview.value = null
    folderFiles.value = []
    activeFolderFileIdx.value = 0
  }

  async function loadFolderFiles(folderName) {
    if (!folderName) { folderFiles.value = []; return }
    // Ensure sampleFolders loaded
    if (!sampleFolders.value.length) {
      await loadSampleFolders()
    }
    const folder = sampleFolders.value.find(f => f.name === folderName)
    if (folder && folder.files) {
      folderFiles.value = folder.files.map(name => ({ name, folderName }))
      activeFolderFileIdx.value = 0
      // Load preview for the first file
      if (folderFiles.value.length > 0) {
        await loadFolderFilePreview(0)
      }
    } else {
      // Could be an uploaded set - try using set_id format
      folderFiles.value = []
    }
  }

  async function loadFolderFilePreview(idx) {
    activeFolderFileIdx.value = idx
    const file = folderFiles.value[idx]
    if (!file) { documentPreview.value = null; return }
    const relativePath = `samples/${file.folderName}/${file.name}`
    await loadDocumentPreview(relativePath)
  }

  return {
    uploadedFiles, currentResult, documentPreview, highlightedField,
    templates, templateTree, history, tasks,
    method, templateId, isProcessing,
    statusMsg, statusType, canExtract, extractionMode,
    sampleFolders, currentFolder,
    folderFiles, activeFolderFileIdx,
    uploadFile, removeFile, clearFiles, uploadDocumentSet,
    loadTemplates, runExtraction,
    loadHistory, loadHistoryEntry, loadDocumentPreview, setHighlightedField, deleteHistory,
    loadSampleFolders, selectFolder,
    loadFolderFiles, loadFolderFilePreview,
    loadTasks, startTaskPolling, stopTaskPolling, loadTaskResult,
  }
})
