<template>
  <div class="chat-input-bar">
    <div class="quick-actions">
      <button v-for="qa in quickActions" :key="qa" class="qa-btn" @click="$emit('quick-action', qa)">{{ qa }}</button>
    </div>
    <div v-if="activeFile" class="active-file-chip">
      <span class="chip-icon"><FileText :size="13" :stroke-width="1.5" /></span>
      <span class="chip-name">{{ activeFile.filename }}</span>
      <button class="chip-close" @click="$emit('remove-file')" aria-label="移除文件"><X :size="13" :stroke-width="2" /></button>
    </div>
    <div class="input-row">
      <textarea
        v-model="text"
        placeholder="输入你的问题，例如：提取发票号码和总金额..."
        rows="1"
        @keydown="onKeydown"
        @input="resize"
        ref="textarea"
        :disabled="disabled"
      ></textarea>
      <button class="send-btn" @click="send" :disabled="!text.trim() || disabled">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { FileText, X } from './icons.js'
defineProps({ disabled: Boolean, quickActions: { type: Array, default: () => [] }, activeFile: Object })
const emit = defineEmits(['send', 'quick-action', 'remove-file'])

const text = ref('')

function resize(e) {
  e.target.style.height = 'auto'
  e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px'
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function send() {
  if (!text.value.trim()) return
  emit('send', text.value)
  text.value = ''
  nextTick(() => {
    const ta = document.querySelector('.chat-input-bar textarea')
    if (ta) { ta.style.height = 'auto'; ta.focus() }
  })
}

function setValue(v) { text.value = v; emit('send', v); text.value = '' }
defineExpose({ setValue })
</script>

<style scoped>
.chat-input-bar { padding: 16px 24px; border-top: 1px solid var(--c-gray-200); background: white; }
.input-row { display: flex; gap: 12px; align-items: flex-end; }
textarea { flex: 1; padding: 14px 18px; border: 1.5px solid var(--c-gray-300); border-radius: 16px; font-size: 14px; font-family: inherit; resize: none; min-height: 48px; max-height: 150px; line-height: 1.5; transition: border-color .2s; }
textarea:focus { outline: none; border-color: var(--c-primary); box-shadow: 0 0 0 4px rgba(37,99,235,.08); }
.send-btn { width: 48px; height: 48px; border-radius: 50%; background: var(--c-primary); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s; flex-shrink: 0; }
.send-btn:hover:not(:disabled) { background: var(--c-primary-dark); transform: scale(1.06); box-shadow: 0 4px 12px rgba(37,99,235,.3); }
.send-btn:disabled { background: var(--c-gray-300); cursor: not-allowed; }
.quick-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qa-btn { padding: 6px 14px; background: var(--c-primary-light); color: var(--c-primary); border: none; border-radius: 20px; font-size: 12px; cursor: pointer; transition: all .15s; white-space: nowrap; }
.qa-btn:hover { background: var(--c-primary); color: white; }
.active-file-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; margin-bottom: 8px; background: var(--c-primary-light); border: 1px solid var(--c-primary); border-radius: var(--radius); font-size: 12px; }
.chip-icon { display: inline-flex; align-items: center; }
.chip-name { font-weight: 500; color: var(--c-primary); }
.chip-close { background: none; border: none; color: var(--c-primary); cursor: pointer; padding: 2px; border-radius: 4px; display: inline-flex; align-items: center; transition: all var(--t-fast); }
.chip-close:hover { color: var(--c-primary-dark); background: rgba(37,99,235,.1); }
</style>
