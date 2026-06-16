import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./TemplateEditor.vue', import.meta.url), 'utf8')

test('template fields include original source wording in editor, prompt preview, and saved data', () => {
  assert.match(source, /来源中原文表述/)
  assert.match(source, /v-model="f\.source_original_text"/)
  assert.match(source, /\| 序号 \| 字段 \| 数据来源 \| 来源中原文表述 \|/)
  assert.match(source, /source_original_text: f\.source_original_text \|\| ''/)
})
