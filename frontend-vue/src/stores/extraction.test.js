import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useExtractionStore } from './extraction.js'

const originalFetch = global.fetch
const originalSetInterval = global.setInterval
const originalClearInterval = global.clearInterval

afterEach(() => {
  global.fetch = originalFetch
  global.setInterval = originalSetInterval
  global.clearInterval = originalClearInterval
})

test('initial data load resumes polling when a task is still running after refresh', async () => {
  setActivePinia(createPinia())

  const calls = []
  global.fetch = async (url) => {
    calls.push(String(url))
    if (url === '/api/templates') {
      return Response.json({ templates: [] })
    }
    if (url === '/api/templates/tree') {
      return Response.json({ tree: [] })
    }
    if (url === '/api/history') {
      return Response.json({ history: [{ id: 'old-history', filename: 'old.xlsx' }] })
    }
    if (url === '/api/samples') {
      return Response.json({ folders: [] })
    }
    if (url === '/api/tasks') {
      return Response.json({
        tasks: [{ id: 'task-1', status: 'running', input: { filename: 'sample.xlsx' } }],
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  let intervalStarted = false
  global.setInterval = () => {
    intervalStarted = true
    return 1
  }
  global.clearInterval = () => {}

  const store = useExtractionStore()
  await store.initializeData()

  assert.deepEqual(store.history.map((h) => h.id), ['old-history'])
  assert.deepEqual(store.tasks.map((t) => t.id), ['task-1'])
  assert.equal(intervalStarted, true)
  assert.ok(calls.includes('/api/history'))
  assert.ok(calls.includes('/api/tasks'))
})

test('loading a completed sample-set task restores the first document preview directly', async () => {
  setActivePinia(createPinia())

  const calls = []
  global.fetch = async (url) => {
    const requestUrl = String(url)
    calls.push(requestUrl)
    if (requestUrl === '/api/tasks/task-1') {
      return Response.json({
        id: 'task-1',
        status: 'complete',
        method: 'standard',
        input: { filename: '[资料集] DS12650253' },
        result: { markdown: 'ok', fields: [], line_items: [] },
      })
    }
    if (requestUrl === '/api/samples') {
      return Response.json({
        folders: [{
          name: 'DS12650253',
          path: '/samples/DS12650253',
          files: ['DS12650253_IV(1).xlsx', 'DS12650253_PL(1).xlsx'],
        }],
      })
    }
    if (requestUrl.startsWith('/api/document/preview?')) {
      return Response.json({ filename: 'samples/DS12650253/DS12650253_IV(1).xlsx', file_type: 'xlsx', sheets: [] })
    }
    throw new Error(`unexpected fetch ${requestUrl}`)
  }

  const store = useExtractionStore()
  await store.loadTaskResult('task-1')

  assert.equal(store.currentResult._taskId, 'task-1')
  assert.equal(store.folderFiles.length, 2)
  assert.equal(store.documentPreview?.filename, 'samples/DS12650253/DS12650253_IV(1).xlsx')
  assert.ok(calls.some((url) => url.includes('samples%2FDS12650253%2FDS12650253_IV')))
})

test('loading history uses stored file path for document preview', async () => {
  setActivePinia(createPinia())

  const calls = []
  global.fetch = async (url) => {
    const requestUrl = String(url)
    calls.push(requestUrl)
    if (requestUrl === '/api/history/history-1') {
      return Response.json({
        id: 'history-1',
        filename: 'ES12661495_IV.xlsx',
        file_path: 'uploads/5bde270a_ES12661495_IV.xlsx',
        method: 'standard',
        markdown: 'ok',
      })
    }
    if (requestUrl.startsWith('/api/document/preview?')) {
      return Response.json({ filename: 'uploads/5bde270a_ES12661495_IV.xlsx', file_type: 'xlsx', sheets: [] })
    }
    throw new Error(`unexpected fetch ${requestUrl}`)
  }

  const store = useExtractionStore()
  await store.loadHistoryEntry('history-1')

  assert.equal(store.documentPreview?.filename, 'uploads/5bde270a_ES12661495_IV.xlsx')
  assert.ok(calls.some((url) => url.includes('uploads%2F5bde270a_ES12661495_IV.xlsx')))
})

test('loading history restores uploaded folder files from stored folder path', async () => {
  setActivePinia(createPinia())

  const calls = []
  global.fetch = async (url) => {
    const requestUrl = String(url)
    calls.push(requestUrl)
    if (requestUrl === '/api/history/history-set') {
      return Response.json({
        id: 'history-set',
        filename: '[资料集] 846eb8eb',
        folder_path: 'uploads/set_846eb8eb',
        folder_files: ['5bde270a_ES12661495_IV.xlsx', '89452771_ES12661495_PL.xlsx'],
        method: 'standard',
        markdown: 'ok',
      })
    }
    if (requestUrl.startsWith('/api/document/preview?')) {
      return Response.json({ filename: 'uploads/set_846eb8eb/5bde270a_ES12661495_IV.xlsx', file_type: 'xlsx', sheets: [] })
    }
    throw new Error(`unexpected fetch ${requestUrl}`)
  }

  const store = useExtractionStore()
  await store.loadHistoryEntry('history-set')

  assert.deepEqual(store.folderFiles, [
    {
      name: '5bde270a_ES12661495_IV.xlsx',
      folderName: '846eb8eb',
      file_path: 'uploads/set_846eb8eb/5bde270a_ES12661495_IV.xlsx',
    },
    {
      name: '89452771_ES12661495_PL.xlsx',
      folderName: '846eb8eb',
      file_path: 'uploads/set_846eb8eb/89452771_ES12661495_PL.xlsx',
    },
  ])
  assert.equal(store.documentPreview?.filename, 'uploads/set_846eb8eb/5bde270a_ES12661495_IV.xlsx')
  assert.ok(calls.some((url) => url.includes('uploads%2Fset_846eb8eb%2F5bde270a_ES12661495_IV.xlsx')))
})

test('deleting the selected task clears task result and preview state', async () => {
  setActivePinia(createPinia())

  const calls = []
  global.fetch = async (url, options = {}) => {
    const requestUrl = String(url)
    calls.push({ url: requestUrl, method: options.method || 'GET' })
    if (requestUrl === '/api/tasks/task-1' && options.method === 'DELETE') {
      return Response.json({ status: 'deleted' })
    }
    if (requestUrl === '/api/tasks') {
      return Response.json({ tasks: [] })
    }
    throw new Error(`unexpected fetch ${requestUrl}`)
  }

  const store = useExtractionStore()
  store.currentResult = { _taskId: 'task-1', markdown: 'old result' }
  store.documentPreview = { filename: 'old.pdf' }
  store.folderFiles = [{ name: 'old.xlsx', folderName: 'DS12650253' }]

  await store.deleteTask('task-1')

  assert.deepEqual(calls, [
    { url: '/api/tasks/task-1', method: 'DELETE' },
    { url: '/api/tasks', method: 'GET' },
  ])
  assert.equal(store.currentResult, null)
  assert.equal(store.documentPreview, null)
  assert.deepEqual(store.folderFiles, [])
  assert.deepEqual(store.tasks, [])
})

test('deleting the selected history clears history result and preview state', async () => {
  setActivePinia(createPinia())

  global.fetch = async (url, options = {}) => {
    const requestUrl = String(url)
    if (requestUrl === '/api/history/history-1' && options.method === 'DELETE') {
      return Response.json({ status: 'deleted' })
    }
    if (requestUrl === '/api/history') {
      return Response.json({ history: [] })
    }
    throw new Error(`unexpected fetch ${requestUrl}`)
  }

  const store = useExtractionStore()
  store.currentResult = { _historyId: 'history-1', markdown: 'old result' }
  store.documentPreview = { filename: 'old.pdf' }
  store.folderFiles = [{ name: 'old.xlsx', folderName: 'DS12650253' }]

  await store.deleteHistory('history-1')

  assert.equal(store.currentResult, null)
  assert.equal(store.documentPreview, null)
  assert.deepEqual(store.folderFiles, [])
  assert.deepEqual(store.history, [])
})
