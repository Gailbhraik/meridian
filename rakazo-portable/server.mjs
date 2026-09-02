// Rakazo Portable — serveur local zéro-dépendance.
// Sert l'interface, relaie le streaming OpenRouter, stocke tout dans ./data.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const CONVOS = join(DATA, 'conversations');
const CONFIG_FILE = join(DATA, 'config.json');
const MEMORY_FILE = join(DATA, 'memories.json');

const DEFAULTS = {
  apiKey: '',
  model: 'anthropic/claude-sonnet-4.5',
  systemPrompt:
    "Tu es Rakazo, un assistant personnel qui tourne en local sur le PC de l'utilisateur. " +
    'Réponds en français, de façon directe et concrète. ' +
    "Tu disposes d'une mémoire persistante : utilise save_memory pour retenir un fait durable sur l'utilisateur " +
    '(préférences, projets, contexte réutilisable), et forget_memory pour supprimer un souvenir devenu faux. ' +
    "N'enregistre jamais un détail éphémère propre à la conversation en cours.",
  temperature: 1,
};

// ---------- stockage ----------
async function ensureDirs() {
  await mkdir(CONVOS, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2), 'utf8');

const getConfig = async () => ({ ...DEFAULTS, ...(await readJson(CONFIG_FILE, {})) });
const getMemories = () => readJson(MEMORY_FILE, []);
const convoPath = (id) => join(CONVOS, id + '.json');

async function listConversations() {
  const files = (await readdir(CONVOS).catch(() => [])).filter((f) => f.endsWith('.json'));
  const rows = await Promise.all(
    files.map(async (f) => {
      const c = await readJson(join(CONVOS, f), null);
      return c && { id: c.id, title: c.title, updatedAt: c.updatedAt };
    }),
  );
  return rows.filter(Boolean).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

async function loadConversation(id) {
  if (!/^[\w-]+$/.test(id || '')) return null;
  return readJson(convoPath(id), null);
}

// ---------- outils mémoire ----------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        "Mémoriser durablement un fait sur l'utilisateur ou ses projets, réutilisable dans les futures conversations.",
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Le fait à retenir, en une ou deux phrases autonomes.' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_memory',
      description: 'Supprimer un souvenir devenu faux ou obsolète, à partir de son identifiant.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: "L'id du souvenir à supprimer." } },
        required: ['id'],
      },
    },
  },
];

async function runTool(name, args) {
  const memories = await getMemories();
  if (name === 'save_memory') {
    const content = String(args?.content || '').trim();
    if (!content) return { ok: false, error: 'contenu vide' };
    const entry = { id: randomUUID().slice(0, 8), content, createdAt: new Date().toISOString() };
    memories.push(entry);
    await writeJson(MEMORY_FILE, memories);
    return { ok: true, memory: entry };
  }
  if (name === 'forget_memory') {
    const next = memories.filter((m) => m.id !== args?.id);
    if (next.length === memories.length) return { ok: false, error: 'souvenir introuvable' };
    await writeJson(MEMORY_FILE, next);
    return { ok: true, removed: args.id };
  }
  return { ok: false, error: 'outil inconnu: ' + name };
}

// ---------- boucle agent ----------
// Surchargeable pour pointer un endpoint compatible OpenRouter (ou un mock de test).
const API_BASE = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

async function callOpenRouter(config, messages) {
  const res = await fetch(API_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Rakazo Portable',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools: TOOLS,
      stream: true,
      temperature: config.temperature,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error('OpenRouter ' + res.status + ' — ' + (detail.slice(0, 400) || 'réponse vide'));
  }
  return res.body;
}

// Lit un flux SSE OpenRouter et agrège texte + appels d'outils.
async function consumeStream(body, onDelta) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const toolCalls = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        onDelta(delta.content);
      }
      for (const call of delta.tool_calls || []) {
        const slot = (toolCalls[call.index] ||= { id: '', name: '', args: '' });
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
      }
    }
  }
  return { text, toolCalls: toolCalls.filter(Boolean) };
}

async function buildSystemMessage(config) {
  const memories = await getMemories();
  if (!memories.length) return config.systemPrompt;
  const lines = memories.map((m) => '- [' + m.id + '] ' + m.content).join('\n');
  return config.systemPrompt + '\n\n## Mémoire persistante\nCe que tu sais déjà :\n' + lines;
}

