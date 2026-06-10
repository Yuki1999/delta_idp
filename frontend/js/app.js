/**
 * Delta IDP - Document Key Information Extraction Demo
 * Frontend Application Logic
 */

const API_BASE = '/api';

// ─── State ────────────────────────────────────────────────────────
const state = {
  uploadedFiles: [],     // {file_id, filename, file_path, document_type, vendor}
  currentResult: null,   // Last extraction result
  templates: [],         // Available templates
};

// ─── DOM Elements ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Initialize ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTemplates();
  setupUpload();
  setupExtract();
  setupSampleFiles();
  setupTabs();
});

// ─── Upload ───────────────────────────────────────────────────────
function setupUpload() {
  const zone = $('#uploadZone');
  const input = $('#fileInput');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => handleFiles(input.files));
}

async function handleFiles(files) {
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
      if (resp.ok) {
        const data = await resp.json();
        state.uploadedFiles.push(data);
        // Auto-detect document type
        if (data.document_type !== 'unknown') {
          $('#docType').value = data.document_type;
        }
        renderFileList();
        updateExtractButton();
      } else {
        const err = await resp.json();
        alert(`上传失败: ${err.detail || '未知错误'}`);
      }
    } catch (e) {
      alert(`上传出错: ${e.message}`);
    }
  }
  // Reset file input
  $('#fileInput').value = '';
}

function renderFileList() {
  const list = $('#fileList');
  list.innerHTML = state.uploadedFiles.map((f, i) => `
    <div class="file-item">
      <span class="file-icon ${f.document_type === 'invoice' ? 'invoice' : f.document_type === 'packing_list' ? 'packing' : ''}">
        ${f.document_type === 'invoice' ? 'IV' : f.document_type === 'packing_list' ? 'PL' : '?'}
      </span>
      <span class="file-name" title="${f.filename}">${f.filename}</span>
      <button class="file-remove" onclick="removeFile(${i})" title="移除">×</button>
    </div>
  `).join('');
}

function removeFile(index) {
  state.uploadedFiles.splice(index, 1);
  renderFileList();
  updateExtractButton();
}

// ─── Templates ────────────────────────────────────────────────────
async function loadTemplates() {
  try {
    const resp = await fetch(`${API_BASE}/templates`);
    const data = await resp.json();
    state.templates = data.templates || [];

    const select = $('#templateSelect');
    select.innerHTML = '<option value="auto">自动选择模板</option>' +
      state.templates.map(t => `
        <option value="${t.id}">${t.name} ${t.vendor !== 'generic' ? '(厂商专用)' : '(通用)'}</option>
      `).join('');
  } catch (e) {
    console.error('Failed to load templates:', e);
  }
}

// ─── Extract ──────────────────────────────────────────────────────
function setupExtract() {
  $('#extractBtn').addEventListener('click', runExtraction);
}

function updateExtractButton() {
  const btn = $('#extractBtn');
  btn.disabled = state.uploadedFiles.length === 0;
  if (btn.disabled) {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      请先上传文件
    `;
  } else {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      开始抽取 (${state.uploadedFiles.length} 个文件)
    `;
  }
}

