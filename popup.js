document.addEventListener('DOMContentLoaded', async () => {
  const viewAction = document.getElementById('view-action');
  const viewResult = document.getElementById('view-result');
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultContent = document.getElementById('result-content');
  const btnOpen = document.getElementById('btn-open');
  const btnCopy = document.getElementById('btn-copy');
  const btnBack = document.getElementById('btn-back');
  const btnArea = document.getElementById('btn-area');
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

  btnArea.addEventListener('click', startAreaSelection);
  btnBack.addEventListener('click', () => {
    chrome.storage.local.remove('lastResult');
    showAction();
  });
  btnCopy.addEventListener('click', copyResult);
  btnOpen.addEventListener('click', openLink);

  function showAction() {
    viewAction.classList.add('active');
    viewResult.classList.remove('active');
    chrome.action.setBadgeText({ text: '' });
  }

  function showResult(data) {
    viewAction.classList.remove('active');
    viewResult.classList.add('active');
    
    resultContent.textContent = data.text;
    
    if (data.isError) {
      resultIcon.textContent = '✗';
      resultIcon.classList.add('error');
      resultTitle.textContent = '识别失败';
      btnCopy.style.display = 'none';
      btnOpen.style.display = 'none';
    } else {
      resultIcon.textContent = '✓';
      resultIcon.classList.remove('error');
      resultTitle.textContent = '识别成功';
      btnCopy.style.display = 'block';
      
      // 检测是否为URL，显示打开链接按钮
      if (isURL(data.text)) {
        btnOpen.style.display = 'block';
        btnOpen.dataset.url = data.text;
      } else {
        btnOpen.style.display = 'none';
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
    }
  }

  async function copyResult() {
    const text = resultContent.textContent;
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

  function openLink() {
    const url = btnOpen.dataset.url;
    if (!url) return;
    
    // 自动补全协议
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
});