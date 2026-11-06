// DevTools 入口：创建面板 + 抓取 /api/log-explorer/search 响应并解析 data.result.rows

const state = {
  ports: new Set(),
  logs: [],
  // 用于去重：同一个请求（url + startedDateTime）只处理一次
  seen: new Set()
};

// 新接口 rows 的默认列顺序（与旧日志对象字段对应）
// 接口若返回 columns/fields，则按列名映射，不依赖这个顺序
const DEFAULT_ROW_COLUMNS = [
  'pod',
  'logger',
  'userId',
  'cluster',
  'app',
  'level',
  'profile',
  'ip',
  'thread',
  'traceId',
  'msg',
  'token',
  '_time_nanosecond_',
  '_time_second_',
  'rpcId'
];

const COLUMN_ALIASES = {
  pod: 'pod',
  logger: 'logger',
  userid: 'userId',
  user_id: 'userId',
  cluster: 'cluster',
  app: 'app',
  level: 'level',
  profile: 'profile',
  ip: 'ip',
  thread: 'thread',
  traceid: 'traceId',
  trace_id: 'traceId',
  msg: 'msg',
  message: 'msg',
  content: 'msg',
  token: 'token',
  _time_nanosecond_: '_time_nanosecond_',
  _time_second_: '_time_second_',
  time: 'time',
  timestamp: 'timestamp',
  rpcid: 'rpcId',
  rpc_id: 'rpcId'
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

function normalizeColumnName(name) {
  const key = String(name || '').trim();
  if (!key) return '';
  return COLUMN_ALIASES[key] || COLUMN_ALIASES[key.toLowerCase()] || key;
}

function rowToLog(row, columns) {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    if (row.msg == null && row.message == null && row.content == null) return null;
    const msg = row.msg != null ? row.msg : (row.message != null ? row.message : row.content);
    const time = row._time_second_ || row._time_nanosecond_ || row.time || row.timestamp || null;
    return { ...row, msg: msg == null ? '' : String(msg), time, timestamp: time };
  }
  if (!Array.isArray(row)) return null;

  const names = (Array.isArray(columns) && columns.length)
    ? columns.map(normalizeColumnName)
    : DEFAULT_ROW_COLUMNS;
  const log = {};
  for (let i = 0; i < row.length; i++) {
    const name = names[i] || `col${i}`;
    log[name] = row[i];
  }
  if (log.msg == null) log.msg = '';
  else log.msg = String(log.msg);
  const time = log._time_second_ || log._time_nanosecond_ || log.time || log.timestamp || null;
  log.time = time;
  log.timestamp = time;
  return log;
}

function extractLogsFromResponseText(text) {
  const json = safeJsonParse(text);
  if (!json || typeof json !== 'object') return { logs: null, error: '响应不是 JSON' };

  const data = json.data;
  if (!data || typeof data !== 'object') return { logs: null, error: '缺少 data' };

  // 旧接口：{ data: { logs: [] } }
  if (Array.isArray(data.logs)) return { logs: data.logs, error: null };

  const result = data.result;
  const rows = result && result.rows;
  if (!Array.isArray(rows)) return { logs: null, error: 'data.result.rows 不是数组' };

  const columns = (result && (result.columns || result.fields || result.headers)) || null;
  const logs = rows.map((row) => rowToLog(row, columns)).filter(Boolean);
  return { logs, error: null };
}

function isLogsRequest(url) {
  if (!url) return false;
  // 新日志查询接口；仍兼容旧的 /logs?
  return url.includes('/api/log-explorer/search') || url.includes('/logs?');
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

      // 每次新的日志查询都覆盖旧缓存，只保留最新一批日志
      state.logs = Array.isArray(logs) ? logs : [];
      broadcast('state', { total: state.logs.length });
      broadcast('logs_batch', { logs: state.logs });
    });
  } catch (e) {
    broadcast('ingest_error', { url: null, error: String(e && e.message ? e.message : e) });
  }
});

