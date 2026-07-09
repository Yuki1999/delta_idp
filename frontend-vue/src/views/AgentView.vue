<template>
  <div class="agent-layout">
    <!-- Left Column: Sessions + Upload + Settings -->
    <aside class="sessions-col">
      <h3 class="sec-title"><MessageSquare :size="13" :stroke-width="2" style="vertical-align:-2px" /> 会话</h3>
      <div class="session-list">
        <div v-for="s in agent.sessions" :key="s.id" class="session-item" :class="{ active: s.id === agent.activeSessionId }" @click="switchSession(s.id)">
          <span class="sess-name">{{ s.name }}</span>
          <span class="sess-count">{{ s.message_count }}</span>
          <button class="sess-del" @click.stop="delSession(s.id)" title="删除" aria-label="删除会话"><X :size="14" :stroke-width="2" /></button>
        </div>
        <div v-if="!agent.sessions.length" class="no-files">暂无会话</div>
      </div>
      <button class="btn-dashed" @click="newSession"><Plus :size="14" :stroke-width="2" /> 新建会话</button>

      <hr class="divider" />

      <div class="cap-card">
        <div class="cap-title">助手能做什么</div>
        <ul class="cap-list">
          <li>读单据并抽取报关字段</li>
          <li>多张发票箱单合并申报</li>
          <li>查询历史抽取结果</li>
          <li>解释抽取模板字段</li>
        </ul>
        <div class="cap-hint">由 pi-agent 驱动，会自动调用工具完成任务</div>
      </div>
    </aside>

    <!-- Chat Area -->
    <div
      class="chat-area"
      :class="{ 'drag-over': dragOver }"
      @dragover.prevent="onDragOver"
      @dragenter.prevent="onDragEnter"
      @dragleave.prevent="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div v-if="dragOver" class="drag-overlay">
        <div class="drag-hint"><UploadCloud :size="28" :stroke-width="1.5" /> 释放文件以上传</div>
      </div>
      <div class="chat-msgs" ref="chatContainer">
        <div v-if="!agent.messages.length && !agent.isProcessing" class="welcome">
          <div class="welcome-icon">π</div>
          <h2>你好，我是 Delta IDP 智能助手</h2>
          <p>拖拽单据到此处上传，或直接提问。我会自动调用工具帮你读单据、抽字段、合并申报、查历史。</p>
          <div class="welcome-chips">
            <button v-for="q in quickActions" :key="q" class="welcome-chip" @click="handleSend(q)">{{ q }}</button>
          </div>
        </div>
        <ChatBubble v-for="(m, i) in agent.messages" :key="i" :role="m.role" :content="m.content" :time="m.time" :is-typing="m.isTyping" />
        <!-- Processing indicator -->
        <div v-if="agent.isProcessing && agent.processingStatus" class="processing-banner">
          <span class="proc-spinner"></span>
          <span>{{ agent.processingStatus }}</span>
        </div>
      </div>
      <ChatInput
        :disabled="agent.isProcessing"
        :quick-actions="quickActions"
        :active-file="agent.activeFile"
        @send="handleSend"
        @quick-action="handleSend"
        @remove-file="agent.removeFile(0)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue'
import { useAgentStore } from '../stores/agent.js'
import ChatBubble from '../components/ChatBubble.vue'
import ChatInput from '../components/ChatInput.vue'
import { MessageSquare, Plus, X, UploadCloud } from '../components/icons.js'

const agent = useAgentStore()
const chatContainer = ref(null)
const dragOver = ref(false)
let dragCounter = 0

function onDragEnter() {
  dragCounter++
  dragOver.value = true
}
function onDragOver() {
  dragOver.value = true
}
function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    dragCounter = 0
    dragOver.value = false
  }
}

const quickActions = ['查看可用的抽取模板', '查最近的抽取结果', '把上传的资料抽成报关单', '解释报关单模板有哪些字段', '如何做多票合并申报']

function onDrop(e) {
  dragCounter = 0
  dragOver.value = false
  for (const f of e.dataTransfer.files) {
    agent.uploadFile(f).then(d => agent.addMsg('system', `已加载单据: **${d.filename}**`))
  }
}

function scrollDown() {
  nextTick(() => { if (chatContainer.value) chatContainer.value.scrollTop = chatContainer.value.scrollHeight })
}

async function handleSend(message) {
  await agent.sendMessageStream(message)
  scrollDown()
}

async function switchSession(id) {
  await agent.loadSession(id)
  agent.messages = (agent.chatHistory || []).map(m => ({
    role: m.role, content: m.content,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  }))
  scrollDown()
}

async function newSession() {
  const name = '会话 ' + new Date().toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  await agent.createSession(name)
  agent.messages = []
}

async function delSession(id) {
  if (!confirm('确定删除此会话？')) return
  await agent.deleteSession(id)
  if (id === agent.activeSessionId) agent.messages = []
}

