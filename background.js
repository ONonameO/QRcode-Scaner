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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAreaSelection') {
    // 这个由 content script 处理
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'areaSelected') {
    handleCapture(request.area);
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'decodeImage') {
    // 处理图片解析
    decodeWithCaoliaoAPI(request.dataUrl).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ result: null, error: err.message });
    });
    return true; // 保持消息通道开放
  } else if (request.action === 'cropImage') {
    // 这个由 offscreen.js 处理，但需要转发
    return false;
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
      // 发送到 offscreen 进行裁剪
      const cropResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'cropImage',
          dataUrl: dataUrl,
          area: area
        }, (response) => {
          resolve(response);
        });
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
  
  // 设置30秒超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(CAOLIAO_API, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
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
    
    // 过滤空内容
    const contents = result.data.contents.filter(c => c && typeof c === 'string' && c.trim() !== '');
    
    if (contents.length === 0) {
      return { result: null, error: '识别结果为空' };
    }
    
    // 返回所有结果
    return { result: contents, error: null };
    
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { result: null, error: '请求超时（30秒）' };
    }
    return { result: null, error: `网络请求失败: ${err.message}` };
  }
}

// 修改 handleResult 以支持多结果
async function handleResult({ result, error }) {
  const isSuccess = result && (!error);

  // chrome.action.setBadgeText({ text: '' });
  
  if (isSuccess) {
    // result 可能是数组或字符串
    const resultToStore = Array.isArray(result) ? result : [result];
    const validResults = resultToStore.filter(r => r && typeof r === 'string' && r.trim() !== '');
    
    if (validResults.length === 0) {
      await chrome.storage.local.set({
        lastResult: {
          text: '未识别到有效内容',
          isError: true,
          timestamp: Date.now()
        }
      });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4d4f' });
    } else {
      await chrome.storage.local.set({
        lastResult: {
          text: validResults,
          isError: false,
          timestamp: Date.now()
        }
      });

      const resultCount = validResults.length;
      const badgeText = resultCount > 99 ? '99+' : resultCount.toString();
      chrome.action.setBadgeText({ text: badgeText });
      chrome.action.setBadgeBackgroundColor({ color: '#07c160' });
      
    }
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
  
  // 自动打开 popup 显示结果
  chrome.action.openPopup();
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
