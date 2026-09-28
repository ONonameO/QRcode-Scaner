// offscreen 文档的生命周期与自愈
import {
  OFFSCREEN_VERSION,
  OFFSCREEN_URL,
  OFFSCREEN_REASONS,
  OFFSCREEN_JUSTIFICATION
} from './config.js';
import { sleep } from '../shared/utils.js';

// 确保 offscreen 文档存在且为最新版本；版本不符则先关闭再重建
export async function ensureOffscreen() {
  try {
    const has = await chrome.offscreen.hasDocument?.() || false;
    if (has) {
      const { offscreenVersion } = await chrome.storage.local.get('offscreenVersion');
      if (offscreenVersion === OFFSCREEN_VERSION) return;
      await chrome.offscreen.closeDocument?.();
    }
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: OFFSCREEN_REASONS,
      justification: OFFSCREEN_JUSTIFICATION
    });
    await chrome.storage.local.set({ offscreenVersion: OFFSCREEN_VERSION });
  } catch (e) {
    console.warn('[QR] 创建 Offscreen Document 失败', e);
  }
}

// 强制关闭并重建 offscreen（用于本地解码无响应时自愈）
export async function recreateOffscreen() {
  try { await chrome.offscreen.closeDocument?.(); } catch (_) {}
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: OFFSCREEN_REASONS,
      justification: OFFSCREEN_JUSTIFICATION
    });
    await chrome.storage.local.set({ offscreenVersion: OFFSCREEN_VERSION });
  } catch (e) {
    console.warn('[QR] 重建 Offscreen Document 失败', e);
  }
}
