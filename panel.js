const port = chrome.runtime.connect({ name: 'logs-analyzer' });

const $total = document.getElementById('total');
const $err = document.getElementById('err');
const $fieldName = document.getElementById('fieldName');
const $rowId = document.getElementById('rowId');
const $productId = document.getElementById('productId');
const $masterFieldName = document.getElementById('masterFieldName');
const $tableBody = document.getElementById('tableBody');
const $btnFilterSupported = document.getElementById('btnFilterSupported');
const $btnResetFilter = document.getElementById('btnResetFilter');

const state = {
  logs: [],
  viewMode: 'all', // 'all' | 'supported'
  lastAction: 'detail' // 'detail' | 'master'
};

function showError(text) {
  if (!text) {
    $err.style.display = 'none';
    $err.textContent = '';
    return;
  }
  $err.style.display = 'block';
  $err.textContent = text;
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function renderTotal() {
  $total.textContent = String(state.logs.length);
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('btnClear').addEventListener('click', () => {
  showError('');
  port.postMessage({ type: 'clear' });
});

document.getElementById('btnExport').addEventListener('click', () => {
  showError('');
  const now = new Date();
  const name = `logs_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.json`;
  downloadJson(name, { data: { logs: state.logs } });
});

function clearTableOnly() {
  $tableBody.innerHTML = '<tr><td colspan="7" class="no-data">请输入搜索条件并点击搜索按钮</td></tr>';
}

function syncFilterButtonStyle() {
  if (!$btnFilterSupported) return;
  if (state.viewMode === 'supported') $btnFilterSupported.classList.add('btn-active');
  else $btnFilterSupported.classList.remove('btn-active');
}

function getActiveLogs() {
  if (state.viewMode !== 'supported') return state.logs;
  // 仅展示“支持解析出分析结果”的接口日志
  return state.logs.filter((log) => {
    const meta = parseLogEntryMeta(log);
    return meta && meta.uri && matchesApiType(meta.uri, SUPPORTED_APIS);
  });
}

function renderTable(data, masterFieldName) {
  $tableBody.innerHTML = '';
  if (!data || data.length === 0) {
    $tableBody.innerHTML = '<tr><td colspan="7" class="no-data">未找到匹配的数据</td></tr>';
    return;
  }

  data.forEach((item) => {
    const row = document.createElement('tr');

    const timeCell = document.createElement('td');
    timeCell.textContent = item.time || 'null';
    row.appendChild(timeCell);

    const fieldNameCell = document.createElement('td');
    fieldNameCell.textContent = item.fieldName || 'null';
    row.appendChild(fieldNameCell);

    const fieldValueCell = document.createElement('td');
    const fieldValueText = (item.fieldValue !== null && item.fieldValue !== undefined) ? String(item.fieldValue) : '无';
    fieldValueCell.textContent = fieldValueText;
    if (fieldValueText && fieldValueText !== '无') {
      fieldValueCell.classList.add('value-hit');
    }
    row.appendChild(fieldValueCell);

    const masterFieldCell = document.createElement('td');
    masterFieldCell.textContent = masterFieldName || 'null';
    row.appendChild(masterFieldCell);

    // 主对象字段值：仅当 item.log 存在时尝试解析 body（保持和旧页面一致）
    let masterFieldValue = null;
    if (masterFieldName && item.log && item.log.msg) {
      try {
        const bodyMatch = String(item.log.msg).match(/body:(\{.*\})/s);
        if (bodyMatch && bodyMatch[1]) {
          const body = JSON.parse(bodyMatch[1]);
          if (body.object_data && body.object_data[masterFieldName] !== undefined) {
            masterFieldValue = body.object_data[masterFieldName];
          } else if (body.masterData && body.masterData[masterFieldName] !== undefined) {
            masterFieldValue = body.masterData[masterFieldName];
          }
        }
      } catch (e) {
        // ignore
      }
    }
    const masterFieldValueCell = document.createElement('td');
    masterFieldValueCell.textContent = (masterFieldValue !== null && masterFieldValue !== undefined) ? masterFieldValue : '无';
    row.appendChild(masterFieldValueCell);

    const urlCell = document.createElement('td');
    urlCell.textContent = item.url || 'null';
    row.appendChild(urlCell);

    const apiDescCell = document.createElement('td');
    apiDescCell.textContent = item.apiDesc || '无';
    row.appendChild(apiDescCell);

    $tableBody.appendChild(row);
  });
}

function searchLogs() {
  showError('');
  const fieldName = ($fieldName.value || '').trim();
  const rowId = ($rowId.value || '').trim();
  const productId = ($productId && $productId.value ? $productId.value : '').trim();
  const masterFieldName = ($masterFieldName.value || '').trim();

  if (!fieldName) {
    showError('请输入字段名');
    return;
  }

  state.lastAction = 'detail';
  const results = findLogs(getActiveLogs(), fieldName, rowId || undefined, productId || undefined);
  renderTable(results, masterFieldName);
}

function searchMasterData() {
  showError('');
  const masterFieldName = ($masterFieldName.value || '').trim();
  if (!masterFieldName) {
    showError('请输入主对象字段名');
    return;
  }
  state.lastAction = 'master';
  const results = extractMasterDataField(getActiveLogs(), masterFieldName);
  renderTable(results, masterFieldName);
}

document.getElementById('btnSearch').addEventListener('click', searchLogs);
document.getElementById('btnSearchMaster').addEventListener('click', searchMasterData);
document.getElementById('btnClearTable').addEventListener('click', () => {
  showError('');
  clearTableOnly();
});
$btnFilterSupported.addEventListener('click', () => {
  showError('');
  state.viewMode = 'supported';
  syncFilterButtonStyle();
  // 立即刷新：按上一次操作类型重新跑一遍
  if (state.lastAction === 'master') searchMasterData();
  else searchLogs();
});
$btnResetFilter.addEventListener('click', () => {
  showError('');
  state.viewMode = 'all';
  syncFilterButtonStyle();
  if (state.lastAction === 'master') searchMasterData();
  else searchLogs();
});

document.addEventListener('keypress', (event) => {
  if (event.key === 'Enter') searchLogs();
});

port.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'state') {
    // total 会在 render 里同步显示，这里只保留兼容
    return;
  }

  if (msg.type === 'logs_batch') {
    const batch = msg.payload && msg.payload.logs;
    if (Array.isArray(batch) && batch.length) {
      state.logs.push(...batch);
      renderTotal();
    }
    return;
  }

  if (msg.type === 'cleared') {
    state.logs = [];
    state.viewMode = 'all';
    renderTotal();
    syncFilterButtonStyle();
    clearTableOnly();
    return;
  }

  if (msg.type === 'ingest_error') {
    const e = msg.payload || {};
    showError(`[抓取失败]\nurl: ${e.url || '-'}\nerror: ${e.error || '-'}`);
    return;
  }
});

// 初始化：拉取当前缓存状态
port.postMessage({ type: 'get_state' });
renderTotal();
syncFilterButtonStyle();
clearTableOnly();

