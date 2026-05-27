// 从项目的 log.js 迁移而来：用于在插件面板内对 logs[] 做检索与解析
// 数据源：/logs? 响应中的 { data: { logs: [] } }

// 支持“解析出分析结果”的接口类型（面板的“筛选计算接口”会用到）
const SUPPORTED_APIS = ['/batchCalculate', '/TriggerEvent', '/action/Edit', '/action/Add', '/edit', '/Add', 'price_policy/service/match'];

function getApiDescFromText(text) {
  if (!text) return '无';
  const txt = String(text);
  const rules = (typeof API_DESC_RULES !== 'undefined' && Array.isArray(API_DESC_RULES)) ? API_DESC_RULES : [];
  for (const rule of rules) {
    if (!rule || !rule.key) continue;
    if (txt.includes(rule.key)) return rule.desc || '无';
  }
  return '无';
}

function resolveApiDesc(log, uriOrUrl) {
  const d1 = getApiDescFromText(uriOrUrl);
  if (d1 !== '无') return d1;
  const msg = log && log.msg;
  const d2 = getApiDescFromText(msg);
  if (d2 !== '无') return d2;
  return '无';
}

function attachApiDesc(results) {
  return (results || []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    if (item.apiDesc) return item;
    return {
      ...item,
      apiDesc: resolveApiDesc(item.log, item.url)
    };
  });
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 当日志没有 uri/url 时，从 msg 文本中尝试提取字段值
// 兼容：
//  - field=value
//  - field: value
//  - field = "value"
function extractFieldValueFromMsg(msg, fieldName) {
  if (!msg || !fieldName) return null;
  const text = String(msg);
  const f = escapeRegExp(fieldName);
  // value 截断规则：遇到逗号/分号/空白/右括号 结束；支持引号包裹
  const re = new RegExp(`${f}\\s*[:=]\\s*(\"[^\"]*\"|'[^']*'|[^,;\\s\\)\\]]+)`);
  const m = text.match(re);
  if (!m) return null;
  const raw = m[1];
  if (raw == null) return null;
  const v = String(raw);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseLogEntry(log) {
  let body = null;
  let url = null;
  let uri = null;
  const time = (log && (log._time_second_ || log._time_nanosecond_ || log.time || log.timestamp)) || null;

  if (log && log.msg) {
    const uriMatch = String(log.msg).match(/uri:([^,]+)/);
    if (uriMatch) {
      uri = uriMatch[1];
      url = uriMatch[1];
    }

    const bodyMatch = String(log.msg).match(/body:(\{.*\})/s);
    if (bodyMatch && bodyMatch[1]) {
      try {
        body = JSON.parse(bodyMatch[1]);
      } catch (e) {
        // ignore
      }
    }
  }

  if (!body && log && log.body) {
    try {
      body = typeof log.body === 'string' ? JSON.parse(log.body) : log.body;
    } catch (e) {
      // ignore
    }
  }

  if (!uri && log && log.uri) {
    uri = log.uri;
    url = log.uri;
  }
  if (!url && log && log.url) {
    url = log.url;
  }

  return { body, url, uri, time };
}

function getUriFromLog(log) {
  if (!log || !log.msg) return null;
  const m = String(log.msg).match(/uri:([^,]+)/);
  return m ? m[1].trim() : null;
}

function parseLogEntryMeta(log) {
  const uriFromMsg = getUriFromLog(log);
  const uri = uriFromMsg || (log && (log.uri || log.url)) || null;
  return {
    url: uri || null,
    uri,
    time: (log && (log._time_second_ || log._time_nanosecond_ || log.time || log.timestamp)) || null
  };
}

function matchesApiType(uri, apiTypes) {
  if (!uri) return false;
  return apiTypes.some((type) => uri.includes(type));
}

function hasOwnField(obj, key) {
  return !!obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function findLogs(logData, fieldName, rowId, productId) {
  if (!logData || !Array.isArray(logData)) return [];

  const results = [];
  const hasRowIdFilter = rowId !== undefined && rowId !== null && String(rowId).trim() !== '';
  const normalizedRowId = hasRowIdFilter ? String(rowId).trim() : '';
  const hasProductIdFilter = productId !== undefined && productId !== null && String(productId).trim() !== '';
  const normalizedProductId = hasProductIdFilter ? String(productId).trim() : '';
  const noMatchFieldValue = (hasRowIdFilter || hasProductIdFilter) ? '数据不存在' : '无';
  const isRowMatched = (itemRowId, fallbackId) => {
    if (!hasRowIdFilter) return true;
    if (itemRowId !== undefined && itemRowId !== null && String(itemRowId) === normalizedRowId) return true;
    if (fallbackId !== undefined && fallbackId !== null && String(fallbackId) === normalizedRowId) return true;
    return false;
  };
  const isProductMatched = (item) => {
    if (!hasProductIdFilter) return true;
    if (!item || typeof item !== 'object') return false;
    const candidates = [
      item.product_id,
      item.productId,
      item.productID,
      item.product && item.product.product_id,
      item.product && item.product.id
    ].filter((v) => v !== undefined && v !== null);
    return candidates.some((v) => String(v) === normalizedProductId);
  };

  logData.forEach((log) => {
    const { url, uri, time } = parseLogEntryMeta(log);

    // 没有 url/uri 的日志：直接在 msg 中判断是否包含筛选字段，若有则返回字段值
    if (!uri) {
      const msg = log && log.msg;
      if (msg && String(msg).includes(fieldName)) {
        const extracted = extractFieldValueFromMsg(msg, fieldName);
        results.push({
          time,
          fieldName,
          fieldValue: extracted != null ? extracted : noMatchFieldValue,
          url: null,
          log
        });
      } else {
        results.push({ time, fieldName, fieldValue: noMatchFieldValue, url: null, log: null });
      }
      return;
    }

    // 非目标接口：只输出调用时间
    if (uri && !matchesApiType(uri, SUPPORTED_APIS)) {
      results.push({ time, fieldName, fieldValue: noMatchFieldValue, url, log: null });
      return;
    }

    const { body } = parseLogEntry(log);
    // 指定解析接口：即使没有 body/没命中 fieldName，也输出调用时间
    if (!body) {
      results.push({ time, fieldName, fieldValue: noMatchFieldValue, url, log: null });
      return;
    }

    const resultsBefore = results.length;

    if (uri && uri.includes('/batchCalculate')) {
      if (body.detailDataMap && typeof body.detailDataMap === 'object') {
        for (const objName in body.detailDataMap) {
          const idMap = body.detailDataMap[objName];
          if (!idMap || typeof idMap !== 'object') continue;
          for (const idKey in idMap) {
            const item = idMap[idKey];
            if (!item || typeof item !== 'object') continue;
            if (!isRowMatched(item.rowId, idKey)) continue;
            if (!isProductMatched(item)) continue;
            if (hasOwnField(item, fieldName)) {
              results.push({ time, fieldName, fieldValue: item[fieldName], url, log });
            }
          }
        }
      }
      if (body.masterData && hasOwnField(body.masterData, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.masterData))) {
          results.push({ time, fieldName, fieldValue: body.masterData[fieldName], url, log });
        }
      }
    } else if (uri && uri.includes('/TriggerEvent')) {
      if (body.detail_object_data && typeof body.detail_object_data === 'object') {
        for (const objName in body.detail_object_data) {
          const idMap = body.detail_object_data[objName];
          if (!idMap || typeof idMap !== 'object') continue;
          for (const idKey in idMap) {
            const item = idMap[idKey];
            if (!item || typeof item !== 'object') continue;
            if (!isRowMatched(item.rowId, idKey)) continue;
            if (!isProductMatched(item)) continue;
            if (hasOwnField(item, fieldName)) {
              results.push({ time, fieldName, fieldValue: item[fieldName], url, log });
            }
          }
        }
      }
      if (body.object_data && hasOwnField(body.object_data, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.object_data))) {
          results.push({ time, fieldName, fieldValue: body.object_data[fieldName], url, log });
        }
      }
    } else if (uri && uri.includes('price_policy/service/match')) {
      if (body.masterData && hasOwnField(body.masterData, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.masterData))) {
          results.push({ time, fieldName, fieldValue: body.masterData[fieldName], url, log });
        }
      }

      if (body.detailDataMap && typeof body.detailDataMap === 'object') {
        for (const k1 in body.detailDataMap) {
          const v1 = body.detailDataMap[k1];
          if (!v1 || typeof v1 !== 'object') continue;
          const looksLikeItem = (v1.rowId !== undefined) || hasOwnField(v1, fieldName);
          if (looksLikeItem) {
            if (!isRowMatched(v1.rowId, k1)) continue;
            if (!isProductMatched(v1)) continue;
            if (hasOwnField(v1, fieldName)) results.push({ time, fieldName, fieldValue: v1[fieldName], url, log });
            continue;
          }
          for (const k2 in v1) {
            const item = v1[k2];
            if (!item || typeof item !== 'object') continue;
            if (!isRowMatched(item.rowId, k2)) continue;
            if (!isProductMatched(item)) continue;
            if (hasOwnField(item, fieldName)) results.push({ time, fieldName, fieldValue: item[fieldName], url, log });
          }
        }
      }
    } else if (uri && (uri.includes('/action/Edit') || uri.includes('/action/Add') || uri.includes('/edit') || uri.includes('/Add'))) {
      if (body.details) {
        for (const objName in body.details) {
          if (body.details[objName] && Array.isArray(body.details[objName])) {
            body.details[objName].forEach((item) => {
              if (!isRowMatched(item.rowId, undefined)) return;
              if (!isProductMatched(item)) return;
              if (hasOwnField(item, fieldName)) results.push({ time, fieldName, fieldValue: item[fieldName], url, log });
            });
          }
        }
      }
      if (body.masterData && hasOwnField(body.masterData, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.masterData))) {
          results.push({ time, fieldName, fieldValue: body.masterData[fieldName], url, log });
        }
      }
      if (body.object_data && hasOwnField(body.object_data, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.object_data))) {
          results.push({ time, fieldName, fieldValue: body.object_data[fieldName], url, log });
        }
      }
    } else {
      if (body.details) {
        for (const objName in body.details) {
          if (body.details[objName] && Array.isArray(body.details[objName])) {
            body.details[objName].forEach((item) => {
              if (!isRowMatched(item.rowId, undefined)) return;
              if (!isProductMatched(item)) return;
              if (hasOwnField(item, fieldName)) results.push({ time, fieldName, fieldValue: item[fieldName], url, log });
            });
          }
        }
      }
      if (body.object_data && hasOwnField(body.object_data, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.object_data))) {
          results.push({ time, fieldName, fieldValue: body.object_data[fieldName], url, log });
        }
      }
      if (body.masterData && hasOwnField(body.masterData, fieldName)) {
        if (!hasRowIdFilter && (!hasProductIdFilter || isProductMatched(body.masterData))) {
          results.push({ time, fieldName, fieldValue: body.masterData[fieldName], url, log });
        }
      }
    }

    if (results.length === resultsBefore) {
      results.push({ time, fieldName, fieldValue: noMatchFieldValue, url, log: null });
    }
  });

  return attachApiDesc(results);
}

