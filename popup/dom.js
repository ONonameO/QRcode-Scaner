// popup DOM 元素映射与初始化（叶子模块：无跨 popup 依赖）
export const DOM = {
  views: { action: 'view-action', loading: 'view-loading', result: 'view-result' },
  result: { icon: 'result-icon', title: 'result-title', count: 'result-count', list: 'result-list' },
  btns: { area: 'btn-area', file: 'btn-file', clipboard: 'btn-clipboard', cancel: 'btn-cancel', back: 'btn-back' },
  fileInput: 'file-input',
  toast: 'toast'
};

export const elements = {};

export function initElements() {
  for (const [key, id] of Object.entries(DOM)) {
    if (typeof id === 'string') {
      elements[key] = document.getElementById(id);
    } else if (typeof id === 'object') {
      elements[key] = {};
      for (const [subKey, subId] of Object.entries(id)) {
        elements[key][subKey] = document.getElementById(subId);
      }
    }
  }
  elements.fileInput = document.getElementById(DOM.fileInput);
  elements.toast = document.getElementById(DOM.toast);
  elements.modeSelect = document.getElementById('mode-select');
}
