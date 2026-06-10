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
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
    <p>拖拽文件到此处或 <button type="button" class="btn-link">点击上传</button></p>
    <p class="hint">支持 .xlsx / .xls / .png / .jpg</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({ accept: { type: String, default: '.xlsx,.xls,.png,.jpg' } })
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
  padding: 24px; text-align: center; cursor: pointer; transition: all .2s;
}
.upload-zone:hover, .upload-zone.drag-over { border-color: var(--c-primary); background: var(--c-primary-light); }
.upload-zone p { color: var(--c-gray-600); font-size: 14px; margin-top: 8px; }
.hint { font-size: 12px !important; color: var(--c-gray-400) !important; }
.btn-link { color: var(--c-primary); background: none; border: none; cursor: pointer; font-size: 14px; text-decoration: underline; }
</style>
