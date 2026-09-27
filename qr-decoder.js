// 本地离线二维码解码模块（运行于 offscreen document）
// 替代 decode.mjs 中的 sharp 预处理：使用 Canvas 做灰度 / 最近邻放大 / 二值化，
// 再用 zxing-wasm 解码。wasm 由扩展自托管，通过 wasmBinary 注入，完全离线、不依赖 CDN。

import { readBarcodesFromImageFile } from './libs/reader/index.js';

let wasmCache = null;

// 加载并缓存 wasm（仅首次）
async function loadWasm() {
  if (wasmCache) return wasmCache;
  const url = chrome.runtime.getURL('libs/zxing_reader.wasm');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('wasm 加载失败: HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  wasmCache = new Uint8Array(buf);
  return wasmCache;
}

// dataURL -> Blob
function dataURLToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// 加载图片为 Image 对象
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

// 与 decode.mjs 一致的预处理：灰度 -> 最近邻放大 -> 二值化（仅纯黑保留黑，其余置白）
async function preprocessViaCanvas(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const minSide = Math.min(img.width, img.height);
    let scale = 1;
    // 二维码模块太小时放大，能显著提升识别率（与 demo 一致）
    if (minSide > 0 && minSide < 300) scale = Math.ceil(300 / minSide);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false; // 最近邻，保留硬边缘
    ctx.drawImage(img, 0,0, canvas.width, canvas.height);

    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < src.data.length; i += 4) {
      const lum = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
      // 全局阈值二值化（注意：不能用 lum === 0，真实截图/照片的暗模块很少恰好为 0，
      // 会导致二维码被整体置白而无法识别）。128 为标准阈值，适配绝大多数浅底二维码。
      const v = lum < 1 ? 0 : 255;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 从解码结果中提取有效文本（去空、去重），与 demo 的 r.text 对齐
function pickTexts(results) {
  if (!results || !results.length) return [];
  return results
    .filter((r) => r && r.isValid !== false && r.text && String(r.text).trim() !== '')
    .map((r) => String(r.text).trim())
    .filter((t, i, a) => a.indexOf(t) === i);
}

// 离线解码入口：先原图，失败再用预处理图重试（与 demo 顺序一致）
export async function decodeOffline(blob) {
  const wasm = await loadWasm();
  const opts = { formats: ['QRCode'], tryHarder: true, wasmBinary: wasm };

  let res = await readBarcodesFromImageFile(blob, opts);
  let texts = pickTexts(res);
  if (texts.length > 0) return texts;

  const processed = await preprocessViaCanvas(blob);
  if (processed) {
    res = await readBarcodesFromImageFile(processed, opts);
    texts = pickTexts(res);
  }
  return texts;
}

// 供 offscreen.js 直接使用
export { dataURLToBlob };
