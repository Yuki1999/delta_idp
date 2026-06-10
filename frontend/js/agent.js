/**
 * Delta IDP - Agent Chat Interface
 * Pi/Pi Mono inspired intelligent document assistant
 */

const API_BASE = '/api';

// ─── State ────────────────────────────────────────────────────────
const agentState = {
  uploadedFiles: [],
  activeFile: null,
  chatHistory: [],
  isProcessing: false,
};

// ─── Initialize ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupAgentUpload();
  setupAgentInput();
});

// ─── Upload ───────────────────────────────────────────────────────
function setupAgentUpload() {
  const input = document.getElementById('agentFileInput');
  input.addEventListener('change', () => handleAgentFiles(input.files));
}

async function handleAgentFiles(files) {
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
      if (resp.ok) {
        const data = await resp.json();
        agentState.uploadedFiles.push(data);
        agentState.activeFile = data;
        renderAgentFileList();
        addSystemMessage(`已加载单据: **${data.filename}** (${data.document_type === 'invoice' ? '发票' : data.document_type === 'packing_list' ? '装箱单' : '未知类型'})`);
      }
    } catch (e) {
      addSystemMessage(`上传失败: ${e.message}`);
    }
  }

  document.getElementById('agentFileInput').value = '';
}

function renderAgentFileList() {
  const container = document.getElementById('agentFileList');
  container.innerHTML = agentState.uploadedFiles.map((f, i) => `
    <div class="file-chip ${f === agentState.activeFile ? 'active' : ''}"
         onclick="selectAgentFile(${i})">
      <span class="chip-icon ${f.document_type === 'invoice' ? 'invoice' : 'packing'}"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">
        ${f.filename}
      </span>
      <button onclick="event.stopPropagation();removeAgentFile(${i})"
              style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:14px;">×</button>
    </div>
  `).join('') || '<div style="font-size:12px;color:var(--gray-400);padding:8px;">暂无上传单据</div>';
}

function selectAgentFile(index) {
  agentState.activeFile = agentState.uploadedFiles[index];
  renderAgentFileList();
  addSystemMessage(`切换到单据: **${agentState.activeFile.filename}**`);
}

function removeAgentFile(index) {
  const removed = agentState.uploadedFiles[index];
  agentState.uploadedFiles.splice(index, 1);
  if (agentState.activeFile === removed) {
    agentState.activeFile = agentState.uploadedFiles[0] || null;
  }
  renderAgentFileList();
}

// ─── Chat ─────────────────────────────────────────────────────────
function setupAgentInput() {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');

  input.addEventListener('input', () => {
    btn.disabled = !input.value.trim() || agentState.isProcessing;
    // Auto-resize
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  });
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || agentState.isProcessing) return;

  // Clear input
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('sendBtn').disabled = true;

  // Add user message
  addChatMessage('user', message);

  // Show typing indicator
  const typingId = showTyping();

  agentState.isProcessing = true;

  try {
    const useQwen = document.getElementById('useQwenCheck').checked;
    const formData = new FormData();
    formData.append('message', message);
    formData.append('history', JSON.stringify(agentState.chatHistory));
    formData.append('use_qwen', String(useQwen));

    // If we have an active file, include context
    if (agentState.activeFile) {
      // Get document text
      formData.append('document_context', 'current_file:' + agentState.activeFile.file_path);
    }

    // First try agent extraction if user asks for extraction
    if (isExtractionRequest(message) && agentState.activeFile) {
      const extFormData = new FormData();
      extFormData.append('message', message);
      extFormData.append('file_path', agentState.activeFile.file_path);

      const resp = await fetch(`${API_BASE}/agent/extract`, {
        method: 'POST',
        body: extFormData,
      });

      if (resp.ok) {
        const data = await resp.json();
        removeTyping(typingId);

        if (data.reply) {
          addChatMessage('assistant', data.reply);
        }

        if (data.extraction && data.extraction.fields) {
          // Render extraction result
          const fieldsHtml = data.extraction.fields.map(f =>
            `| ${f.name} | ${f.value || '未识别'} |`
          ).join('\n');
          const tableMd = `| 字段 | 值 |\n|------|-----|\n${fieldsHtml}`;
          addChatMessage('assistant', tableMd, true);
        }
      } else {
        removeTyping(typingId);
        addChatMessage('assistant', '抽取请求失败，请稍后重试。');
      }
    } else {
      // General chat
      const resp = await fetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        body: formData,
      });

      removeTyping(typingId);

      if (resp.ok) {
        const data = await resp.json();
        addChatMessage('assistant', data.reply);
      } else {
        addChatMessage('assistant', '抱歉，我暂时无法处理这个请求。请稍后重试。');
      }
    }
  } catch (e) {
    removeTyping(typingId);
    addChatMessage('assistant', `发生错误: ${e.message}`);
  }

  agentState.isProcessing = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('chatInput').focus();
}

function sendQuickAction(message) {
  document.getElementById('chatInput').value = message;
  document.getElementById('sendBtn').disabled = false;
  sendMessage();
}

function isExtractionRequest(message) {
  const extractionKeywords = [
    '提取', '抽取', '提取信息', '关键信息',
    '发票号码', '发票号', '总金额', '总价', '币制',
    '发货', '收货', '毛重', '净重', '体积', '件数',
    '产品编号', '料号', '数量', '原产国', '目的地',
    '所有', '列出', '显示', '查看',
  ];
  return extractionKeywords.some(kw => message.includes(kw));
}

// ─── Message Rendering ────────────────────────────────────────────
function addChatMessage(role, content, isMarkdown = false) {
  const container = document.getElementById('chatMessages');

  // Remove welcome message if present
  const welcome = container.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg ${role}`;

  const avatar = role === 'assistant' ? 'π' : 'U';
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  msgDiv.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div>
      <div class="msg-content">${isMarkdown ? simpleMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>')}</div>
      <div class="msg-time">${time}</div>
    </div>
  `;

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;

  // Save to history
  agentState.chatHistory.push({ role, content });
}

function addSystemMessage(text) {
  const container = document.getElementById('chatMessages');
  const welcome = container.querySelector('.welcome-msg');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;padding:8px;font-size:12px;color:var(--gray-500);';
  div.innerHTML = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant typing-indicator-container';
  div.innerHTML = `
    <div class="msg-avatar">π</div>
    <div class="msg-content typing-msg">
      <span></span><span></span><span></span>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeTyping(element) {
  if (element && element.parentNode) {
    element.remove();
  }
}

// ─── Simple Markdown ──────────────────────────────────────────────
function simpleMarkdown(text) {
  // Code blocks
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Tables (basic)
  text = text.replace(/\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)*)/g, (match, header, rows) => {
    const headers = header.split('|').filter(h => h.trim()).map(h => `<th>${h.trim()}</th>`).join('');
    const rowHtml = rows.split('\n').filter(r => r.trim()).map(r =>
      '<tr>' + r.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('') + '</tr>'
    ).join('');
    return `<table><thead><tr>${headers}</tr></thead><tbody>${rowHtml}</tbody></table>`;
  });
  // Line breaks
  text = text.replace(/\n/g, '<br>');
  return text;
}

// ─── Utilities ────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
