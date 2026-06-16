import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./ExtractionView.vue', import.meta.url), 'utf8')

test('document preview remounts when the selected task or preview file changes', () => {
  assert.match(source, /class="doc-viewer-body"[^>]*:key="previewKey"/)
})

test('task click resets document viewer transient UI state like history click', () => {
  const match = source.match(/async function onTaskClick\(task\) \{([\s\S]*?)\n\}/)
  assert.ok(match, 'onTaskClick function should exist')
  assert.match(match[1], /highlightedCells\.value = new Set\(\)/)
  assert.match(match[1], /activeSheet\.value = 0/)
  assert.match(match[1], /store\.setHighlightedField\(null\)/)
})

test('task list has a delete action that does not trigger task selection', () => {
  assert.match(source, /@click\.stop="delTask\(t\.id\)"/)
})

test('sample materials are open by default between upload and extraction config', () => {
  assert.match(source, /const samplePanelOpen = ref\(true\)/)

  const uploadIndex = source.indexOf('上传报关资料')
  const sampleIndex = source.indexOf('示例资料')
  const configIndex = source.indexOf('抽取配置')
  assert.ok(uploadIndex >= 0, 'upload panel should exist')
  assert.ok(sampleIndex >= 0, 'sample panel should exist')
  assert.ok(configIndex >= 0, 'config panel should exist')
  assert.ok(uploadIndex < sampleIndex, 'sample panel should be after upload panel')
  assert.ok(sampleIndex < configIndex, 'sample panel should be before config panel')
})
