<template>
  <div class="result-tabs">
    <button v-for="tab in tabs" :key="tab.key" class="tab-btn" :class="{ active: modelValue === tab.key }" @click="$emit('update:modelValue', tab.key)">
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup>
defineProps({ modelValue: String, tabs: { type: Array, default: () => [] } })
defineEmits(['update:modelValue'])
</script>

<style scoped>
.result-tabs { display: flex; gap: 4px; background: var(--c-gray-100); padding: 3px; border-radius: var(--radius); }
.tab-btn { padding: 6px 16px; border: none; background: none; border-radius: 6px; font-size: 13px; cursor: pointer; color: var(--c-gray-600); transition: all .15s; }
.tab-btn.active { background: white; color: var(--c-gray-900); box-shadow: var(--shadow-sm); }
</style>
