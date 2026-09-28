// popup 入口：DOM 装配、状态恢复、事件绑定、识别模式开关
import { initElements, elements } from './dom.js';
import { showView, renderResult } from './render.js';
import { cancelDecode, backToAction } from './decode.js';
import { startAreaSelection, handleFileUpload, handleClipboard } from './sources.js';

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  initElements();

  // 监听 storage 变化，自动更新结果
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
      if (changes.lastResult) {
        const newResult = changes.lastResult.newValue;
        if (newResult && !changes.decodingState) {
          renderResult(newResult);
        }
      }
      if (changes.decodingState && !changes.decodingState.newValue) {
        const { lastResult } = await chrome.storage.local.get('lastResult');
        if (lastResult) renderResult(lastResult);
      }
    }
  });

  // 恢复状态
  const { decodingState, lastResult } = await chrome.storage.local.get(['decodingState', 'lastResult']);

  if (decodingState?.isDecoding && (Date.now() - decodingState.timestamp < 60000)) {
    showView('loading');
  } else if (lastResult && (Date.now() - lastResult.timestamp < 300000)) {
    renderResult(lastResult);
  } else {
    showView('action');
    await chrome.storage.local.remove(['lastResult', 'decodingState']);
  }

  // 绑定事件
  elements.btns.area?.addEventListener('click', startAreaSelection);
  elements.btns.file?.addEventListener('click', () => elements.fileInput.click());
  elements.btns.clipboard?.addEventListener('click', handleClipboard);
  elements.btns.cancel?.addEventListener('click', cancelDecode);
  elements.btns.back?.addEventListener('click', backToAction);
  elements.fileInput?.addEventListener('change', handleFileUpload);

  // 识别模式开关（下拉选择框）
  await initDecodeMode();
  elements.modeSelect?.addEventListener('change', onModeChange);
});

// ==================== 识别模式开关（下拉选择框） ====================
async function initDecodeMode() {
  const { decodeMode } = await chrome.storage.local.get('decodeMode');
  setActiveMode(decodeMode === 'local' || decodeMode === 'online' ? decodeMode : 'auto');
}

function setActiveMode(mode) {
  if (!elements.modeSelect) return;
  elements.modeSelect.value = mode;
}

async function onModeChange(e) {
  const mode = e.target.value;
  await chrome.storage.local.set({ decodeMode: mode });
}