function extractMasterDataField(logData, masterFieldName) {
  if (!logData || !Array.isArray(logData)) return [];

  const results = [];
  const fieldNames = String(masterFieldName || '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name);

  logData.forEach((log) => {
    const { url, uri, time } = parseLogEntryMeta(log);

    if (uri && !matchesApiType(uri, SUPPORTED_APIS)) {
      fieldNames.forEach((fieldName) => results.push({ time, fieldName, fieldValue: '无', url, log: null }));
      return;
    }

    const { body } = parseLogEntry(log);
    if (!body) {
      fieldNames.forEach((fieldName) => results.push({ time, fieldName, fieldValue: '无', url, log: null }));
      return;
    }

    fieldNames.forEach((fieldName) => {
      let fieldValue = null;
      let found = false;

      if (uri && uri.includes('/TriggerEvent')) {
        if (body.object_data && body.object_data[fieldName] !== undefined) {
          fieldValue = body.object_data[fieldName];
          found = true;
        }
      } else {
        if (body.masterData && body.masterData[fieldName] !== undefined) {
          fieldValue = body.masterData[fieldName];
          found = true;
        } else if (body.object_data && body.object_data[fieldName] !== undefined) {
          fieldValue = body.object_data[fieldName];
          found = true;
        }
      }

      if (found) {
        results.push({ time, fieldName, fieldValue, url, log });
      } else {
        results.push({ time, fieldName, fieldValue: '无', url, log: null });
      }
    });
  });

  return attachApiDesc(results);
}