async function runExtraction() {
  if (!state.uploadedFiles.length) return;

  const method = $$('input[name="method"]:checked')[0]?.value || 'hybrid';
  const templateId = $('#templateSelect').value;
  const docType = $('#docType').value;

  const statusEl = $('#extractStatus');
  statusEl.className = 'status-msg loading';
  statusEl.textContent = '正在抽取中...';
  statusEl.classList.remove('hidden');

  const btn = $('#extractBtn');
  btn.disabled = true;
  btn.textContent = '抽取中...';

  try {
    // For batch: use batch endpoint
    if (state.uploadedFiles.length > 1 && method !== 'qwen') {
      const formData = new FormData();
      formData.append('file_paths', JSON.stringify(state.uploadedFiles.map(f => f.file_path)));
      formData.append('template_id', templateId);
      formData.append('method', method);

      const resp = await fetch(`${API_BASE}/extract/batch`, { method: 'POST', body: formData });
      const data = await resp.json();

      // Merge batch results
      const allFields = [];
      const allLineItems = [];
      data.batch_results.forEach(br => {
        if (br.result?.extraction?.fields) {
          allFields.push(...br.result.extraction.fields.map(f => ({
            ...f,
            _source: br.file,
          })));
        }
        if (br.result?.extraction?.line_items) {
          allLineItems.push(...br.result.extraction.line_items.map(li => ({
            ...li,
            _source: br.file,
          })));
        }
      });
      state.currentResult = {
        fields: allFields,
        line_items: allLineItems,
        method: `batch_${method}`,
      };
    } else {
      // Single file extraction
      const file = state.uploadedFiles[0];
      const detectedType = file.document_type === 'unknown' ? docType : file.document_type;
      const formData = new FormData();
      formData.append('file_path', file.file_path);
      formData.append('template_id', templateId);
      formData.append('document_type', detectedType === 'auto' ? 'invoice' : detectedType);
      formData.append('vendor', file.vendor);

      const endpoint = method === 'mineru' ? 'extract/mineru'
                     : method === 'qwen' ? 'extract/qwen'
                     : 'extract/hybrid';

      const resp = await fetch(`${API_BASE}/${endpoint}`, { method: 'POST', body: formData });
      const data = await resp.json();

      // Handle both response formats
      if (data.extraction) {
        state.currentResult = {
          fields: data.extraction.fields || [],
          line_items: data.extraction.line_items || [],
          method: data.method,
          parsed_content: data.parsed_content,
          qwen_extraction: data.qwen_extraction,
          rule_extraction: data.rule_extraction,
          qwen_validated_fields: data.qwen_validated_fields,
        };
      } else if (data.fields) {
        state.currentResult = {
          fields: data.fields,
          line_items: data.line_items || [],
          method: data.method || method,
        };
      }
    }

    // Handle comparison view for hybrid method
    if (state.currentResult?.qwen_extraction?.fields && state.currentResult?.rule_extraction?.fields) {
      state.currentResult._compare = true;
    }

    renderResults();
    statusEl.className = 'status-msg success';
    statusEl.textContent = '✓ 抽取完成';
  } catch (e) {
    console.error('Extraction error:', e);
    statusEl.className = 'status-msg error';
    statusEl.textContent = `抽取失败: ${e.message}`;
  } finally {
    btn.disabled = false;
    updateExtractButton();
    setTimeout(() => statusEl.classList.add('hidden'), 3000);
  }
}

// ─── Render Results ───────────────────────────────────────────────
function renderResults() {
  if (!state.currentResult) return;

  const { fields, line_items, method, _compare } = state.currentResult;

  // Fields view
  renderFields(fields);

  // Line items view
  renderLineItems(line_items);

  // Raw view
  $('#rawContent').textContent = JSON.stringify(state.currentResult, null, 2);

  // Compare view
  if (_compare) {
    renderCompare();
  } else {
    $('#compareGrid').innerHTML = '<div class="empty-state"><p>混合模式抽取可获取路径对比数据</p></div>';
  }

  // Switch to fields tab
  $$('.tab')[0].click();
}

function renderFields(fields) {
  const grid = $('#fieldResults');
  if (!fields || !fields.length) {
    grid.innerHTML = '<div class="empty-state"><p>未提取到字段信息</p></div>';
    return;
  }

  grid.innerHTML = fields.map(f => `
    <div class="field-card">
      <div class="field-label">${f.label || f.name}</div>
      <div class="field-value ${f.value === null || f.value === undefined ? 'null' : ''}">
        ${f.value !== null && f.value !== undefined ? escapeHtml(String(f.value)) : '未识别'}
      </div>
      ${f.confidence ? `
        <span class="field-conf ${f.confidence}">
          ${f.confidence === 'high' ? '● 高置信度' : f.confidence === 'medium' ? '◐ 中置信度' : '○ 低置信度'}
        </span>
      ` : ''}
      ${f._source ? `<div style="font-size:10px;color:var(--gray-400);margin-top:4px;">来源: ${f._source}</div>` : ''}
    </div>
  `).join('');
}

