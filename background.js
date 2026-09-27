const CAOLIAO_API = 'https://api.2dcode.biz/v1/read-qr-code';

// ==================== 初始化 ====================
// 每次修改 offscreen 相关逻辑（offscreen.js / qr-decoder.js / libs）后请把此版本号 +1，
// 以便扩展重载后强制重建 offscreen，避免使用陈旧（旧代码）的 offscreen 实例。
const OFFSCREEN_VERSION = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 确保 offscreen 文档存在且为最新版本；版本不符则先关闭再重建
async function ensureOffscreen() {
  try {
    const has = await chrome.offscreen.hasDocument?.() || false;
    if (has) {
      const { offscreenVersion } = await chrome.storage.local.get('offscreenVersion');
      if (offscreenVersion === OFFSCREEN_VERSION) return;
      await chrome.offscreen.closeDocument?.();
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING', 'BLOBS'],
      justification: '需要在 DOM 环境中裁剪图片，并用 Canvas + zxing-wasm 做本地离线解码'
    });
    await chrome.storage.local.set({ offscreenVersion: OFFSCREEN_VERSION });
  } catch (e) {
    console.warn('[QR] 创建 Offscreen Document 失败', e);
  }
}

// 强制关闭并重建 offscreen（用于本地解码无响应时自愈）
async function recreateOffscreen() {
  try { await chrome.offscreen.closeDocument?.(); } catch (_) {}
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING', 'BLOBS'],
      justification: '需要在 DOM 环境中裁剪图片，并用 Canvas + zxing-wasm 做本地离线解码'
    });
    await chrome.storage.local.set({ offscreenVersion: OFFSCREEN_VERSION });
  } catch (e) {
    console.warn('[QR] 重建 Offscreen Document 失败', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'decodeQR',
    title: '识别二维码',
    contexts: ['image']
  });
  ensureOffscreen();
});
ensureOffscreen();

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// ==================== 消息处理 ====================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'areaSelected':
      handleCapture(request.area);
      sendResponse({ success: true });
      break;
    case 'decodeImage':
      decodeWithFallback(request.dataUrl)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ result: null, error: err.message }));
      return true;
    case 'cropImage':
      return false;
  }
  return false; // 未处理的 action 不占用消息通道，避免拦截本应发往 offscreen 的消息
});

// ==================== 解码模式与本地离线解码 ====================
// 解码模式：'auto'(默认，本地优先失败回退草料) / 'local'(仅本地) / 'online'(仅草料)
async function getDecodeMode() {
  const { decodeMode } = await chrome.storage.local.get('decodeMode');
  return decodeMode === 'local' || decodeMode === 'online' ? decodeMode : 'auto';
}

// 本地离线解码（background -> offscreen 桥接）。
// 防 offscreen 尚未就绪：首次失败重试一次；若仍无响应（offscreen 陈旧/未加载），
// 强制重建 offscreen 后再试一次（自愈）。
async function decodeOffline(dataUrl) {
  await ensureOffscreen();
  const attempt = () => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'decodeOffline', dataUrl }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp); // 若无任何监听者响应，resp 为 undefined
    });
  });

  let resp;
  try {
    resp = await attempt();
  } catch (e) {
    await sleep(500);
    resp = await attempt();
  }

  // 完全无响应：offscreen 可能陈旧或未就绪 → 重建后重试一次
  if (!resp) {
    console.warn('[QR] offscreen 无响应，尝试重建后重试');
    await recreateOffscreen();
    await sleep(600);
    try { resp = await attempt(); } catch (e) { console.warn('[QR] 重建后重试仍失败', e); }
  }

  if (!resp) throw new Error('offscreen 无响应（已尝试重建）');
  if (resp.error) throw new Error(resp.error);
  return resp.texts || [];
}

// 统一解码入口：本地优先，按模式决定是否回退草料 API
async function decodeWithFallback(dataUrl) {
  const mode = await getDecodeMode();

  // 仅在线：直接走草料 API
  if (mode === 'online') {
    const r = await decodeWithCaoliaoAPI(dataUrl);
    r.source = 'api';
    return r;
  }

  // 仅本地 / 自动：先本地离线解码
  try {
    const local = await decodeOffline(dataUrl);
    if (local.length > 0) {
      return { result: local, error: null, source: 'local' };
    }
  } catch (e) {
    console.warn('[QR] 本地离线解码异常，准备回退', e);
  }

  // 仅本地模式：本地失败即报错，不再回退
  if (mode === 'local') {
    return { result: null, error: '本地识别失败（当前为仅本地模式）', source: 'local' };
  }

  // 自动模式：本地失败 -> 回退草料 API
  const r = await decodeWithCaoliaoAPI(dataUrl);
  r.source = 'api';
  return r;
}

// 右键菜单识别
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    // 1. 先保存解码状态（让 popup 知道正在识别）
    await saveDecodingState(null, '正在识别二维码...');
    
    // 2. 立即打开 popup 显示加载页面
    chrome.action.openPopup();
    setBadge('···', '#f7d22f');
    
    // 3. 获取图片数据
    let dataUrl = info.srcUrl;
    if (!dataUrl.startsWith('data:')) {
      dataUrl = await fetchImageAsDataURL(info.srcUrl);
    }
    
    // 4. 更新解码状态中的 dataUrl
    await updateDecodingStateDataUrl(dataUrl);
    
    // 5. 调用解码（本地优先，失败回退草料）
    const result = await decodeWithFallback(dataUrl);
    saveResult(result);
  } catch (err) {
    saveResult({ result: null, error: err.message });
  }
});

