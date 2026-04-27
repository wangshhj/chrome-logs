// DevTools 入口：创建面板 + 抓取 /logs? 响应并解析 data.logs

const state = {
  ports: new Set(),
  logs: [],
  // 用于去重：同一个请求（url + startedDateTime）只处理一次
  seen: new Set()
};

function broadcast(type, payload) {
  for (const port of state.ports) {
    try {
      port.postMessage({ type, payload });
    } catch (e) {
      // ignore
    }
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function extractLogsFromResponseText(text) {
  const json = safeJsonParse(text);
  if (!json || typeof json !== 'object') return { logs: null, error: '响应不是 JSON' };

  const data = json.data;
  if (!data || typeof data !== 'object') return { logs: null, error: '缺少 data' };

  const logs = data.logs;
  if (!Array.isArray(logs)) return { logs: null, error: 'data.logs 不是数组' };

  return { logs, error: null };
}

function isLogsRequest(url) {
  if (!url) return false;
  // 仅抓 /logs?（包含 query 的 logs 接口）
  // 兼容完整域名、路径前缀等场景
  return url.includes('/logs?');
}

chrome.devtools.panels.create('Logs Analyzer', '', 'panel.html');

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'logs-analyzer') return;
  state.ports.add(port);

  port.onDisconnect.addListener(() => {
    state.ports.delete(port);
  });

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'get_state') {
      port.postMessage({
        type: 'state',
        payload: { total: state.logs.length }
      });
      port.postMessage({
        type: 'logs_batch',
        payload: { logs: state.logs }
      });
      return;
    }

    if (msg.type === 'clear') {
      state.logs = [];
      state.seen.clear();
      broadcast('cleared', {});
      broadcast('state', { total: 0 });
      return;
    }
  });
});

chrome.devtools.network.onRequestFinished.addListener((request) => {
  try {
    const url = request && request.request && request.request.url;
    if (!isLogsRequest(url)) return;

    const key = `${url}@@${request.startedDateTime || ''}`;
    if (state.seen.has(key)) return;
    state.seen.add(key);

    request.getContent((content) => {
      const { logs, error } = extractLogsFromResponseText(content || '');
      if (error) {
        broadcast('ingest_error', { url, error });
        return;
      }

      // 追加并广播
      state.logs.push(...logs);
      broadcast('state', { total: state.logs.length });
      broadcast('logs_batch', { logs });
    });
  } catch (e) {
    broadcast('ingest_error', { url: null, error: String(e && e.message ? e.message : e) });
  }
});

