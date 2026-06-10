<template>
  <div class="compare-card">
    <h4>{{ label }}</h4>
    <div class="row"><span class="tag rule">规则引擎</span><span class="val">{{ ruleValue || '—' }}</span></div>
    <div class="row"><span class="tag qwen">Qwen</span><span class="val">{{ qwenValue || '—' }}</span></div>
    <div class="verdict" :class="match ? 'match' : 'diff'">{{ match ? '✓ 结果一致' : '⚠ 结果有差异' }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ label: String, ruleValue: String, qwenValue: String })
const match = computed(() => props.ruleValue === props.qwenValue)
</script>

<style scoped>
.compare-card { background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius); padding: 16px; }
.compare-card h4 { font-size: 13px; color: var(--c-gray-700); margin-bottom: 8px; }
.row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.tag.rule { background: var(--c-primary-light); color: var(--c-primary); }
.tag.qwen { background: var(--c-success-light); color: var(--c-success); }
.val { font-weight: 600; max-width: 60%; text-align: right; word-break: break-all; }
.verdict { font-size: 11px; margin-top: 6px; }
.verdict.match { color: var(--c-success); }
.verdict.diff { color: var(--c-warning); }
</style>
