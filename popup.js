document.addEventListener('DOMContentLoaded', async () => {
  const viewAction = document.getElementById('view-action');
  const viewResult = document.getElementById('view-result');
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultCount = document.getElementById('result-count');
  const resultList = document.getElementById('result-list');
  const btnBack = document.getElementById('btn-back');
  const btnArea = document.getElementById('btn-area');
  const btnFile = document.getElementById('btn-file');
  const btnClipboard = document.getElementById('btn-clipboard');
  const fileInput = document.getElementById('file-input');
  const toast = document.getElementById('toast');

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
  btnArea.addEventListener('click', startAreaSelection);
  
  // 上传图片
  btnFile.addEventListener('click', () => {
    fileInput.click();
  });
  
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showToast('正在解析...');
    
    try {
      const dataUrl = await fileToDataURL(file);
      const result = await decodeWithBackground(dataUrl);
      handleDecodeResult(result);
    } catch (err) {
      handleDecodeResult({ result: null, error: err.message });
    } finally {
      fileInput.value = ''; // 清空，允许重新选择同一文件
    }
  });
  
  // 读取剪贴板图片
  btnClipboard.addEventListener('click', async () => {
    try {
      // 检查剪贴板权限
      const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
      
      if (permissionStatus.state === 'denied') {
        showToast('没有剪贴板读取权限');
        return;
      }
      
      showToast('正在读取剪贴板...');
      const clipboardItems = await navigator.clipboard.read();
      
      let imageFound = false;
      for (const item of clipboardItems) {
        const imageTypes = item.types.filter(type => type.startsWith('image/'));
        
        for (const type of imageTypes) {
          const blob = await item.getType(type);
          if (blob && blob.type.startsWith('image/')) {
            const dataUrl = await blobToDataURL(blob);
            showToast('正在解析图片...');
            const result = await decodeWithBackground(dataUrl);
            handleDecodeResult(result);
            imageFound = true;
            break;
          }
        }
        if (imageFound) break;
      }
      
      if (!imageFound) {
        showToast('剪贴板中没有图片');
      }
    } catch (err) {
      console.error('读取剪贴板失败:', err);
      if (err.name === 'NotAllowedError') {
        showToast('请先在浏览器设置中允许读取剪贴板权限');
      } else {
        showToast('读取剪贴板失败: ' + (err.message || '未知错误'));
      }
    }
  });
  
  btnBack.addEventListener('click', () => {
    chrome.storage.local.remove('lastResult');
    showAction();
  });

  function showAction() {
    viewAction.classList.add('active');
    viewResult.classList.remove('active');
    chrome.action.setBadgeText({ text: '' });
  }

  function showResult(data) {
    viewAction.classList.remove('active');
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

  async function startAreaSelection() {
    try {
      await chrome.runtime.sendMessage({ action: 'startAreaSelection' });
      window.close();
    } catch (err) {
      console.error('启动框选失败:', err);
      showToast('启动框选失败');
    }
  }

  // 调用 background 进行解析
  async function decodeWithBackground(dataUrl) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ 
        action: 'decodeImage', 
        dataUrl: dataUrl 
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ result: null, error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }

  function handleDecodeResult(result) {
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