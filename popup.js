// ==================== DOM 元素 ====================
const DOM = {
  views: { action: 'view-action', loading: 'view-loading', result: 'view-result' },
  result: { icon: 'result-icon', title: 'result-title', count: 'result-count', list: 'result-list' },
  btns: { area: 'btn-area', file: 'btn-file', clipboard: 'btn-clipboard', cancel: 'btn-cancel', back: 'btn-back' },
  fileInput: 'file-input',
  toast: 'toast'
};

let elements = {};
let currentAbortController = null;
let isDecoding = false;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  // 获取 DOM 元素
  for (const [key, id] of Object.entries(DOM)) {
    if (typeof id === 'string') {
      elements[key] = document.getElementById(id);
    } else if (typeof id === 'object') {
      elements[key] = {};
      for (const [subKey, subId] of Object.entries(id)) {
        elements[key][subKey] = document.getElementById(subId);
      }
    }
  }
  elements.fileInput = document.getElementById(DOM.fileInput);
  elements.toast = document.getElementById(DOM.toast);
  
  // 恢复状态
  const { decodingState, lastResult } = await chrome.storage.local.get(['decodingState', 'lastResult']);
  
  if (decodingState?.isDecoding && (Date.now() - decodingState.timestamp < 60000)) {
    showView('loading');
    if (decodingState.dataUrl) continueDecode(decodingState.dataUrl);
  } else if (lastResult && (Date.now() - lastResult.timestamp < 300000)) {
    // 统一使用 renderResult 渲染
    renderResult(lastResult);
  } else {
    showView('action');
    await chrome.storage.local.remove(['lastResult', 'decodingState']);
  }
  
  // 绑定事件
  elements.btns.area?.addEventListener('click', startAreaSelection);
  elements.btns.file?.addEventListener('click', () => elements.fileInput.click());
  elements.btns.clipboard?.addEventListener('click', handleClipboard);
  elements.btns.cancel?.addEventListener('click', cancelDecode);
  elements.btns.back?.addEventListener('click', backToAction);
  elements.fileInput?.addEventListener('change', handleFileUpload);
});

// ==================== 视图控制 ====================
function showView(viewName) {
  Object.values(elements.views).forEach(view => view.classList.remove('active'));
  elements.views[viewName]?.classList.add('active');
}

function showLoading(message = '正在识别二维码...') {
  showView('loading');
  document.querySelector('.loading-text').textContent = message;
  setBadge('···', '#f7d22f');
}

function showAction() {
  cancelCurrentDecode();
  showView('action');
  setBadge('', '');
}

// ==================== 统一结果渲染 ====================
function renderResult(data) {
  showView('result');
  
  // 识别失败
  if (data.isError) {
    setBadge('! ', '#ff4d4f');
    elements.result.icon.textContent = '✗';
    elements.result.icon.classList.add('error');
    elements.result.title.textContent = '识别失败';
    elements.result.count.textContent = '';
    elements.result.list.innerHTML = `<div class="result-item">
      <div class="result-item-content" style="color:#ff4d4f;">${escapeHtml(data.text)}</div>
    </div>`;
    return;
  }
  
  // 处理多个结果
  const results = Array.isArray(data.text) ? data.text : [data.text];
  const validResults = results.filter(r => r?.trim());
  const count = validResults.length;
  
  //0个结果
  if (count === 0) {
    setBadge('! ', '#ff4d4f');
    elements.result.icon.textContent = '✗';
    elements.result.icon.classList.add('error');
    elements.result.title.textContent = '识别失败';
    elements.result.count.textContent = '';
    elements.result.list.innerHTML = `<div class="result-item">
      <div class="result-item-content" style="color:#ff4d4f;">未识别到有效内容</div>
    </div>`;
    return;
  }

  // 识别成功

  setBadge(count > 99 ? '99+' : count.toString(), '#07c160');
  elements.result.icon.textContent = '✓';
  elements.result.icon.classList.remove('error');
  elements.result.title.textContent = '识别成功';
  elements.result.count.textContent = `共 ${count} 个结果`;

  elements.result.list.innerHTML = validResults.map(content => `
    <div class="result-item">
      <div class="result-item-content">${escapeHtml(content)}</div>
      <div class="result-item-actions">
        <button class="item-btn item-btn-copy">📋 复制</button>
        ${isURL(content) ? '<button class="item-btn item-btn-open">🔗 打开链接</button>' : ''}
      </div>
    </div>
  `).join('');
  
  // 绑定按钮事件
  document.querySelectorAll('.result-item').forEach((item, idx) => {
    const content = validResults[idx];
    item.querySelector('.item-btn-copy')?.addEventListener('click', () => copyToClipboard(content));
    item.querySelector('.item-btn-open')?.addEventListener('click', () => openLink(content));
  });
}

