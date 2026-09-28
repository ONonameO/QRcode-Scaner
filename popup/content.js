(function () {
  if (document.getElementById('qr-selector-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'qr-selector-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.25); z-index: 2147483647;
    cursor: crosshair; user-select: none;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    position: absolute; border: 2px dashed #00ff88;
    background: rgba(0,255,136,0.15); display: none;
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  let startX, startY, isDrawing = false;

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startAreaSelection') {
      startSelection();
      sendResponse({ success: true });
    }
    return true;
  });

  function startSelection() {
    // 重置状态
    isDrawing = false;
    box.style.display = 'none';
    
    // 重新绑定事件
    overlay.addEventListener('mousedown', onMouseDown);
    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup', onMouseUp);
    
    // ESC 键取消
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function onMouseDown(e) {
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = startX + 'px';
    box.style.top = startY + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';
  }

  function onMouseMove(e) {
    if (!isDrawing) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  }

  function onMouseUp(e) {
    if (!isDrawing) {
      cleanup();
      return;
    }
    
    isDrawing = false;
    const rect = box.getBoundingClientRect();
    cleanup();

    if (rect.width > 5 && rect.height > 5) {
      const dpr = window.devicePixelRatio || 1;
      // 发送到 background
      chrome.runtime.sendMessage({
        action: 'areaSelected',
        area: {
          x: Math.round(rect.left * dpr),
          y: Math.round(rect.top * dpr),
          width: Math.round(rect.width * dpr),
          height: Math.round(rect.height * dpr)
        }
      });
    }
  }

  function cleanup() {
    if (overlay && overlay.parentNode) {
      overlay.removeEventListener('mousedown', onMouseDown);
      overlay.removeEventListener('mousemove', onMouseMove);
      overlay.removeEventListener('mouseup', onMouseUp);
      overlay.remove();
    }
  }
})();