// ---------- HTTP ----------
const sendJson = (res, code, value) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveStatic(url, res) {
  const rel = url === '/' ? 'index.html' : decodeURIComponent(url.slice(1));
  const file = join(PUBLIC, normalize(rel).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(await readFile(file));
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 5e6) reject(new Error('corps trop volumineux'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

let modelCache = { at: 0, list: [] };

async function handleChat(req, res) {
  const { conversationId, content } = await readBody(req);
  const config = await getConfig();
  if (!config.apiKey) return sendJson(res, 400, { error: "Aucune clé OpenRouter n'est configurée." });
  const message = String(content || '').trim();
  if (!message) return sendJson(res, 400, { error: 'Message vide.' });

  let convo = await loadConversation(conversationId);
  if (!convo) {
    convo = {
      id: randomUUID(),
      title: message.slice(0, 60),
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }
  convo.messages.push({ role: 'user', content: message, at: new Date().toISOString() });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
  emit('start', { conversationId: convo.id, title: convo.title });

  try {
    // Jusqu'à 5 tours pour laisser la place aux appels d'outils mémoire.
    for (let turn = 0; turn < 5; turn++) {
      const history = [
        { role: 'system', content: await buildSystemMessage(config) },
        ...convo.messages.map(({ role, content, tool_calls, tool_call_id, name }) => {
          const m = { role, content: content ?? '' };
          if (tool_calls) m.tool_calls = tool_calls;
          if (tool_call_id) m.tool_call_id = tool_call_id;
          if (name) m.name = name;
          return m;
        }),
      ];
      const body = await callOpenRouter(config, history);
      const { text, toolCalls } = await consumeStream(body, (d) => emit('delta', d));

      const assistant = { role: 'assistant', content: text, at: new Date().toISOString() };
      if (toolCalls.length) {
        assistant.tool_calls = toolCalls.map((c) => ({
          id: c.id || randomUUID().slice(0, 8),
          type: 'function',
          function: { name: c.name, arguments: c.args || '{}' },
        }));
      }
      convo.messages.push(assistant);

      if (!toolCalls.length) break;

      for (const call of assistant.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {}
        const result = await runTool(call.function.name, args);
        emit('tool', { name: call.function.name, args, result });
        convo.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
          at: new Date().toISOString(),
        });
      }
      emit('delta', '\n\n');
    }
    convo.updatedAt = new Date().toISOString();
    await writeJson(convoPath(convo.id), convo);
    emit('done', { conversationId: convo.id, memories: await getMemories() });
  } catch (err) {
    convo.updatedAt = new Date().toISOString();
    await writeJson(convoPath(convo.id), convo).catch(() => {});
    emit('error', String(err.message || err));
  }
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;

    if (req.method === 'GET' && !path.startsWith('/api/')) return serveStatic(path, res);

    if (path === '/api/state' && req.method === 'GET') {
      const { apiKey, ...rest } = await getConfig();
      return sendJson(res, 200, {
        ...rest,
        hasKey: Boolean(apiKey),
        conversations: await listConversations(),
        memories: await getMemories(),
      });
    }

    if (path === '/api/config' && req.method === 'POST') {
      const patch = await readBody(req);
      const config = await getConfig();
      for (const key of ['apiKey', 'model', 'systemPrompt', 'temperature']) {
        if (patch[key] !== undefined && patch[key] !== null) config[key] = patch[key];
      }
      await writeJson(CONFIG_FILE, config);
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/api/models' && req.method === 'GET') {
      if (Date.now() - modelCache.at > 6e5) {
        const r = await fetch(API_BASE + '/models');
        const j = await r.json();
        modelCache = {
          at: Date.now(),
          list: (j.data || [])
            .map((m) => ({ id: m.id, name: m.name, ctx: m.context_length, pricing: m.pricing?.prompt }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        };
      }
      return sendJson(res, 200, modelCache.list);
    }

    if (path.startsWith('/api/conversations/')) {
      const id = path.split('/')[3];
      if (req.method === 'GET') {
        const convo = await loadConversation(id);
        return convo ? sendJson(res, 200, convo) : sendJson(res, 404, { error: 'introuvable' });
      }
      if (req.method === 'DELETE') {
        await unlink(convoPath(id)).catch(() => {});
        return sendJson(res, 200, { ok: true });
      }
    }

    if (path === '/api/memories' && req.method === 'GET') return sendJson(res, 200, await getMemories());

    if (path === '/api/memories' && req.method === 'POST') {
      const { content } = await readBody(req);
      const result = await runTool('save_memory', { content });
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (path.startsWith('/api/memories/') && req.method === 'DELETE') {
      const id = path.split('/')[3];
      const kept = (await getMemories()).filter((m) => m.id !== id);
      await writeJson(MEMORY_FILE, kept);
      return sendJson(res, 200, { ok: true });
    }

    if (path === '/api/chat' && req.method === 'POST') return handleChat(req, res);

    sendJson(res, 404, { error: 'route inconnue' });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});

// Prend le premier port libre à partir de 7788, puis ouvre le navigateur.
async function start(port, attempts) {
  await ensureDirs();
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts > 0) return start(port + 1, attempts - 1);
    console.error('Impossible de démarrer :', err.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://localhost:' + port;
    console.log('\n  Rakazo Portable est lancé sur ' + url);
    console.log('  Ferme cette fenêtre pour arrêter le bot.\n');
    if (process.env.NO_OPEN) return;
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}

start(Number(process.env.PORT) || 7788, 12);
