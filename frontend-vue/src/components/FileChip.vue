<template>
  <div class="file-chip" :class="{ active }">
    <span class="chip-dot" :class="dotClass"></span>
    <span class="chip-name" :title="file.filename">{{ file.filename }}</span>
    <button class="chip-remove" @click.stop="$emit('remove')" title="移除" aria-label="移除文件">
      <X :size="14" :stroke-width="2" />
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { X } from './icons.js'

const props = defineProps({ file: Object, active: Boolean })
defineEmits(['remove'])

const dotClass = computed(() => ({
  invoice: props.file?.document_type === 'invoice',
  packing: props.file?.document_type === 'packing_list',
}))
</script>

<style scoped>
.file-chip {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: var(--c-gray-50);
  border: 1px solid var(--c-gray-200); border-radius: var(--radius);
  font-size: 13px; cursor: pointer; transition: all var(--t-fast);
  min-height: 36px;
}
.file-chip:hover { border-color: var(--c-primary); background: var(--c-primary-light); }
.file-chip.active { border-color: var(--c-primary); background: var(--c-primary-light); box-shadow: var(--focus-ring); }
.chip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--c-gray-400); }
.chip-dot.invoice { background: var(--c-primary); }
.chip-dot.packing { background: var(--c-success); }
.chip-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.chip-remove { background: none; border: none; color: var(--c-gray-400); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 2px; border-radius: 4px; transition: all var(--t-fast); }
.chip-remove:hover { color: var(--c-danger); background: var(--c-danger-light); }
</style>
