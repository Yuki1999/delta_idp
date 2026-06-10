import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTemplateStore = defineStore('templates', () => {
  const tree = ref([])
  const currentTemplate = ref(null)
  const isEditing = ref(false)
  const isSaving = ref(false)

  async function loadTree() {
    const resp = await fetch('/api/templates/tree')
    const data = await resp.json()
    tree.value = data.tree || []
  }

  async function loadTemplate(id) {
    const resp = await fetch(`/api/templates/${id}`)
    if (!resp.ok) throw new Error('Template not found')
    const data = await resp.json()
    currentTemplate.value = { id, ...data }
    return currentTemplate.value
  }

  async function createTemplate(data) {
    isSaving.value = true
    try {
      const resp = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!resp.ok) throw new Error('Create failed')
      await loadTree()
      return await resp.json()
    } finally {
      isSaving.value = false
    }
  }

  async function updateTemplate(id, data) {
    isSaving.value = true
    try {
      const resp = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!resp.ok) throw new Error('Update failed')
      await loadTree()
      return await resp.json()
    } finally {
      isSaving.value = false
    }
  }

  async function deleteTemplate(id) {
    const resp = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
    if (!resp.ok) throw new Error('Delete failed')
    await loadTree()
    currentTemplate.value = null
  }

  async function duplicateTemplate(id) {
    const resp = await fetch(`/api/templates/${id}/duplicate`, { method: 'POST' })
    if (!resp.ok) throw new Error('Duplicate failed')
    await loadTree()
    return await resp.json()
  }

  return {
    tree, currentTemplate, isEditing, isSaving,
    loadTree, loadTemplate, createTemplate, updateTemplate,
    deleteTemplate, duplicateTemplate,
  }
})
