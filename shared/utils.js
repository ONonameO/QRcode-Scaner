// 跨边界共享纯函数（SW / popup / offscreen 均可 import）
// 仅依赖 chrome.action 与全局 atob，无任何 DOM 或页面专属逻辑。

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// dataURL -> Blob（统一大小写命名，避免 background 与 qr-decoder 各写一份）
export function dataURLToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// 设置角标（background 与 popup 共用同一实现）
export function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}
