// 解码流程（依赖 render 视图与 ui-utils 提示）
import { renderResult, showAction } from './render.js';
import { showToast } from './ui-utils.js';

let currentAbortController = null;
let isDecoding = false;

export const getIsDecoding = () => isDecoding;

export function decodeWithBackground(dataUrl) {
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

export function cancelCurrentDecode() {
  currentAbortController?.abort();
  currentAbortController = null;
  isDecoding = false;
}

export async function cancelDecode() {
  cancelCurrentDecode();
  await chrome.storage.local.remove('decodingState');
  showToast('已取消识别');
  showAction();
}

export async function backToAction() {
  cancelCurrentDecode();
  await chrome.storage.local.remove(['decodingState', 'lastResult']);
  showAction();
}

export function handleDecodeResult(result) {
  if (!isDecoding) return;
  const source = result.source || 'api';

  if (result.result && !result.error) {
    chrome.storage.local.set({
      lastResult: { text: result.result, isError: false, source, timestamp: Date.now() }
    });
    renderResult({ text: result.result, isError: false, source });
  } else {
    const errMsg = result.error || '未识别到二维码';
    chrome.storage.local.set({
      lastResult: { text: errMsg, isError: true, source, timestamp: Date.now() }
    });
    renderResult({ text: errMsg, isError: true, source });
  }
}

export async function continueDecode(dataUrl) {
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
