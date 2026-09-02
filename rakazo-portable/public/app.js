const $ = (sel) => document.querySelector(sel);
const state = { conversationId: null, streaming: false, config: {} };

// ---------- rendu markdown minimal (échappé) ----------
const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function renderMarkdown(src) {
  const blocks = [];
  let text = escapeHtml(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push('<pre><code data-lang="' + lang + '">' + code.replace(/\n$/, '') + '</code></pre>');
    return '' + (blocks.length - 1) + '';
  });

  text = text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const html = text
    .split(/\n{2,}/)
    .map((chunk) => {
      const lines = chunk.split('\n');
      if (/^\d+$/.test(chunk.trim())) return chunk;
      if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
        return '<ul>' + lines.map((l) => '<li>' + l.replace(/^\s*[-*]\s+/, '') + '</li>').join('') + '</ul>';
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
        return '<ol>' + lines.map((l) => '<li>' + l.replace(/^\s*\d+[.)]\s+/, '') + '</li>').join('') + '</ol>';
      const heading = chunk.match(/^(#{1,4})\s+(.*)$/);
      if (heading) return '<h' + (heading[1].length + 2) + '>' + heading[2] + '</h' + (heading[1].length + 2) + '>';
      return '<p>' + lines.join('<br>') + '</p>';
    })
    .join('');

  return html.replace(/(\d+)/g, (_, i) => blocks[i]);
}

// ---------- messages ----------
const messagesEl = $('#messages');

function clearMessages() {
  messagesEl.innerHTML = '';
}

function addMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  wrap.innerHTML =
    '<div class="who">' + (role === 'user' ? '🧑' : '🤖') + '</div><div class="bubble"></div>';
  const bubble = wrap.querySelector('.bubble');
  bubble.innerHTML = role === 'user' ? escapeHtml(content).replace(/\n/g, '<br>') : renderMarkdown(content);
  messagesEl.append(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function addToolNote(bubble, name, args) {
  const note = document.createElement('div');
  note.className = 'tool-note';
  const label = name === 'save_memory' ? 'Mémorisé' : 'Oublié';
  note.textContent = '🧠 ' + label + ' : ' + (args.content || args.id || '');
  bubble.append(note);
}

// ---------- état serveur ----------
async function loadState() {
  const s = await fetch('/api/state').then((r) => r.json());
  state.config = s;
  $('#model-badge').textContent = s.model;
  renderConversations(s.conversations);
  renderMemories(s.memories);
  if (!s.hasKey) openSettings();
}

function renderConversations(list) {
  const ul = $('#convo-list');
  ul.innerHTML = '';
  for (const c of list) {
    const li = document.createElement('li');
    li.className = 'convo' + (c.id === state.conversationId ? ' active' : '');
    li.innerHTML = '<span class="title"></span><button class="kill" title="Supprimer">✕</button>';
    li.querySelector('.title').textContent = c.title || 'Sans titre';
    li.onclick = () => openConversation(c.id);
    li.querySelector('.kill').onclick = async (e) => {
      e.stopPropagation();
      await fetch('/api/conversations/' + c.id, { method: 'DELETE' });
      if (state.conversationId === c.id) newConversation();
      loadState();
    };
    ul.append(li);
  }
}

function renderMemories(list) {
  const ul = $('#memory-list');
  ul.innerHTML = '';
  for (const m of list) {
    const li = document.createElement('li');
    li.className = 'memory';
    li.innerHTML = '<span></span><button class="kill" title="Oublier">✕</button>';
    li.querySelector('span').textContent = m.content;
    li.querySelector('.kill').onclick = async () => {
      await fetch('/api/memories/' + m.id, { method: 'DELETE' });
      loadState();
    };
    ul.append(li);
  }
  if (!list.length) ul.innerHTML = '<p class="hint">Aucun souvenir pour l\'instant.</p>';
}

async function openConversation(id) {
  const convo = await fetch('/api/conversations/' + id).then((r) => (r.ok ? r.json() : null));
  if (!convo) return;
  state.conversationId = id;
  clearMessages();
  for (const m of convo.messages) {
    if (m.role === 'user') addMessage('user', m.content);
    else if (m.role === 'assistant') {
      const bubble = addMessage('assistant', m.content || '');
      for (const call of m.tool_calls || []) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {}
        addToolNote(bubble, call.function.name, args);
      }
    }
  }
  renderConversations(state.config.conversations || []);
}

