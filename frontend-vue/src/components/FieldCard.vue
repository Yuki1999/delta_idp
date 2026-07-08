<template>
  <div class="field-card">
    <div class="field-label">{{ field.label || field.name }}</div>
    <div class="field-value" :class="{ null: !field.value }">
      {{ field.value || '未识别' }}
    </div>
    <span v-if="field.confidence" class="field-conf" :class="field.confidence">
      <component :is="confIcon" :size="12" :stroke-width="2" :fill="field.confidence === 'high' ? 'currentColor' : 'none'" />
      {{ confLabel }}
    </span>
    <div v-if="field._source" class="field-source">来源: {{ field._source }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Circle, CircleDot, CircleDashed } from './icons.js'

const props = defineProps({ field: Object })

const confIcon = computed(() => ({
  high: Circle,        // filled solid
  medium: CircleDot,   // half-filled
  low: CircleDashed,   // outline dashed
}[props.field.confidence] || Circle))

const confLabel = computed(() => ({
  high: '高置信度', medium: '中置信度', low: '低置信度'
}[props.field.confidence] || ''))
</script>

<style scoped>
.field-card { background: white; border: 1px solid var(--c-gray-200); border-radius: var(--radius); padding: 16px; transition: box-shadow var(--t-normal), border-color var(--t-normal); }
.field-card:hover { box-shadow: var(--shadow-md); border-color: var(--c-gray-300); }
.field-label { font-size: 11px; font-weight: 600; color: var(--c-gray-400); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
.field-value { font-size: 15px; font-weight: 600; color: var(--c-gray-900); word-break: break-all; }
.field-value.null { color: var(--c-gray-400); font-style: italic; font-weight: 400; }
.field-conf { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500; }
.field-conf.high { background: var(--c-success-light); color: var(--c-success); }
.field-conf.medium { background: var(--c-warning-light); color: var(--c-warning); }
.field-conf.low { background: var(--c-danger-light); color: var(--c-danger); }
.field-source { font-size: 10px; color: var(--c-gray-400); margin-top: 4px; }
</style>
