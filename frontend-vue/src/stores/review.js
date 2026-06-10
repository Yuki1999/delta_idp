import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useReviewStore = defineStore('review', () => {
  const pendingItems = ref([])
  const confirmedItems = ref([])
  const currentItem = ref(null)
  const isSaving = ref(false)

  async function loadItems() {
    try {
      const [pendingResp, confirmedResp] = await Promise.all([
        fetch('/api/review/items?status=pending'),
        fetch('/api/review/items?status=confirmed'),
      ])
      const pendingData = await pendingResp.json()
      const confirmedData = await confirmedResp.json()
      pendingItems.value = pendingData.items || []
      confirmedItems.value = confirmedData.items || []
    } catch (e) {
      console.warn('Review items load failed:', e)
    }
  }

  async function loadItem(id) {
    const resp = await fetch(`/api/review/items/${id}`)
    if (!resp.ok) throw new Error('Not found')
    currentItem.value = await resp.json()
    return currentItem.value
  }

  async function confirmItem(id) {
    isSaving.value = true
    try {
      await fetch(`/api/review/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      })
      await loadItems()
      if (currentItem.value?.id === id) {
        currentItem.value.status = 'confirmed'
      }
    } finally {
      isSaving.value = false
    }
  }

  async function saveCorrections(id, fields, corrections = []) {
    isSaving.value = true
    try {
      await fetch(`/api/review/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'modified', fields, corrections }),
      })
      await loadItems()
      if (currentItem.value?.id === id) {
        currentItem.value.fields = fields
        currentItem.value.status = 'modified'
      }
    } finally {
      isSaving.value = false
    }
  }

  async function deleteItem(id) {
    await fetch(`/api/review/items/${id}`, { method: 'DELETE' })
    await loadItems()
    if (currentItem.value?.id === id) currentItem.value = null
  }

  return {
    pendingItems, confirmedItems, currentItem, isSaving,
    loadItems, loadItem, confirmItem, saveCorrections, deleteItem,
  }
})
