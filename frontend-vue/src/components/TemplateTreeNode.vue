<template>
  <li class="t-node" :class="{ expanded: isOpen }">
    <div class="t-row" :class="{ selected: isSelected, 'is-group': node.is_group }" @click="onClick" :style="{ paddingLeft: (depth * 16 + 8) + 'px' }">
      <span v-if="node.is_group" class="t-arrow" @click.stop="isOpen = !isOpen">
        <svg :class="{ rotated: isOpen }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
      </span>
      <span v-else class="t-arrow"></span>
      <span class="t-icon">
        <component v-if="node.is_group" :is="isOpen ? FolderOpen : FolderClosed" :size="14" :stroke-width="1.5" />
        <FileText v-else :size="14" :stroke-width="1.5" />
      </span>
      <span class="t-name">{{ node.name }}</span>
      <span v-if="node.vendor && node.vendor !== 'generic'" class="t-badge">{{ node.vendor }}</span>
      <span v-if="node.is_group" class="t-count">{{ node.children?.length || 0 }}</span>
      <span class="t-actions" v-if="!node.is_group">
        <button class="act-btn" @click.stop="$emit('edit', node)" title="编辑" aria-label="编辑"><Pencil :size="12" :stroke-width="1.5" /></button>
        <button class="act-btn" @click.stop="$emit('duplicate', node)" title="复制" aria-label="复制"><Copy :size="12" :stroke-width="1.5" /></button>
        <button class="act-btn danger" @click.stop="$emit('delete', node)" title="删除" aria-label="删除"><Trash2 :size="12" :stroke-width="1.5" /></button>
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
import { FolderOpen, FolderClosed, FileText, Pencil, Copy, Trash2 } from './icons.js'
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
.t-row { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all var(--t-fast); }
.t-row:hover { background: var(--c-gray-100); }
.t-row.selected { background: var(--c-primary-light); color: var(--c-primary); }
.t-row.is-group { font-weight: 600; }
.t-arrow { width: 14px; display: inline-flex; align-items: center; }
.t-arrow svg { transition: transform var(--t-normal); }
.t-arrow svg.rotated { transform: rotate(90deg); }
.t-icon { display: inline-flex; align-items: center; color: var(--c-gray-500); }
.t-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-badge { font-size: 10px; padding: 1px 6px; background: var(--c-primary-light); color: var(--c-primary); border-radius: 10px; font-weight: 600; }
.t-count { font-size: 11px; color: var(--c-gray-400); }
.t-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--t-fast); }
.t-row:hover .t-actions { opacity: 1; }
.act-btn { background: none; border: none; cursor: pointer; padding: 3px; border-radius: 4px; display: inline-flex; align-items: center; color: var(--c-gray-500); transition: all var(--t-fast); }
.act-btn:hover { background: var(--c-gray-200); color: var(--c-gray-800); }
.act-btn.danger:hover { background: var(--c-danger-light); color: var(--c-danger); }
.t-children { margin: 0; padding: 0; }
</style>
