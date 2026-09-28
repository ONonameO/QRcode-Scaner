// offscreen document 消息路由（ESM）
// 负责：1) 裁剪图片（DOM 环境） 2) 本地离线解码（zxing-wasm + Canvas 预处理）
import { decodeOffline } from './qr-decoder.js';
import { dataURLToBlob } from '../shared/utils.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 本地离线解码
  if (request.action === 'decodeOffline') {
    decodeOffline(dataURLToBlob(request.dataUrl))
      .then((texts) => {
        console.log('[QR-offscreen] 本地解码完成，识别到', texts.length, '条');
        sendResponse({ texts });
      })
      .catch((err) => {
        console.error('[QR-offscreen] 本地解码异常', err);
        sendResponse({ texts: [], error: err.message });
      });
    return true; // 保持消息通道开放
  }

  // 裁剪图片（在 DOM 环境中执行）
  if (request.action === 'cropImage') {
    cropImage(request.dataUrl, request.area)
      .then((result) => sendResponse({ success: true, dataUrl: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // 保持消息通道开放
  }
});

// 裁剪图片（在 DOM 环境中执行）
function cropImage(dataUrl, area) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        canvas.width = area.width;
        canvas.height = area.height;

        ctx.drawImage(
          img,
          area.x, area.y, area.width, area.height,
          0, 0, area.width, area.height
        );

        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(new Error('裁剪失败: ' + err.message));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}
