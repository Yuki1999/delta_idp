<template>
  <div class="file-chip" :class="{ active }">
    <span class="chip-dot" :class="dotClass"></span>
    <span class="chip-name" :title="file.filename">{{ file.filename }}</span>
    <button class="chip-remove" @click.stop="$emit('remove')" title="移除">&times;</button>
  </div>
</template>

<script setup>
import { computed } from 'vue'

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
  font-size: 13px; cursor: pointer; transition: all .15s;
}
.file-chip:hover, .file-chip.active { border-color: var(--c-primary); background: var(--c-primary-light); box-shadow: 0 0 0 2px rgba(37,99,235,.1); }
.chip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--c-gray-400); }
.chip-dot.invoice { background: var(--c-primary); }
.chip-dot.packing { background: var(--c-success); }
.chip-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.chip-remove { background: none; border: none; color: var(--c-gray-400); cursor: pointer; font-size: 16px; line-height: 1; }
.chip-remove:hover { color: var(--c-danger); }
</style>
