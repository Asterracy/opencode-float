const $ = (id) => document.getElementById(id);

const els = {
  app: $('app'),
  modelSelect: $('modelSelect'),
  pinBtn: $('pinBtn'),
  collapseBtn: $('collapseBtn'),
  closeBtn: $('closeBtn'),
  replyArea: $('replyArea'),
  errorBar: $('errorBar'),
  errorText: $('errorText'),
  switchModelBtn: $('switchModelBtn'),
  retryBtn: $('retryBtn'),
  thinking: $('thinking'),
  thinkingLabel: $('thinkingLabel'),
  replyBox: $('replyBox'),
  replyText: $('replyText'),
  thumbs: $('thumbs'),
  attachBtn: $('attachBtn'),
  input: $('input'),
  sendBtn: $('sendBtn'),
};

const state = {
  models: [],
  model: null,
  sessionId: null,
  sending: false,
  images: [], // {path, uri, name}
  lastPayload: null, // {text, files}
  sentAtMs: 0,
  assistantText: '',
  shownLen: 0,
  stableCount: 0,
  pollTimer: null,
  revealTimer: null,
  collapsed: false,
  alwaysOnTop: true,
  hasReply: false,
};

const api = (method, path, body) => window.opencodeFloat.api({ method, path, body });
const normTs = (t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : 0);

function assistantTextOf(msg) {
  return (msg.content || [])
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text)
    .join('\n');
}

function hasToolParts(msg) {
  return (msg.content || []).some((p) => p.type === 'tool_use' || p.type === 'tool');
}

// ---------- 布局 ----------
function resizeToFit() {
  requestAnimationFrame(() => {
    window.opencodeFloat.resize(Math.ceil(document.body.scrollHeight));
  });
}

function setBusy(busy) {
  els.input.disabled = busy;
  els.sendBtn.disabled = busy;
  els.attachBtn.disabled = busy;
  els.input.placeholder = busy ? '等待回复…' : '输入消息，Enter 发送';
}

// ---------- 错误 / 等待 / 回复状态 ----------
function showError(msg, canRetry, opts = {}) {
  hideThinking();
  els.errorBar.hidden = false;
  els.errorText.textContent = msg;
  els.retryBtn.hidden = !canRetry;
  els.switchModelBtn.hidden = !opts.switchModel;
  state.sending = false;
  setBusy(false);
  els.replyArea.hidden = false;
  resizeToFit();
}

function hideError() {
  els.errorBar.hidden = true;
}

function showWaiting(label) {
  hideError();
  els.thinking.classList.remove('done');
  els.thinking.hidden = false;
  els.thinkingLabel.textContent = label || '思考中';
  els.replyText.textContent = '';
  state.hasReply = true;
  els.replyArea.hidden = false;
  resizeToFit();
}

function showDone(label) {
  els.thinking.classList.add('done');
  els.thinking.hidden = false;
  els.thinkingLabel.textContent = label || '已完成 ✓';
}

function hideThinking() {
  els.thinking.hidden = true;
}

// ---------- 流式打字感 ----------
function ensureReveal() {
  if (state.revealTimer) return;
  state.revealTimer = setInterval(() => {
    if (state.shownLen < state.assistantText.length) {
      const gap = state.assistantText.length - state.shownLen;
      state.shownLen = Math.min(state.assistantText.length, state.shownLen + Math.max(4, Math.floor(gap / 10)));
      paintReply();
    } else {
      clearInterval(state.revealTimer);
      state.revealTimer = null;
    }
  }, 30);
}

function paintReply() {
  els.replyText.textContent = state.assistantText.slice(0, state.shownLen);
  els.replyBox.scrollTop = els.replyBox.scrollHeight;
}

// ---------- 轮询 ----------
function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollOnce, 600);
  pollOnce();
}

function stopPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  state.sending = false;
  setBusy(false);
  resizeToFit();
}

