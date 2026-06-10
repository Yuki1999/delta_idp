<template>
  <div v-if="message" class="status-badge" :class="type">{{ message }}</div>
</template>
<script setup>
defineProps({ message: String, type: { type: String, default: 'loading' } }) // loading | success | error
</script>
<style scoped>
.status-badge { padding: 8px 14px; border-radius: var(--radius); font-size: 13px; font-weight: 500; text-align: center; }
.status-badge.loading { background: var(--c-primary-light); color: var(--c-primary); }
.status-badge.success { background: var(--c-success-light); color: var(--c-success); }
.status-badge.error { background: var(--c-danger-light); color: var(--c-danger); }
</style>
