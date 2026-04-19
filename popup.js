document.addEventListener('DOMContentLoaded', async () => {
  const viewAction = document.getElementById('view-action');
  const viewLoading = document.getElementById('view-loading');
  const viewResult = document.getElementById('view-result');
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultCount = document.getElementById('result-count');
  const resultList = document.getElementById('result-list');
  const btnBack = document.getElementById('btn-back');
  const btnArea = document.getElementById('btn-area');
  const btnFile = document.getElementById('btn-file');
  const btnClipboard = document.getElementById('btn-clipboard');
  const btnCancel = document.getElementById('btn-cancel');
  const fileInput = document.getElementById('file-input');
  const toast = document.getElementById('toast');

  let currentAbortController = null;
  let isDecoding = false;

  // 检查是否有待显示的结果（5分钟内有效）
  const { lastResult } = await chrome.storage.local.get('lastResult');
  
  if (lastResult && (Date.now() - lastResult.timestamp < 300000)) {
    showResult(lastResult);
  } else {
    showAction();
    if (lastResult) {
      chrome.storage.local.remove('lastResult');
    }
  }

  // 框选区域
  btnArea.addEventListener('click', async () => {
    try {
      // 先保存当前标签页ID
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        showToast('无法获取当前页面');
        return;
      }
      
      // 注入content script并启动框选
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      
      // 发送消息启动框选
      await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
      window.close();
    } catch (err) {
      console.error('启动框选失败:', err);
      showToast('启动框选失败，请刷新页面重试');
    }
  });
  
  // 上传图片
  btnFile.addEventListener('click', () => {
    fileInput.click();
  });
  
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // 取消之前的识别
    cancelCurrentDecode();
    
    showLoading('正在解析图片...');
    
    try {
      const dataUrl = await fileToDataURL(file);
      const result = await decodeWithBackground(dataUrl);
      if (!isDecoding) {
        // 如果已经被取消，不处理结果
        return;
      }
      handleDecodeResult(result);
    } catch (err) {
      if (isDecoding && err.message !== '用户取消识别') {
        handleDecodeResult({ result: null, error: err.message });
      }
    } finally {
      fileInput.value = '';
      clearCurrentDecode();
    }
  });
  
  // 读取剪贴板图片
  btnClipboard.addEventListener('click', async () => {
    try {
      // 取消之前的识别
      cancelCurrentDecode();
      
      // 检查剪贴板权限
      const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
      
      if (permissionStatus.state === 'denied') {
        showToast('没有剪贴板读取权限');
        return;
      }
      
      showLoading('正在读取剪贴板...');
      const clipboardItems = await navigator.clipboard.read();
      
      let imageFound = false;
      for (const item of clipboardItems) {
        const imageTypes = item.types.filter(type => type.startsWith('image/'));
        
        for (const type of imageTypes) {
          const blob = await item.getType(type);
          if (blob && blob.type.startsWith('image/')) {
            const dataUrl = await blobToDataURL(blob);
            showLoading('正在解析图片...');
            const result = await decodeWithBackground(dataUrl);
            if (!isDecoding) {
              // 如果已经被取消，不处理结果
              return;
            }
            handleDecodeResult(result);
            imageFound = true;
            break;
          }
        }
        if (imageFound) break;
      }
      
      if (!imageFound && isDecoding) {
        showToast('剪贴板中没有图片');
        showAction();
      }
    } catch (err) {
      console.error('读取剪贴板失败:', err);
      if (isDecoding) {
        if (err.name === 'NotAllowedError') {
          showToast('请先在浏览器设置中允许读取剪贴板权限');
        } else {
          showToast('读取剪贴板失败: ' + (err.message || '未知错误'));
        }
        showAction();
      }
    } finally {
      clearCurrentDecode();
    }
  });
  
  // 取消识别
  btnCancel.addEventListener('click', () => {
    cancelCurrentDecode();
    showToast('已取消识别');
    showAction();
  });
  
  btnBack.addEventListener('click', () => {
    // 取消任何正在进行的识别
    cancelCurrentDecode();
    chrome.storage.local.remove('lastResult');
    showAction();
  });

  function showAction() {
    // 清理状态
    cancelCurrentDecode();
    
    viewAction.classList.add('active');
    viewLoading.classList.remove('active');
    viewResult.classList.remove('active');
    chrome.action.setBadgeText({ text: '' });
  }

  function showLoading(message = '正在识别二维码...') {
    viewAction.classList.remove('active');
    viewLoading.classList.add('active');
    viewResult.classList.remove('active');
    
    const loadingText = document.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = message;
    }
  }

  function showResult(data) {
    viewAction.classList.remove('active');
    viewLoading.classList.remove('active');
    viewResult.classList.add('active');
    
    if (data.isError) {
      resultIcon.textContent = '✗';
      resultIcon.classList.add('error');
      resultTitle.textContent = '识别失败';
      resultCount.textContent = '';
      resultList.innerHTML = `<div class="result-item">
        <div class="result-item-content" style="color: #ff4d4f;">${escapeHtml(data.text)}</div>
      </div>`;
    } else {
      resultIcon.textContent = '✓';
      resultIcon.classList.remove('error');
      resultTitle.textContent = '识别成功';
      
      // 处理多个结果
      const results = Array.isArray(data.text) ? data.text : [data.text];
      const validResults = results.filter(r => r && typeof r === 'string' && r.trim() !== '');
      
      resultCount.textContent = `共 ${validResults.length} 个结果`;
      
      if (validResults.length === 0) {
        resultList.innerHTML = `<div class="result-item">
          <div class="result-item-content" style="color: #ff4d4f;">未识别到有效内容</div>
        </div>`;
      } else {
        resultList.innerHTML = validResults.map((content, index) => `
          <div class="result-item" data-index="${index}">
            <div class="result-item-content">${escapeHtml(content)}</div>
            <div class="result-item-actions">
              <button class="item-btn item-btn-copy" data-content="${escapeAttr(content)}">📋 复制</button>
              ${isURL(content) ? `<button class="item-btn item-btn-open" data-url="${escapeAttr(content)}">🔗 打开链接</button>` : ''}
            </div>
          </div>
        `).join('');
        
        // 绑定每个结果项的按钮事件
        document.querySelectorAll('.result-item').forEach((item, idx) => {
          const copyBtn = item.querySelector('.item-btn-copy');
          const openBtn = item.querySelector('.item-btn-open');
          const content = validResults[idx];
          
          if (copyBtn) {
            copyBtn.addEventListener('click', () => copyToClipboard(content));
          }
          if (openBtn) {
            openBtn.addEventListener('click', () => openLink(content));
          }
        });
      }
    }
    
    chrome.action.setBadgeText({ text: '' });
  }

  function isURL(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    return /^(https?:\/\/|ftp:\/\/|file:\/\/|www\.)[^\s]+$/i.test(trimmed) || 
           /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}(:[0-9]{1,5})?(\/.*)?$/i.test(trimmed);
  }

  // 调用 background 进行解析
  async function decodeWithBackground(dataUrl) {
    return new Promise((resolve, reject) => {
      // 创建 AbortController 用于取消请求
      currentAbortController = new AbortController();
      isDecoding = true;
      
      // 设置超时
      const timeoutId = setTimeout(() => {
        if (currentAbortController) {
          currentAbortController.abort();
          reject(new Error('识别超时（30秒）'));
        }
      }, 30000);
      
      // 发送消息到 background
      chrome.runtime.sendMessage({ 
        action: 'decodeImage', 
        dataUrl: dataUrl
      }, (response) => {
        clearTimeout(timeoutId);
        
        if (!isDecoding) {
          reject(new Error('用户取消识别'));
          return;
        }
        
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
      
      // 监听取消信号
      currentAbortController.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        isDecoding = false;
        reject(new Error('用户取消识别'));
      });
    });
  }

  function cancelCurrentDecode() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    isDecoding = false;
  }

  function clearCurrentDecode() {
    currentAbortController = null;
    isDecoding = false;
  }

  function handleDecodeResult(result) {
    if (!isDecoding) return;
    
    if (result.result && !result.error) {
      // 将结果存入 storage
      chrome.storage.local.set({
        lastResult: {
          text: result.result,
          isError: false,
          timestamp: Date.now()
        }
      });
      showResult({ text: result.result, isError: false });
    } else {
      const errMsg = result.error || '未识别到二维码';
      chrome.storage.local.set({
        lastResult: {
          text: errMsg,
          isError: true,
          timestamp: Date.now()
        }
      });
      showResult({ text: errMsg, isError: true });
    }
  }

  async function copyToClipboard(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制到剪贴板');
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('已复制到剪贴板');
    }
  }

  function openLink(url) {
    if (!url) return;
    let finalUrl = url;
    if (!/^https?:\/\//i.test(url) && !/^ftp:\/\//i.test(url)) {
      finalUrl = 'https://' + url;
    }
    chrome.tabs.create({ url: finalUrl });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
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

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
});