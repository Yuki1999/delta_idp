<template>
  <div v-if="message" class="status-badge" :class="type">
    <component :is="icon" :size="14" :stroke-width="2" />
    <span>{{ message }}</span>
  </div>
</template>
<script setup>
import { computed } from 'vue'
import { Loader2, CheckCircle2, AlertTriangle } from './icons.js'

const props = defineProps({
  message: String,
  type: { type: String, default: 'loading' }, // loading | success | error
})

const icon = computed(() => ({
  loading: Loader2,
  success: CheckCircle2,
  error: AlertTriangle,
}[props.type] || Loader2))
</script>
<style scoped>
.status-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: var(--radius); font-size: 13px; font-weight: 500;
}
.status-badge :deep(svg) { flex-shrink: 0; }
.status-badge.loading { background: var(--c-primary-light); color: var(--c-primary); }
.status-badge.loading :deep(svg) { animation: spin 1s linear infinite; }
.status-badge.success { background: var(--c-success-light); color: var(--c-success); }
.status-badge.error { background: var(--c-danger-light); color: var(--c-danger); }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