// ==================== 识别功能 ====================
async function decodeWithBackground(dataUrl) {
  return new Promise((resolve, reject) => {
    currentAbortController = new AbortController();
    isDecoding = true;
    
    const timeoutId = setTimeout(() => {
      currentAbortController?.abort();
      reject(new Error('识别超时（30秒）'));
    }, 30000);
    
    chrome.runtime.sendMessage({ action: 'decodeImage', dataUrl }, (response) => {
      clearTimeout(timeoutId);
      if (!isDecoding) return reject(new Error('用户取消识别'));
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(response);
    });
    
    currentAbortController.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      isDecoding = false;
      reject(new Error('用户取消识别'));
    });
  });
}

function cancelCurrentDecode() {
  currentAbortController?.abort();
  currentAbortController = null;
  isDecoding = false;
}

async function cancelDecode() {
  cancelCurrentDecode();
  await chrome.storage.local.remove('decodingState');
  showToast('已取消识别');
  showAction();
}

async function backToAction() {
  cancelCurrentDecode();
  await chrome.storage.local.remove(['decodingState', 'lastResult']);
  showAction();
}

function handleDecodeResult(result) {
  if (!isDecoding) return;
  
  if (result.result && !result.error) {
    chrome.storage.local.set({ 
      lastResult: { text: result.result, isError: false, timestamp: Date.now() } 
    });
    renderResult({ text: result.result, isError: false });
  } else {
    const errMsg = result.error || '未识别到二维码';
    chrome.storage.local.set({ 
      lastResult: { text: errMsg, isError: true, timestamp: Date.now() } 
    });
    renderResult({ text: errMsg, isError: true });
  }
}

async function continueDecode(dataUrl) {
  try {
    const result = await decodeWithBackground(dataUrl);
    if (isDecoding) handleDecodeResult(result);
  } catch (err) {
    if (isDecoding && err.message !== '用户取消识别') {
      handleDecodeResult({ result: null, error: err.message });
    }
  } finally {
    await chrome.storage.local.remove('decodingState');
  }
}

// ==================== 文件上传 ====================
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件');
    elements.fileInput.value = '';
    return;
  }
  
  cancelCurrentDecode();
  showLoading('正在解析图片...');
  
  try {
    const dataUrl = await fileToDataURL(file);
    await chrome.storage.local.set({
      decodingState: { isDecoding: true, dataUrl, message: '正在解析图片...', timestamp: Date.now() }
    });
    const result = await decodeWithBackground(dataUrl);
    if (isDecoding) handleDecodeResult(result);
  } catch (err) {
    if (isDecoding && err.message !== '用户取消识别') {
      handleDecodeResult({ result: null, error: err.message });
    }
  } finally {
    elements.fileInput.value = '';
    await chrome.storage.local.remove('decodingState');
  }
}

// ==================== 剪贴板 ====================
async function handleClipboard() {
  try {
    showToast('正在检查剪贴板...');
    
    let clipboardItems;
    try {
      clipboardItems = await navigator.clipboard.read();
    } catch (err) {
      showToast(err.name === 'NotAllowedError' ? '需要剪贴板读取权限' : '读取剪贴板失败');
      return;
    }
    
    let validImageBlob = null;
    for (const item of clipboardItems) {
      for (const type of item.types.filter(t => t.startsWith('image/'))) {
        const blob = await item.getType(type);
        if (blob && await validateImageBlob(blob)) {
          validImageBlob = blob;
          break;
        }
      }
      if (validImageBlob) break;
    }
    
    if (!validImageBlob) {
      showToast('剪贴板中没有有效的图片');
      return;
    }
    
    showLoading('正在解析图片...');
    cancelCurrentDecode();
    
    const dataUrl = await blobToDataURL(validImageBlob);
    await chrome.storage.local.set({
      decodingState: { isDecoding: true, dataUrl, message: '正在解析图片...', timestamp: Date.now() }
    });
    
    const result = await decodeWithBackground(dataUrl);
    if (isDecoding) handleDecodeResult(result);
  } catch (err) {
    if (elements.views.loading?.classList.contains('active')) showAction();
    if (err.message !== '用户取消识别') showToast('读取剪贴板失败: ' + (err.message || '未知错误'));
  } finally {
    await chrome.storage.local.remove('decodingState');
  }
}

// ==================== 框选区域 ====================
async function startAreaSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showToast('无法获取当前页面');
    
    const blockedUrls = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];
    if (blockedUrls.some(prefix => tab.url.startsWith(prefix))) {
      return showToast('无法在浏览器内部页面使用框选功能\n请在其他网页上使用');
    }
    
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
    window.close();
  } catch (err) {
    showToast('启动框选失败: ' + (err.message || '未知错误'));
  }
}

// ==================== 工具函数 ====================
function isURL(str) {
  if (!str?.trim()) return false;
  const trimmed = str.trim();
  return /^(https?:\/\/|ftp:\/\/|file:\/\/|www\.)/i.test(trimmed) ||
         /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i.test(trimmed);
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板');
  }
}

function openLink(url) {
  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) finalUrl = 'https://' + url;
  chrome.tabs.create({ url: finalUrl });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  setTimeout(() => elements.toast.classList.remove('show'), 1500);
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function validateImageBlob(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.width > 0 && img.height > 0); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    img.src = url;
    setTimeout(() => { URL.revokeObjectURL(url); resolve(false); }, 3000);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}