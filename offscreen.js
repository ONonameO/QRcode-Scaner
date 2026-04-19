// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'cropImage') {
    cropImage(request.dataUrl, request.area)
      .then(result => sendResponse({ success: true, dataUrl: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 保持消息通道开放
  }
});

// 裁剪图片（在 DOM 环境中执行）
function cropImage(dataUrl, area) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = area.width;
        canvas.height = area.height;
        
        ctx.drawImage(
          img, 
          area.x, area.y, area.width, area.height,
          0, 0, area.width, area.height
        );
        
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(new Error('裁剪失败: ' + err.message));
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}