async function pollOnce() {
  if (!state.sessionId) return;
  let r;
  try {
    r = await api('GET', `/session/${state.sessionId}/message`);
  } catch {
    return; // 网络抖动，下个周期再试
  }
  if (!r.ok) return;

  const msgs = (r.json && r.json.data) || [];
  let asst = null;
  for (const m of msgs) {
    if (m.type === 'assistant' && normTs(m.time && m.time.created) >= state.sentAtMs) {
      if (!asst || normTs(m.time.created) > normTs(asst.time && asst.time.created)) asst = m;
    }
  }

  if (!asst) {
    if (Date.now() - state.sentAtMs > 120000) {
      stopPolling();
      showError('等待回复超时，可重试', true);
    }
    return;
  }

  if (asst.retry && asst.retry.error) {
    stopPolling();
    showError(asst.retry.error.message || '模型返回错误（可能限流），建议切换模型', true, { switchModel: true });
    return;
  }

  const text = assistantTextOf(asst);
  if (!text) {
    if (hasToolParts(asst)) {
      showWaiting('正在处理…');
    } else {
      // 既没文本也没工具调用，连续多个周期仍如此 → 视为空回复
      state.emptyCount = (state.emptyCount || 0) + 1;
      if (state.emptyCount >= 4) {
        stopPolling();
        showDone('模型无回复');
      }
    }
    return;
  }
  hideThinking();

  if (text !== state.assistantText) {
    state.assistantText = text;
    state.stableCount = 0;
  } else {
    state.stableCount++;
  }
  ensureReveal();

  // 文本长度连续 2 个轮询周期不变且已全部展示 → 完成
  if (state.stableCount >= 2 && state.shownLen >= text.length) {
    showDone();
    stopPolling();
  }
}

// ---------- 会话管理 ----------
async function createSession(model) {
  const r = await api('POST', '/session', { title: '悬浮窗', model });
  const id = r.ok && r.json && r.json.data && r.json.data.id;
  if (!id) {
    const detail = r.json ? JSON.stringify(r.json).slice(0, 120) : r.error || `HTTP ${r.status}`;
    showError('创建会话失败：' + detail, true);
    return false;
  }
  state.sessionId = id;
  window.opencodeFloat.patchConfig({ sessionId: id, model });
  return true;
}

async function ensureSession(savedId) {
  if (savedId) {
    const v = await api('GET', `/session/${savedId}`);
    if (v.ok) {
      state.sessionId = savedId;
      return true;
    }
  }
  return createSession(state.model);
}

// ---------- 发送 ----------
async function send() {
  if (state.sending) return;
  const text = els.input.value.trim();
  if (!text && !state.images.length) return;

  // 空会话 GC 防御：发送前校验，404 则重建
  if (state.sessionId) {
    const v = await api('GET', `/session/${state.sessionId}`);
    if (!v.ok) state.sessionId = null;
  }
  if (!state.sessionId) {
    const ok = await createSession(state.model);
    if (!ok) return;
  }

  const files = state.images.map((i) => ({ uri: i.uri, name: i.name }));
  state.lastPayload = { text: text || '[图片]', files };

  const r = await api('POST', `/session/${state.sessionId}/prompt`, {
    text: state.lastPayload.text,
    ...(files.length ? { files } : {}),
  });
  if (!r.ok) {
    const msg =
      r.status === 0
        ? 'OpenCode 后台未运行或网络异常'
        : `发送失败（HTTP ${r.status}）${r.json && r.json.error ? '：' + JSON.stringify(r.json.error).slice(0, 80) : ''}`;
    showError(msg, true);
    return;
  }

  // 发送成功后清理已暂存的临时图片
  for (const img of state.images) window.opencodeFloat.removeFile(img.path);
  state.images = [];
  renderThumbs();
  els.input.value = '';
  autoGrow();

  state.sentAtMs = Date.now() - 3000; // 容忍与服务端少量时钟差
  state.assistantText = '';
  state.shownLen = 0;
  state.stableCount = 0;
  state.emptyCount = 0;
  state.sending = true;
  setBusy(true);
  showWaiting('思考中');
  startPolling();
}

async function retry() {
  hideError();
  if (state.lastPayload) {
    const { text, files } = state.lastPayload;
    state.sentAtMs = Date.now() - 3000;
    state.assistantText = '';
    state.shownLen = 0;
    state.stableCount = 0;
    state.emptyCount = 0;
    state.sending = true;
    setBusy(true);
    showWaiting('思考中');
    const r = await api('POST', `/session/${state.sessionId}/prompt`, {
      text,
      ...(files && files.length ? { files } : {}),
    });
    if (!r.ok) {
      showError(r.status === 0 ? 'OpenCode 后台未运行或网络异常' : `发送失败（HTTP ${r.status}）`, true);
      return;
    }
    startPolling();
  } else {
    els.input.focus();
  }
}

// ---------- 图片 ----------
async function addImageFromFile(file) {
  if (!file) return;
  let info = null;
  if (file.path) {
    info = await window.opencodeFloat.stageImage(file.path);
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    info = await window.opencodeFloat.saveImage(bytes, file.type || '');
  }
  if (info) {
    state.images.push(info);
    renderThumbs();
    resizeToFit();
  }
}

function renderThumbs() {
  els.thumbs.innerHTML = '';
  els.thumbs.hidden = state.images.length === 0;
  for (const [i, img] of state.images.entries()) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const im = document.createElement('img');
    im.src = img.uri;
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.title = '移除';
    rm.addEventListener('click', async () => {
      await window.opencodeFloat.removeFile(img.path);
      state.images.splice(i, 1);
      renderThumbs();
      resizeToFit();
    });
    wrap.append(im, rm);
    els.thumbs.appendChild(wrap);
  }
}

