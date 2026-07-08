<template>
  <div
    class="upload-zone"
    :class="{ 'drag-over': isDragging }"
    @click="$refs.fileInput.click()"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileInput" type="file" :accept="accept" multiple hidden @change="onChange" />
    <UploadCloud :size="36" :stroke-width="1.5" class="upload-icon" />
    <p>拖放文件到此处或 <button type="button" class="btn-link">点击上传</button></p>
    <p class="hint">支持单文件或整套报关资料（.xlsx / .txt / .pdf）</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { UploadCloud } from './icons.js'

const props = defineProps({ accept: { type: String, default: '.xlsx,.xls,.png,.jpg,.pdf,.txt,.csv' } })
const emit = defineEmits(['files-selected'])
const isDragging = ref(false)

function onDrop(e) {
  isDragging.value = false
  emit('files-selected', e.dataTransfer.files)
}

function onChange(e) {
  emit('files-selected', e.target.files)
  e.target.value = ''
}
</script>

<style scoped>
.upload-zone {
  border: 2px dashed var(--c-gray-300); border-radius: var(--radius);
  padding: 24px; text-align: center; cursor: pointer; transition: all var(--t-normal);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.upload-icon { color: var(--c-gray-400); transition: color var(--t-normal); }
.upload-zone:hover { border-color: var(--c-primary); background: var(--c-primary-light); }
.upload-zone:hover .upload-icon { color: var(--c-primary); }
.upload-zone.drag-over { border-color: var(--c-primary); background: var(--c-primary-light); transform: scale(1.01); }
.upload-zone.drag-over .upload-icon { color: var(--c-primary); }
.upload-zone p { color: var(--c-gray-600); font-size: 14px; margin-top: 4px; }
.hint { font-size: 12px !important; color: var(--c-gray-400) !important; }
.btn-link { color: var(--c-primary); background: none; border: none; cursor: pointer; font-size: 14px; text-decoration: underline; }
.btn-link:hover { color: var(--c-primary-dark); }
</style>
