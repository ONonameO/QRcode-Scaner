// popup 纯 UI 工具（叶子模块，仅依赖 DOM / 全局 API，无跨 popup 依赖）

export function isURL(str) {
  if (!str?.trim()) return false;
  const trimmed = str.trim();
  return /^(https?:\/\/|ftp:\/\/|file:\/\/|www\.)/i.test(trimmed) ||
         /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i.test(trimmed);
}

export async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板');
  }
}

export function openLink(url) {
  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) finalUrl = 'https://' + url;
  chrome.tabs.create({ url: finalUrl });
}

export function showToast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1500);
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function validateImageBlob(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.width > 0 && img.height > 0); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
    img.src = url;
    setTimeout(() => { URL.revokeObjectURL(url); resolve(false); }, 3000);
  });
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}
