// 截图识别主流程：保存状态 → 打开 popup → 截图 →（可选裁剪）→ 解码 → 存结果
import { decodeWithFallback } from './decode-core.js';
import { ensureOffscreen } from './offscreen-manager.js';
import { saveDecodingState, updateDecodingStateDataUrl, saveResult } from './storage-states.js';
import { setBadge } from '../shared/utils.js';

export async function handleCapture(area) {
  try {
    // 1. 先保存解码状态（让 popup 知道正在识别）
    await saveDecodingState(null, '正在识别二维码...');

    // 2. 立即打开 popup 显示加载页面
    chrome.action.openPopup();
    setBadge('···', '#f7d22f');

    // 3. 截图
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    let finalDataUrl = dataUrl;

    // 4. 裁剪图片（如果需要）
    if (area && area.width > 0 && area.height > 0) {
      await ensureOffscreen();
      const cropResult = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'cropImage',
          dataUrl: dataUrl,
          area: area
        }, resolve);
      });
      if (cropResult?.success) finalDataUrl = cropResult.dataUrl;
    }

    // 5. 更新解码状态中的 dataUrl
    await updateDecodingStateDataUrl(finalDataUrl);

    // 6. 调用解码（本地优先，失败回退草料）
    const result = await decodeWithFallback(finalDataUrl);
    saveResult(result);
  } catch (err) {
    saveResult({ result: null, error: err.message });
  }
}