function renderLineItems(items) {
  const table = $('#lineItemTable');
  const empty = $('#lineItemsEmpty');

  if (!items || !items.length) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';

  // Get all keys
  const allKeys = new Set();
  items.forEach(item => Object.keys(item).forEach(k => {
    if (!k.startsWith('_')) allKeys.add(k);
  }));
  const keys = Array.from(allKeys);

  // Column labels mapping
  const colLabels = {
    item_no: '序号', po_no: '采购订单号', part_no: '产品编号',
    samsung_pn: '三星料号', description: '品名',
    quantity: '数量', unit: '单位', unit_price: '单价',
    amount: '金额', carton_no: '箱号', carton_qty: '箱数',
    net_weight: '净重(KG)', gross_weight: '毛重(KG)',
    measurement: '体积(CBM)',
  };

  table.querySelector('thead').innerHTML = `
    <tr>${keys.map(k => `<th>${colLabels[k] || k}</th>`).join('')}</tr>
  `;
  table.querySelector('tbody').innerHTML = items.map(item => `
    <tr>${keys.map(k => `<td>${item[k] !== undefined ? escapeHtml(String(item[k])) : ''}</td>`).join('')}</tr>
  `).join('');
}

function renderCompare() {
  const grid = $('#compareGrid');
  const qwenFields = state.currentResult.qwen_extraction?.fields || [];
  const ruleFields = state.currentResult.rule_extraction?.fields || [];

  // Build field map
  const fieldMap = {};
  ruleFields.forEach(f => { fieldMap[f.name] = { rule: f.value, qwen: null, label: f.label }; });
  qwenFields.forEach(f => {
    if (fieldMap[f.name]) fieldMap[f.name].qwen = f.value;
    else fieldMap[f.name] = { rule: null, qwen: f.value, label: f.label };
  });

  grid.innerHTML = Object.entries(fieldMap).map(([name, vals]) => `
    <div class="compare-card">
      <h4>${vals.label || name}</h4>
      <div class="compare-row">
        <span><span class="method-tag rule">规则引擎</span></span>
        <span class="compare-value">${vals.rule || '—'}</span>
      </div>
      <div class="compare-row">
        <span><span class="method-tag qwen">Qwen</span></span>
        <span class="compare-value">${vals.qwen || '—'}</span>
      </div>
      ${vals.rule === vals.qwen ? '<div style="color:var(--success);font-size:11px;margin-top:4px;">✓ 结果一致</div>' :
        '<div style="color:var(--warning);font-size:11px;margin-top:4px;">⚠ 结果有差异</div>'}
    </div>
  `).join('');
}

// ─── Tabs ─────────────────────────────────────────────────────────
function setupTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const targetId = `tab-${tab.dataset.tab}`;
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');
    });
  });
}

// ─── Sample Files ─────────────────────────────────────────────────
function setupSampleFiles() {
  $$('.sample-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filename = btn.dataset.file;
      // Check if already uploaded
      if (state.uploadedFiles.find(f => f.filename === filename)) return;

      // Fetch the file from the server's working directory
      try {
        const resp = await fetch(`${API_BASE}/health`); // just to check API is alive
        // We need the sample file from the project directory
        // Create a FormData from the file path
        const formData = new FormData();
        // The backend needs to serve the sample files
        const fileResp = await fetch(`/api/samples/${filename}`);
        if (!fileResp.ok) {
          // Try direct file picker approach
          alert(`请通过上传区域选择文件: ${filename}`);
          return;
        }
        const blob = await fileResp.blob();
        const file = new File([blob], filename);
        const uploadForm = new FormData();
        uploadForm.append('file', file);
        const uploadResp = await fetch(`${API_BASE}/upload`, { method: 'POST', body: uploadForm });
        if (uploadResp.ok) {
          const data = await uploadResp.json();
          state.uploadedFiles.push(data);
          if (data.document_type !== 'unknown') {
            $('#docType').value = data.document_type;
          }
          renderFileList();
          updateExtractButton();
        }
      } catch (e) {
        // Fallback: let user know to manually upload
        console.log('Sample file not served by API, use upload zone instead');
        // Create a highlight effect on upload zone
        const zone = $('#uploadZone');
        zone.style.borderColor = 'var(--primary)';
        zone.style.background = 'var(--primary-light)';
        setTimeout(() => {
          zone.style.borderColor = '';
          zone.style.background = '';
        }, 2000);
        alert('请将文件拖拽到上传区域，或点击上传按钮选择文件。文件位于项目根目录。');
      }
    });
  });
}

// ─── Utilities ────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