// ==================== 核心功能 ====================
async function handleCapture(area) {
  try {
    // 1. 先保存解码状态（让 popup 知道正在识别）
    await saveDecodingState(null, '正在识别二维码...');
    
    // 2. 立即打开 popup 显示加载页面
    chrome.action.openPopup();
    setBadge('···', '#f7d22f');
    
    // 3. 截图
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    let finalDataUrl = dataUrl;
    
    // 4. 裁剪图片（如果需要）
    if (area && area.width > 0 && area.height > 0) {
      await ensureOffscreen();
      const cropResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'cropImage',
          dataUrl: dataUrl,
          area: area
        }, resolve);
      });
      if (cropResult?.success) finalDataUrl = cropResult.dataUrl;
    }
    
    // 5. 更新解码状态中的 dataUrl
    await updateDecodingStateDataUrl(finalDataUrl);
    
    // 6. 调用解码（本地优先，失败回退草料）
    const result = await decodeWithFallback(finalDataUrl);
    saveResult(result);
  } catch (err) {
    saveResult({ result: null, error: err.message });
  }
}

async function decodeWithCaoliaoAPI(dataUrl) {
  const blob = dataURLtoBlob(dataUrl);
  const formData = new FormData();
  formData.append('file', blob, 'qrcode.png');
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(CAOLIAO_API, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const result = await response.json();
    if (result.code !== 0) {
      return { result: null, error: `API错误: ${result.message || '未知错误'}` };
    }
    
    const contents = (result.data?.contents || [])
      .filter(c => c && typeof c === 'string' && c.trim() !== '');
    
    if (contents.length === 0) {
      return { result: null, error: '未识别到二维码' };
    }
    
    return { result: contents, error: null };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { result: null, error: '请求超时（30秒）' };
    }
    return { result: null, error: `网络请求失败: ${err.message}` };
  }
}

// ==================== 解码状态管理 ====================
async function saveDecodingState(dataUrl, message) {
  await chrome.storage.local.set({
    decodingState: {
      isDecoding: true,
      dataUrl: dataUrl,
      message: message,
      timestamp: Date.now()
    }
  });
}

async function updateDecodingStateDataUrl(dataUrl) {
  const { decodingState } = await chrome.storage.local.get('decodingState');
  if (decodingState) {
    await chrome.storage.local.set({
      decodingState: {
        ...decodingState,
        dataUrl: dataUrl
      }
    });
  }
}

async function clearDecodingState() {
  await chrome.storage.local.remove('decodingState');
}

// ==================== 结果存储 ====================
// 在文件开头添加
let expireTimer = null;

// 修改 saveResult 函数
async function saveResult({ result, error, source }) {
  // 清除之前的过期定时器
  if (expireTimer) {
    clearTimeout(expireTimer);
    expireTimer = null;
  }
  
  const isSuccess = result && !error;
  
  if (isSuccess) {
    const validResults = (Array.isArray(result) ? result : [result])
      .filter(r => r && typeof r === 'string' && r.trim() !== '');
    
    if (validResults.length === 0) {
      await storeResult('未识别到有效内容', true, source);
    } else {
      await storeResult(validResults, false, source);
    }
  } else {
    await storeResult(error || '未识别到二维码', true, source);
  }
  
  // 清除解码状态
  await clearDecodingState();
  
  // 注意：popup 已经打开，结果会通过 storage 变化自动更新
  // 触发 storage 变化事件，让 popup 知道结果已准备好
  chrome.storage.local.get('lastResult', () => {});
}

async function storeResult(text, isError, source) {
  await chrome.storage.local.set({
    lastResult: { text, isError, source: source || 'api', timestamp: Date.now() }
  });
}

// ==================== 工具函数 ====================
async function fetchImageAsDataURL(url) {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }
  return new Blob([u8arr], { type: mime });
}

// ==================== 结果过期清理 ====================
// 检查结果是否过期并清除角标
async function checkAndClearExpiredResult() {
  const { lastResult } = await chrome.storage.local.get('lastResult');
  
  if (lastResult && (Date.now() - lastResult.timestamp >= 300000)) { // 5分钟 = 300000毫秒
    // 结果已过期，清除存储和角标
    await chrome.storage.local.remove('lastResult');
    chrome.action.setBadgeText({ text: '' });
    console.log('[QR] 识别结果已过期，角标已清除');
  }
}

// 启动定时检查（每30秒检查一次）
setInterval(() => {
  checkAndClearExpiredResult();
}, 30000); // 30秒检查一次

// 扩展启动时立即检查一次
checkAndClearExpiredResult();

// 监听 storage 变化，当 lastResult 被设置时，设置一个定时器在过期时清除
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.lastResult) {
    const newResult = changes.lastResult.newValue;
    if (newResult) {
      // 计算还需要多久过期
      const elapsed = Date.now() - newResult.timestamp;
      const remaining = Math.max(0, 300000 - elapsed);
      
      // 设置定时器，在过期时清除角标
      setTimeout(async () => {
        const { lastResult: currentResult } = await chrome.storage.local.get('lastResult');
        // 检查这个结果是否还是同一个（没有被新结果覆盖）
        if (currentResult && currentResult.timestamp === newResult.timestamp) {
          await chrome.storage.local.remove('lastResult');
          chrome.action.setBadgeText({ text: '' });
          console.log('[QR] 识别结果已过期（定时器），角标已清除');
        }
      }, remaining);
    }
  }
});