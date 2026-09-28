// 识别模式与解码策略（不直接碰存储，仅返回结果对象）
import { ensureOffscreen, recreateOffscreen } from './offscreen-manager.js';
import { dataURLToBlob, sleep } from '../shared/utils.js';
import { CAOLIAO_API, DEFAULT_MODE } from './config.js';

// 读取存储的识别模式，非法/缺失则回退默认
export async function getDecodeMode() {
  const { decodeMode } = await chrome.storage.local.get('decodeMode');
  return decodeMode === 'local' || decodeMode === 'online' ? decodeMode : DEFAULT_MODE;
}

// 本地离线解码（background -> offscreen 桥接）。
// 防 offscreen 尚未就绪：首次失败重试一次；若仍无响应（offscreen 陈旧/未加载），
// 强制重建 offscreen 后再试一次（自愈）。
export async function decodeOffline(dataUrl) {
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

// 统一解码入口：本地优先，按模式决定是否回退草料 API。
// modeOverride 存在时（右键菜单指定）优先使用，否则读取存储的默认模式。
export async function decodeWithFallback(dataUrl, modeOverride) {
  const mode = modeOverride || await getDecodeMode();

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
    return { result: null, error: '本地识别失败', source: 'local' };
  }

  // 自动模式：本地失败 -> 回退草料 API
  const r = await decodeWithCaoliaoAPI(dataUrl);
  r.source = 'api';
  return r;
}

// 草料二维码 API 解码（在线兜底）
export async function decodeWithCaoliaoAPI(dataUrl) {
  const blob = dataURLToBlob(dataUrl);
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
