<template>
  <li class="t-node" :class="{ expanded: isOpen }">
    <div class="t-row" :class="{ selected: isSelected, 'is-group': node.is_group }" @click="onClick" :style="{ paddingLeft: (depth * 16 + 8) + 'px' }">
      <span v-if="node.is_group" class="t-arrow" @click.stop="isOpen = !isOpen">
        <svg :class="{ rotated: isOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
      </span>
      <span v-else class="t-arrow"></span>
      <span class="t-icon">{{ node.is_group ? (isOpen ? '📂' : '📁') : '📄' }}</span>
      <span class="t-name">{{ node.name }}</span>
      <span v-if="node.vendor && node.vendor !== 'generic'" class="t-badge">{{ node.vendor }}</span>
      <span v-if="node.is_group" class="t-count">{{ node.children?.length || 0 }}</span>
      <span class="t-actions" v-if="!node.is_group">
        <button class="act-btn" @click.stop="$emit('edit', node)" title="编辑">✏️</button>
        <button class="act-btn" @click.stop="$emit('duplicate', node)" title="复制">📋</button>
        <button class="act-btn danger" @click.stop="$emit('delete', node)" title="删除">🗑️</button>
      </span>
    </div>
    <ul v-if="node.children && node.children.length && isOpen" class="t-children">
      <TemplateTreeNode
        v-for="child in node.children" :key="child.id"
        :node="child" :depth="depth + 1" :selected-id="selectedId"
        @select="$emit('select', $event)"
        @edit="$emit('edit', $event)"
        @duplicate="$emit('duplicate', $event)"
        @delete="$emit('delete', $event)"
      />
    </ul>
  </li>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
const props = defineProps({ node: Object, depth: { type: Number, default: 0 }, selectedId: String })
const emit = defineEmits(['select', 'edit', 'duplicate', 'delete'])

const isOpen = ref(props.depth < 2)
const isSelected = computed(() => props.selectedId === props.node.id)

function onClick() {
  emit('select', props.node)
  if (props.node.is_group) isOpen.value = !isOpen.value
}

watch(() => props.selectedId, () => {
  // auto-expand if a child is selected
  if (props.node.children?.some(c => c.id === props.selectedId)) isOpen.value = true
})
</script>

<style scoped>
.t-node { list-style: none; user-select: none; }
.t-row { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all .1s; }
.t-row:hover { background: var(--c-gray-100); }
.t-row.selected { background: var(--c-primary-light); color: var(--c-primary); }
.t-row.is-group { font-weight: 600; }
.t-arrow { width: 14px; display: inline-flex; align-items: center; }
.t-arrow svg { transition: transform .2s; }
.t-arrow svg.rotated { transform: rotate(90deg); }
.t-icon { font-size: 14px; }
.t-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-badge { font-size: 10px; padding: 1px 6px; background: var(--c-primary-light); color: var(--c-primary); border-radius: 10px; font-weight: 600; }
.t-count { font-size: 11px; color: var(--c-gray-400); }
.t-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .15s; }
.t-row:hover .t-actions { opacity: 1; }
.act-btn { background: none; border: none; cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; }
.act-btn:hover { background: var(--c-gray-200); }
.act-btn.danger:hover { background: var(--c-danger-light); }
.t-children { margin: 0; padding: 0; }
</style>
