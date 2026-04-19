const CAOLIAO_API = 'https://api.2dcode.biz/v1/read-qr-code';

// 确保 Offscreen Document 存在（用于裁剪图片）
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

// 右键菜单：识别图片中的二维码
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'decodeQR') return;
  
  try {
    let dataUrl = info.srcUrl;
    if (!dataUrl.startsWith('data:')) {
      dataUrl = await fetchImageAsDataURL(info.srcUrl);
    }
    
    const result = await decodeWithCaoliaoAPI(dataUrl);
    handleResult(result);
  } catch (err) {
    handleResult({ result: null, error: err.message });
  }
});

// 接收 popup 和 content script 消息
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'startAreaSelection') {
    injectAreaSelector();
  } else if (request.action === 'areaSelected') {
    handleCapture(request.area);
  }
  return true;
});

// 区域截图处理（框选后调用）
async function handleCapture(area) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    
    let finalDataUrl = dataUrl;
    if (area && area.width > 0 && area.height > 0) {
      await setupOffscreen();
      const cropResult = await chrome.runtime.sendMessage({
        action: 'cropImage',
        dataUrl: dataUrl,
        area: area
      });
      
      if (cropResult && cropResult.success) {
        finalDataUrl = cropResult.dataUrl;
      }
    }
    
    const result = await decodeWithCaoliaoAPI(finalDataUrl);
    handleResult(result);
  } catch (err) {
    handleResult({ result: null, error: err.message });
  }
}

// 调用草料 API
async function decodeWithCaoliaoAPI(dataUrl) {
  const blob = dataURLtoBlob(dataUrl);
  const formData = new FormData();
  formData.append('file', blob, 'qrcode.png');
  
  try {
    const response = await fetch(CAOLIAO_API, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.code !== 0) {
      return { result: null, error: `API错误: ${result.message || '未知错误'}` };
    }
    
    if (!result.data || !Array.isArray(result.data.contents) || result.data.contents.length === 0) {
      return { result: null, error: '未识别到二维码' };
    }
    
    const content = result.data.contents[0];
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return { result: null, error: '识别结果为空' };
    }
    
    return { result: content.trim(), error: null };
    
  } catch (err) {
    return { result: null, error: `网络请求失败: ${err.message}` };
  }
}

// ✅ 核心修改：结果存入 storage，popup 自动读取展示
async function handleResult({ result, error }) {
  const isSuccess = result && typeof result === 'string' && result.trim() !== '';
  
  if (isSuccess) {
    await chrome.storage.local.set({
      lastResult: {
        text: result,
        isError: false,
        timestamp: Date.now()
      }
    });
    
    // 设置角标提示用户有新结果
    chrome.action.setBadgeText({ text: '1' });
    chrome.action.setBadgeBackgroundColor({ color: '#07c160' });
    
    // 静默复制到剪贴板
    copyToClipboard(result).catch(() => {});
  } else {
    const errMsg = error || '未识别到二维码';
    
    await chrome.storage.local.set({
      lastResult: {
        text: errMsg,
        isError: true,
        timestamp: Date.now()
      }
    });
    
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff4d4f' });
  }
  chrome.action.openPopup()
}

// 注入区域选择脚本
async function injectAreaSelector() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });
}

// 获取图片 DataURL
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

// DataURL 转 Blob
function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (txt) => {
        navigator.clipboard.writeText(txt).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = txt;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        });
      },
      args: [text]
    });
  } catch (e) {
    console.error('复制失败:', e);
  }
}