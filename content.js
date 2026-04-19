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

  overlay.addEventListener('mousedown', (e) => {
    isDrawing = true;
    startX = e.clientX;
    startY = e.clientY;
    box.style.left = startX + 'px';
    box.style.top = startY + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  });

  overlay.addEventListener('mouseup', () => {
    isDrawing = false;
    const rect = box.getBoundingClientRect();
    overlay.remove();

    if (rect.width > 5 && rect.height > 5) {
      const dpr = window.devicePixelRatio || 1;
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
  });

  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
})();