onMounted(async () => {
  await agent.loadSessions()
  if (!agent.sessions.length) await newSession()
})
</script>

<style scoped>
.agent-layout { display: grid; grid-template-columns: 280px 1fr; flex: 1; min-height: 0; }

/* ─── Left Column ─────────────────────────────── */
.sessions-col { background: var(--c-canvas); border-right: 1px solid var(--c-border); padding: 16px; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.sec-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--c-gray-500); margin-bottom: 4px; display: flex; align-items: center; gap: 5px; }

/* Capability card */
.cap-card { background: white; border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: 14px; box-shadow: var(--shadow-sm); }
.cap-title { font-size: 12px; font-weight: 700; color: var(--c-gray-700); margin-bottom: 8px; }
.cap-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cap-list li { font-size: 12px; color: var(--c-gray-600); padding-left: 18px; position: relative; }
.cap-list li::before { content: ''; position: absolute; left: 4px; top: 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--c-primary); }
.cap-hint { font-size: 11px; color: var(--c-gray-400); margin-top: 10px; line-height: 1.5; }
.no-files { font-size: 12px; color: var(--c-gray-400); padding: 8px; }
.divider { border: none; border-top: 1px solid var(--c-gray-200); margin: 4px 0; }
.btn-dashed { width: 100%; padding: 10px; border: 2px dashed var(--c-gray-300); border-radius: var(--radius); background: none; cursor: pointer; font-size: 13px; color: var(--c-gray-500); transition: all var(--t-fast); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.btn-dashed:hover { border-color: var(--c-primary); color: var(--c-primary); background: var(--c-primary-light); }
.toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: var(--c-gray-600); }

/* ─── Sessions ────────────────────────────────── */
.session-list { display: flex; flex-direction: column; gap: 4px; }
.session-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius); cursor: pointer; font-size: 12px; transition: all var(--t-fast); border: 1px solid transparent; }
.session-item:hover { background: white; border-color: var(--c-border); }
.session-item.active { background: var(--c-primary-50); color: var(--c-primary); border-color: var(--c-primary-light); }
.sess-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.sess-count { font-size: 10px; background: var(--c-gray-200); color: var(--c-gray-500); padding: 1px 6px; border-radius: 10px; }
.session-item.active .sess-count { background: var(--c-primary); color: white; }
.sess-del { background: none; border: none; color: var(--c-gray-400); cursor: pointer; display: inline-flex; align-items: center; padding: 2px; border-radius: 4px; opacity: 0; transition: all var(--t-fast); }
.session-item:hover .sess-del { opacity: 1; }
.sess-del:hover { color: var(--c-danger); background: var(--c-danger-light); }

/* ─── Chat Area ───────────────────────────────── */
.chat-area { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; position: relative; }
.chat-area.drag-over { outline: 3px dashed var(--c-primary); outline-offset: -8px; }
.drag-overlay { position: absolute; inset: 0; z-index: 50; background: rgba(37,99,235,.06); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.drag-hint { background: white; padding: 24px 48px; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); font-size: 18px; font-weight: 600; color: var(--c-primary); display: flex; align-items: center; gap: 10px; }
.chat-msgs { flex: 1; min-height: 0; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 20px; }
.welcome { text-align: center; padding: 64px 20px; max-width: 560px; margin: 0 auto; }
.welcome-icon { width: 76px; height: 76px; border-radius: 22px; background: linear-gradient(135deg, var(--c-primary), var(--c-purple)); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; color: white; font-size: 34px; font-weight: 600; box-shadow: var(--shadow-lg); }
.welcome h2 { font-size: 22px; font-weight: 700; margin-bottom: 10px; letter-spacing: -.01em; }
.welcome p { font-size: 14px; color: var(--c-gray-500); line-height: 1.65; }
.welcome-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 22px; }
.welcome-chip { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--c-border); background: white; color: var(--c-gray-700); font-size: 12.5px; cursor: pointer; transition: all var(--t-fast); box-shadow: var(--shadow-sm); }
.welcome-chip:hover { border-color: var(--c-primary); color: var(--c-primary); background: var(--c-primary-50); transform: translateY(-1px); }

/* ─── Processing indicator ───────────────────── */
.processing-banner { display: flex; align-items: center; gap: 10px; padding: 10px 18px; margin: 4px 0; background: var(--c-primary-light); border-radius: var(--radius); font-size: 13px; color: var(--c-primary); animation: fadeIn .3s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.proc-spinner { width: 16px; height: 16px; border: 2px solid var(--c-gray-200); border-top-color: var(--c-primary); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Responsive ──────────────────────────────── */
@media (max-width: 1024px) { .agent-layout { grid-template-columns: 1fr; } .sessions-col { border-right: none; border-bottom: 1px solid var(--c-gray-200); } }
</style>