function newConversation() {
  state.conversationId = null;
  clearMessages();
  messagesEl.innerHTML =
    '<div class="empty"><h1>Rakazo Portable</h1><p>Nouvelle conversation — la mémoire, elle, est conservée.</p></div>';
  document.querySelectorAll('.convo.active').forEach((el) => el.classList.remove('active'));
}

// ---------- envoi + streaming ----------
async function send(text) {
  if (state.streaming) return;
  if (messagesEl.querySelector('.empty')) clearMessages();
  addMessage('user', text);
  const bubble = addMessage('assistant', '');
  bubble.classList.add('cursor');
  state.streaming = true;
  $('#send').disabled = true;

  let answer = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: state.conversationId, content: text }),
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur serveur');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop();
      for (const frame of frames) {
        const event = /^event: (.*)$/m.exec(frame)?.[1];
        const dataLine = /^data: ([\s\S]*)$/m.exec(frame)?.[1];
        if (!event || dataLine === undefined) continue;
        const data = JSON.parse(dataLine);
        if (event === 'start') state.conversationId = data.conversationId;
        else if (event === 'delta') {
          answer += data;
          bubble.innerHTML = renderMarkdown(answer);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else if (event === 'tool') addToolNote(bubble, data.name, data.args);
        else if (event === 'error') {
          const box = document.createElement('div');
          box.className = 'error';
          box.textContent = data;
          bubble.append(box);
        } else if (event === 'done') renderMemories(data.memories);
      }
    }
  } catch (err) {
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = String(err.message || err);
    bubble.append(box);
  } finally {
    bubble.classList.remove('cursor');
    state.streaming = false;
    $('#send').disabled = false;
    const s = await fetch('/api/state').then((r) => r.json());
    state.config = s;
    renderConversations(s.conversations);
  }
}

// ---------- réglages ----------
async function openSettings() {
  const s = state.config;
  $('#api-key').value = '';
  $('#api-key').placeholder = s.hasKey ? '•••••••• (clé enregistrée)' : 'sk-or-v1-…';
  $('#model').value = s.model || '';
  $('#system-prompt').value = s.systemPrompt || '';
  $('#temperature').value = s.temperature ?? 1;
  $('#temp-value').textContent = $('#temperature').value;
  $('#settings').showModal();

  const models = await fetch('/api/models')
    .then((r) => r.json())
    .catch(() => []);
  $('#model-list').innerHTML = models
    .map((m) => '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.name || '') + '</option>')
    .join('');
}

$('#settings-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  const patch = {
    model: $('#model').value.trim() || 'anthropic/claude-sonnet-4.5',
    systemPrompt: $('#system-prompt').value,
    temperature: Number($('#temperature').value),
  };
  const key = $('#api-key').value.trim();
  if (key) patch.apiKey = key;
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  loadState();
});

$('#temperature').addEventListener('input', (e) => ($('#temp-value').textContent = e.target.value));
$('#open-settings').onclick = openSettings;
$('#new-chat').onclick = newConversation;

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('#panel-convos').classList.toggle('hidden', tab.dataset.panel !== 'convos');
    $('#panel-memories').classList.toggle('hidden', tab.dataset.panel !== 'memories');
  };
});

$('#memory-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = $('#memory-input').value.trim();
  if (!content) return;
  $('#memory-input').value = '';
  await fetch('/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  loadState();
});

const input = $('#input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  send(text);
});

loadState();
