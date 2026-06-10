<template>
  <div class="chat-msg" :class="[role, { system: role === 'system' }]">
    <div class="avatar">{{ role === 'assistant' ? 'π' : role === 'system' ? '📋' : 'U' }}</div>
    <div>
      <div class="bubble" v-html="rendered"></div>
      <div class="time" v-if="time">{{ time }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { marked } from 'marked'

// Configure marked for safe rendering
marked.setOptions({ breaks: true, gfm: true })

const props = defineProps({ role: String, content: String, time: String, isTyping: Boolean })

const rendered = computed(() => {
  if (props.isTyping) return '<span class="typing"><span></span><span></span><span></span></span>'
  if (!props.content) return ''
  try {
    // Render tables, code, lists, bold etc.
    return marked.parse(props.content) || ''
  } catch {
    // Fallback: basic formatting
    const t = props.content
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
    return t
  }
})
</script>

<style scoped>
.chat-msg { display: flex; gap: 14px; max-width: 80%; animation: msgIn .35s ease; }
.chat-msg.user { align-self: flex-end; flex-direction: row-reverse; }
.chat-msg.system { max-width: 100%; justify-content: center; }
@keyframes msgIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

.avatar { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 16px; font-weight: 700; }
.assistant .avatar { background: linear-gradient(135deg, var(--c-primary), var(--c-purple)); color: white; box-shadow: 0 2px 8px rgba(37,99,235,.3); }
.user .avatar { background: var(--c-gray-200); color: var(--c-gray-600); }
.system .avatar { background: var(--c-gray-100); color: var(--c-gray-500); width: 32px; height: 32px; font-size: 14px; }
.system .bubble { background: transparent; border: none; box-shadow: none; text-align: center; padding: 6px; font-size: 12px; color: var(--c-gray-400); }

.bubble { padding: 14px 18px; border-radius: 16px; font-size: 14px; line-height: 1.75; box-shadow: 0 1px 4px rgba(0,0,0,.06); word-break: break-word; }
.user .bubble { background: var(--c-primary); color: white; }
.assistant .bubble { background: white; border: 1px solid var(--c-gray-100); color: var(--c-gray-800); }

/* Markdown rendered elements */
.bubble :deep(p) { margin: 0 0 8px; }
.bubble :deep(p:last-child) { margin-bottom: 0; }
.bubble :deep(ul), .bubble :deep(ol) { margin: 8px 0; padding-left: 20px; }
.bubble :deep(li) { margin: 4px 0; }
.bubble :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 13px; }
.bubble :deep(th), .bubble :deep(td) { border: 1px solid var(--c-gray-200); padding: 6px 10px; text-align: left; }
.bubble :deep(th) { background: var(--c-gray-50); font-weight: 600; }
.bubble :deep(pre) { background: #1e1e2e; color: #cdd6f4; padding: 16px; border-radius: 12px; overflow-x: auto; font-family: var(--font-mono); font-size: 13px; margin: 10px 0; }
.bubble :deep(code) { background: var(--c-gray-100); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 13px; }
.bubble :deep(pre code) { background: transparent; padding: 0; }
.bubble :deep(h1), .bubble :deep(h2), .bubble :deep(h3) { margin: 10px 0 6px; font-weight: 700; }
.bubble :deep(h1) { font-size: 18px; } .bubble :deep(h2) { font-size: 16px; } .bubble :deep(h3) { font-size: 15px; }
.bubble :deep(hr) { border: none; border-top: 1px solid var(--c-gray-200); margin: 12px 0; }
.bubble :deep(blockquote) { border-left: 3px solid var(--c-primary); padding-left: 12px; color: var(--c-gray-500); margin: 8px 0; }

.user .bubble :deep(code) { background: rgba(255,255,255,.2); }
.user .bubble :deep(blockquote) { border-left-color: rgba(255,255,255,.4); color: rgba(255,255,255,.8); }
.user .bubble :deep(th) { background: rgba(255,255,255,.15); }
.user .bubble :deep(th), .user .bubble :deep(td) { border-color: rgba(255,255,255,.2); }

.time { font-size: 10px; color: var(--c-gray-400); margin-top: 4px; }
.user .time { text-align: right; }

.typing { display: inline-flex; gap: 6px; align-items: center; padding: 8px 0; }
.typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--c-gray-400); animation: dot 1.4s infinite; }
.typing span:nth-child(2) { animation-delay: .2s; }
.typing span:nth-child(3) { animation-delay: .4s; }
@keyframes dot { 0%,60%,100% { transform: translateY(0); opacity: .4; } 30% { transform: translateY(-7px); opacity: 1; } }
</style>
