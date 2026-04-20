const CAOLIAO_API = 'https://api.2dcode.biz/v1/read-qr-code';

// ==================== 初始化 ====================
async function setupOffscreen() {
  try {
    const existing = await chrome.offscreen.hasDocument?.() || false;
    if (existing) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING'],
      justification: '需要在 DOM 环境中裁剪图片'
    });
  } catch (e) {
    console.log('[QR] Offscreen Document 已存在');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'decodeQR',
    title: '识别二维码',
    contexts: ['image']
  });
  setupOffscreen();
});
setupOffscreen();

// ==================== 消息处理 ====================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'areaSelected':
      handleCapture(request.area);
      sendResponse({ success: true });
      break;
    case 'decodeImage':
      decodeWithCaoliaoAPI(request.dataUrl)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ result: null, error: err.message }));
      return true;
    case 'cropImage':
      return false; // 由 offscreen.js 处理
  }
  return true;
});

// 右键菜单识别
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    let dataUrl = info.srcUrl;
    if (!dataUrl.startsWith('data:')) {
      dataUrl = await fetchImageAsDataURL(info.srcUrl);
    }
    const result = await decodeWithCaoliaoAPI(dataUrl);
    saveResult(result);
  } catch (err) {
    saveResult({ result: null, error: err.message });
  }
});

// ==================== 核心功能 ====================
async function handleCapture(area) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    let finalDataUrl = dataUrl;
    
    if (area && area.width > 0 && area.height > 0) {
      await setupOffscreen();
      const cropResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'cropImage',
          dataUrl: dataUrl,
          area: area
        }, resolve);
      });
      if (cropResult?.success) finalDataUrl = cropResult.dataUrl;
    }
    
    const result = await decodeWithCaoliaoAPI(finalDataUrl);
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

// ==================== 结果存储 ====================
async function saveResult({ result, error }) {
  const isSuccess = result && !error;
  
  if (isSuccess) {
    const validResults = (Array.isArray(result) ? result : [result])
      .filter(r => r && typeof r === 'string' && r.trim() !== '');
    
    if (validResults.length === 0) {
      await storeResult('未识别到有效内容', true);
    } else {
      await storeResult(validResults, false)
    }
  } else {
    await storeResult(error || '未识别到二维码', true);
  }
  
  chrome.action.openPopup();
}

async function storeResult(text, isError) {
  await chrome.storage.local.set({
    lastResult: { text, isError, timestamp: Date.now() }
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