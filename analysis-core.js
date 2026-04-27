// 纯前端日志分析核心：只依赖 logs 数组（来自 /logs? 响应中的 data.logs）

function getUriFromLog(log) {
  if (!log) return null;
  if (typeof log.uri === 'string' && log.uri) return log.uri;
  if (typeof log.url === 'string' && log.url) return log.url;
  if (!log.msg) return null;
  const m = String(log.msg).match(/uri:([^,]+)/);
  return m ? m[1].trim() : null;
}

function parseLogTime(log) {
  if (!log) return null;
  const raw = log._time_second_ || log._time_nanosecond_ || log.time || log.timestamp;
  if (!raw) return null;
  const str = typeof raw === 'string' ? raw : String(raw);
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function getApiTypeFromUri(uri) {
  if (!uri) return 'unknown';
  const parts = String(uri).split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

function analyzeLogs(logData) {
  if (!logData || !Array.isArray(logData)) {
    return {
      total: 0,
      byUri: {},
      uriList: [],
      byApiType: {},
      apiTypeList: [],
      timeRange: { min: null, max: null, minStr: null, maxStr: null }
    };
  }

  const byUri = {};
  const byApiType = {};
  let timeMin = null;
  let timeMax = null;

  for (const log of logData) {
    const uri = getUriFromLog(log);
    if (uri) {
      byUri[uri] = (byUri[uri] || 0) + 1;
      const apiType = getApiTypeFromUri(uri);
      byApiType[apiType] = (byApiType[apiType] || 0) + 1;
    }

    const t = parseLogTime(log);
    if (t != null) {
      if (timeMin == null || t < timeMin) timeMin = t;
      if (timeMax == null || t > timeMax) timeMax = t;
    }
  }

  const uriList = Object.entries(byUri)
    .sort((a, b) => b[1] - a[1])
    .map(([uri, count]) => ({ uri, count }));

  const apiTypeList = Object.entries(byApiType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));

  return {
    total: logData.length,
    byUri,
    uriList,
    byApiType,
    apiTypeList,
    timeRange: {
      min: timeMin,
      max: timeMax,
      minStr: timeMin != null ? new Date(timeMin).toLocaleString('zh-CN') : null,
      maxStr: timeMax != null ? new Date(timeMax).toLocaleString('zh-CN') : null
    }
  };
}