// ---------- 模型 ----------
function populateModels(saved) {
  const byProvider = new Map();
  for (const m of state.models) {
    const pid = m.providerID || 'unknown';
    if (!byProvider.has(pid)) byProvider.set(pid, []);
    byProvider.get(pid).push(m);
  }
  els.modelSelect.innerHTML = '';
  const sorted = [...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [pid, models] of sorted) {
    const og = document.createElement('optgroup');
    og.label = pid;
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = `${pid}|${m.id}`;
      const vision = m.capabilities && m.capabilities.vision ? ' 👁' : '';
      opt.textContent = `${m.id}${vision}`;
      og.appendChild(opt);
    }
    els.modelSelect.appendChild(og);
  }

  const wanted = saved ? `${saved.providerID}|${saved.id}` : null;
  let matched = wanted && [...els.modelSelect.options].find((o) => o.value === wanted);
  if (!matched) {
    // 兜底：优先有视觉能力的模型
    const visionOpt = [...els.modelSelect.options].find((o) => o.textContent.includes('👁'));
    matched = visionOpt || els.modelSelect.options[0];
  }
  if (matched) {
    matched.selected = true;
    const [p, id] = matched.value.split('|');
    state.model = { providerID: p, id };
  }
  els.modelSelect.disabled = false;
}

// ---------- 折叠 / 置顶 ----------
function applyCollapse(collapsed) {
  state.collapsed = collapsed;
  els.replyArea.hidden = collapsed;
  els.collapseBtn.textContent = collapsed ? '＋' : '—';
  window.opencodeFloat.patchConfig({ window: { collapsed } });
  resizeToFit();
}

function updatePin() {
  els.pinBtn.style.opacity = state.alwaysOnTop ? '1' : '0.35';
  els.pinBtn.title = state.alwaysOnTop ? '取消置顶' : '始终置顶';
}

// ---------- 输入框 ----------
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 92) + 'px';
  resizeToFit();
}

// ---------- 初始化 ----------
async function init() {
  const cfg = await window.opencodeFloat.getConfig();
  state.alwaysOnTop = cfg.alwaysOnTop !== false;
  updatePin();
  if (cfg.window && cfg.window.collapsed) {
    state.collapsed = true;
    els.replyArea.hidden = true;
    els.collapseBtn.textContent = '＋';
  }

  const r = await api('GET', '/model');
  state.models = (r.ok && r.json && r.json.data) || [];
  if (!state.models.length) {
    showError('无法连接 OpenCode 后台（127.0.0.1:8080），请确认服务已启动。', true);
    els.retryBtn.hidden = false;
    els.retryBtn.onclick = () => location.reload();
    els.switchModelBtn.hidden = true;
    return;
  }
  populateModels(cfg.model);
  hideError();
  await ensureSession(cfg.sessionId);
}

// ---------- 事件绑定 ----------
els.sendBtn.addEventListener('click', send);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('paste', (e) => {
  for (const item of e.clipboardData.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) {
        e.preventDefault();
        addImageFromFile(f);
      }
    }
  }
});
els.app.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.app.classList.add('dropping');
});
els.app.addEventListener('dragleave', () => els.app.classList.remove('dropping'));
els.app.addEventListener('drop', (e) => {
  e.preventDefault();
  els.app.classList.remove('dropping');
  for (const f of e.dataTransfer.files) {
    if (f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(f.name)) addImageFromFile(f);
  }
});
els.attachBtn.addEventListener('click', async () => {
  const p = await window.opencodeFloat.pickImage();
  if (p) addImageFromFile({ path: p });
});
els.modelSelect.addEventListener('change', async () => {
  const [p, id] = els.modelSelect.value.split('|');
  const model = { providerID: p, id };
  state.model = model;
  window.opencodeFloat.patchConfig({ model });
  await createSession(model); // 切模型 = 新会话
});
els.collapseBtn.addEventListener('click', () => applyCollapse(!state.collapsed));
els.pinBtn.addEventListener('click', () => {
  state.alwaysOnTop = !state.alwaysOnTop;
  window.opencodeFloat.setAlwaysOnTop(state.alwaysOnTop);
  window.opencodeFloat.patchConfig({ alwaysOnTop: state.alwaysOnTop });
  updatePin();
});
els.closeBtn.addEventListener('click', () => window.opencodeFloat.quit());
els.retryBtn.addEventListener('click', retry);
els.switchModelBtn.addEventListener('click', () => {
  els.modelSelect.focus();
  els.modelSelect.title = '请在此切换模型';
});

init();
