import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAgentStore = defineStore('agent', () => {
  const uploadedFiles = ref([])
  const activeFile = ref(null)
  const sessions = ref([])
  const activeSessionId = ref(null)
  const chatHistory = ref([])
  const messages = ref([])
  const processingStatus = ref('')
  const isProcessing = ref(false)
  const useQwen = ref(true)

  function addMsg(role, content, isTyping = false) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    messages.value.push({ role, content, time, isTyping })
  }

  async function uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    const resp = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!resp.ok) throw new Error('Upload failed')
    const data = await resp.json()
    uploadedFiles.value.push(data)
    if (!activeFile.value) activeFile.value = data
    return data
  }

  function selectFile(index) {
    activeFile.value = uploadedFiles.value[index] || null
  }

  function removeFile(index) {
    const removed = uploadedFiles.value[index]
    uploadedFiles.value.splice(index, 1)
    if (activeFile.value === removed) {
      activeFile.value = uploadedFiles.value[0] || null
    }
  }

  /**
   * Send a message via SSE streaming and call onDelta for each text chunk.
   * Returns the final reply string.
   */
  async function sendMessageStream(message) {
    if (!message.trim() || isProcessing.value) return
    isProcessing.value = true
    processingStatus.value = '正在思考...'

    // Ensure active session
    if (!activeSessionId.value) await createSession('新会话')

    const body = {
      message,
      history: chatHistory.value.slice(-10),
      session_id: activeSessionId.value || '',
      use_qwen: useQwen.value,
    }
    if (activeFile.value) {
      body.document_context = 'file:' + activeFile.value.file_path
    }

    addMsg('user', message)
    const typingMsg = { role: 'assistant', content: '', time: '', isTyping: true }
    messages.value.push(typingMsg)

    try {
      const resp = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error(`Server error: ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullReply = ''

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
              typingMsg.isTyping = false
              typingMsg.content = fullReply
              typingMsg.time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            } else if (data.tool) {
              processingStatus.value = data.message || `正在调用 ${data.tool}...`
            } else if (data.reply) {
              fullReply = data.reply
            }
          } catch { /* skip */ }
        }
      }

      typingMsg.content = fullReply || typingMsg.content
      typingMsg.isTyping = false
      processingStatus.value = ''

      chatHistory.value.push({ role: 'user', content: message })
      if (fullReply) chatHistory.value.push({ role: 'assistant', content: fullReply })
    } catch (e) {
      typingMsg.content = `错误: ${e.message}`
      typingMsg.isTyping = false
      processingStatus.value = ''
    } finally {
      isProcessing.value = false
    }
  }

  function clearChat() {
    messages.value = []
    chatHistory.value = []
    activeSessionId.value = null
  }

  async function loadSessions() {
    try {
      const resp = await fetch('/api/agent/sessions')
      const data = await resp.json()
      sessions.value = data.sessions || []
    } catch (e) { console.warn('Sessions load failed:', e) }
  }

  async function createSession(name = '新会话') {
    const resp = await fetch('/api/agent/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const session = await resp.json()
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    chatHistory.value = []
    return session
  }

  async function loadSession(sessionId) {
    const resp = await fetch(`/api/agent/sessions/${sessionId}`)
    if (!resp.ok) throw new Error('Not found')
    const session = await resp.json()
    activeSessionId.value = session.id
    // Convert pi content format to plain strings for local display
    chatHistory.value = (session.messages || []).map(m => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.map(c => c.text || '').join('')
        : (m.content || ''),
    }))
  }

  async function persistSession() {
    if (!activeSessionId.value) return
    // Convert to pi content format before saving
    const piMessages = chatHistory.value.map(m => ({
      role: m.role,
      content: [{ type: 'text', text: m.content || '' }],
    }))
    await fetch(`/api/agent/sessions/${activeSessionId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: piMessages }),
    })
    await loadSessions()
  }

  async function renameSession(sessionId, name) {
    await fetch(`/api/agent/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    await loadSessions()
  }

  async function deleteSession(sessionId) {
    await fetch(`/api/agent/sessions/${sessionId}`, { method: 'DELETE' })
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
      chatHistory.value = []
    }
    await loadSessions()
  }

  return {
    uploadedFiles, activeFile, sessions, activeSessionId, chatHistory,
    messages, processingStatus, isProcessing, useQwen,
    uploadFile, selectFile, removeFile, addMsg,
    sendMessageStream, clearChat,
    loadSessions, createSession, loadSession, renameSession, deleteSession,
  }
})
