// 右键菜单：安装（父级 + 三种识别模式）与点击分发
import { decodeWithFallback } from './decode-core.js';
import { saveDecodingState, updateDecodingStateDataUrl, saveResult } from './storage-states.js';
import { fetchImageAsDataURL } from './fetch-utils.js';
import { setBadge } from '../shared/utils.js';

// 在 onInstalled 中调用：先 removeAll 避免扩展更新后重复 id
export function installContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'decodeQR', title: '识别二维码', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'decodeQR_auto', parentId: 'decodeQR', title: '自动', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'decodeQR_local', parentId: 'decodeQR', title: '本地识别', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'decodeQR_online', parentId: 'decodeQR', title: '在线识别', contexts: ['image'] });
  });
}

// 右键菜单点击分发（支持从菜单直接选择识别模式）
export async function onContextMenuClicked(info) {
  // 只处理本扩展的二维码识别菜单
  if (typeof info.menuItemId !== 'string' || !info.menuItemId.startsWith('decodeQR')) return;

  // 菜单项 id → 识别模式（父级被点击时回退到存储的默认模式）
  const modeMap = { decodeQR_auto: 'auto', decodeQR_local: 'local', decodeQR_online: 'online' };
  const mode = modeMap[info.menuItemId] || null;

  try {
    // 1. 先保存解码状态（让 popup 知道正在识别）
    await saveDecodingState(null, '正在识别二维码...');

    // 2. 立即打开 popup 显示加载页面
    chrome.action.openPopup();
    setBadge('···', '#f7d22f');

    // 3. 获取图片数据
    let dataUrl = info.srcUrl;
    if (!dataUrl || !dataUrl.startsWith('data:')) {
      dataUrl = await fetchImageAsDataURL(info.srcUrl);
    }

    // 4. 更新解码状态中的 dataUrl
    await updateDecodingStateDataUrl(dataUrl);

    // 5. 调用解码（按所选模式，本地优先失败回退草料）
    const result = await decodeWithFallback(dataUrl, mode);
    saveResult(result);
  } catch (err) {
    saveResult({ result: null, error: err.message });
  }
}
