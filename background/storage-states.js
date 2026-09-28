// 解码状态管理 + 结果存储 + 5 分钟过期清理
import { setBadge } from '../shared/utils.js';

const EXPIRE_MS = 300000; // 5 分钟

// ==================== 解码状态 ====================
export async function saveDecodingState(dataUrl, message) {
  await chrome.storage.local.set({
    decodingState: {
      isDecoding: true,
      dataUrl: dataUrl,
      message: message,
      timestamp: Date.now()
    }
  });
}

export async function updateDecodingStateDataUrl(dataUrl) {
  const { decodingState } = await chrome.storage.local.get('decodingState');
  if (decodingState) {
    await chrome.storage.local.set({
      decodingState: { ...decodingState, dataUrl: dataUrl }
    });
  }
}

export async function clearDecodingState() {
  await chrome.storage.local.remove('decodingState');
}

// ==================== 结果存储 ====================
let expireTimer = null;

export async function saveResult({ result, error, source }) {
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

  // 清除解码状态并触发 storage 变化（让 popup 自动刷新）
  await clearDecodingState();
  chrome.storage.local.get('lastResult', () => {});
}

export async function storeResult(text, isError, source) {
  await chrome.storage.local.set({
    lastResult: { text, isError, source: source || 'api', timestamp: Date.now() }
  });
}

// ==================== 过期清理 ====================
async function checkAndClearExpiredResult() {
  const { lastResult } = await chrome.storage.local.get('lastResult');
  if (lastResult && (Date.now() - lastResult.timestamp >= EXPIRE_MS)) {
    await chrome.storage.local.remove('lastResult');
    setBadge('');
    console.log('[QR] 识别结果已过期，角标已清除');
  }
}

// 初始化过期清理：定时检查 + 结果写入时预约一次性清理
export function initResultExpiry() {
  setInterval(() => { checkAndClearExpiredResult(); }, 30000);
  checkAndClearExpiredResult();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.lastResult) {
      const newResult = changes.lastResult.newValue;
      if (newResult) {
        const elapsed = Date.now() - newResult.timestamp;
        const remaining = Math.max(0, EXPIRE_MS - elapsed);
        setTimeout(async () => {
          const { lastResult: currentResult } = await chrome.storage.local.get('lastResult');
          if (currentResult && currentResult.timestamp === newResult.timestamp) {
            await chrome.storage.local.remove('lastResult');
            setBadge('');
            console.log('[QR] 识别结果已过期（定时器），角标已清除');
          }
        }, remaining);
      }
    }
  });
}
