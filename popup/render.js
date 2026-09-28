// 视图控制与结果渲染（依赖 dom.js 元素、shared/utils setBadge、ui-utils 文本/链接工具）
import { elements } from './dom.js';
import { setBadge } from '../shared/utils.js';
import { escapeHtml, isURL, copyToClipboard, openLink } from './ui-utils.js';

export function showView(viewName) {
  Object.values(elements.views).forEach(view => view.classList.remove('active'));
  elements.views[viewName]?.classList.add('active');
}

export function showLoading(message = '正在识别二维码...') {
  showView('loading');
  setBadge('···', '#f7d22f');
  document.querySelector('.loading-text').textContent = message;
}

export function showAction() {
  showView('action');
  setBadge('', '');
}

// 统一结果渲染
export function renderResult(data) {
  showView('result');

  // 识别失败
  if (data.isError) {
    setBadge('! ', '#ff4d4f');
    elements.result.icon.textContent = '✗';
    elements.result.icon.classList.add('error');
    elements.result.title.textContent = '识别失败';
    elements.result.count.textContent = '';
    elements.result.list.innerHTML = `<div class="result-item">
      <div class="result-item-content" style="color:#ff4d4f;">${escapeHtml(data.text)}</div>
    </div>`;
    return;
  }

  // 处理多个结果
  const results = Array.isArray(data.text) ? data.text : [data.text];
  const validResults = results.filter(r => r?.trim());
  const count = validResults.length;

  // 0 个结果
  if (count === 0) {
    setBadge('! ', '#ff4d4f');
    elements.result.icon.textContent = '✗';
    elements.result.icon.classList.add('error');
    elements.result.title.textContent = '识别失败';
    elements.result.count.textContent = '';
    elements.result.list.innerHTML = `<div class="result-item">
      <div class="result-item-content" style="color:#ff4d4f;">未识别到有效内容</div>
    </div>`;
    return;
  }

  // 识别成功
  setBadge(count > 99 ? '99+' : count.toString(), '#07c160');
  elements.result.icon.textContent = '✓';
  elements.result.icon.classList.remove('error');
  elements.result.title.textContent = '识别成功';
  elements.result.count.textContent = `共 ${count} 个结果`;

  elements.result.list.innerHTML = validResults.map(content => `
    <div class="result-item">
      <div class="result-item-content">${escapeHtml(content)}</div>
      <div class="result-item-actions">
        <button class="item-btn item-btn-copy">📋 复制</button>
        ${isURL(content) ? '<button class="item-btn item-btn-open">🔗 打开链接</button>' : ''}
      </div>
    </div>
  `).join('');

  // 绑定按钮事件
  document.querySelectorAll('.result-item').forEach((item, idx) => {
    const content = validResults[idx];
    item.querySelector('.item-btn-copy')?.addEventListener('click', () => copyToClipboard(content));
    item.querySelector('.item-btn-open')?.addEventListener('click', () => openLink(content));
  });
}
