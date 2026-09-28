// 输入源：文件上传 / 剪贴板 / 框选区域（依赖 dom 元素、render 视图、decode 流程、ui-utils 工具）
import { elements } from './dom.js';
import { showLoading, showAction } from './render.js';
import { decodeWithBackground, handleDecodeResult, cancelCurrentDecode, getIsDecoding } from './decode.js';
import { fileToDataURL, blobToDataURL, validateImageBlob, showToast } from './ui-utils.js';

// ==================== 文件上传 ====================
export async function handleFileUpload(e) {
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
    if (getIsDecoding()) handleDecodeResult(result);
  } catch (err) {
    if (getIsDecoding() && err.message !== '用户取消识别') {
      handleDecodeResult({ result: null, error: err.message });
    }
  } finally {
    elements.fileInput.value = '';
    await chrome.storage.local.remove('decodingState');
  }
}

// ==================== 剪贴板 ====================
export async function handleClipboard() {
  try {
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
    if (getIsDecoding()) handleDecodeResult(result);
  } catch (err) {
    if (elements.views.loading?.classList.contains('active')) showAction();
    if (err.message !== '用户取消识别') showToast('读取剪贴板失败: ' + (err.message || '未知错误'));
  } finally {
    await chrome.storage.local.remove('decodingState');
  }
}

// ==================== 框选区域 ====================
export async function startAreaSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return showToast('无法获取当前页面');

    const blockedUrls = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];
    if (blockedUrls.some(prefix => tab.url.startsWith(prefix))) {
      return showToast('无法在浏览器内部页面使用框选功能\n请在其他网页上使用');
    }

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['popup/content.js'] });
    await chrome.tabs.sendMessage(tab.id, { action: 'startAreaSelection' });
    window.close();
  } catch (err) {
    showToast('启动框选失败: ' + (err.message || '未知错误'));
  }
}
