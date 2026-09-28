// 统一消息入口：areaSelected→截图识别；decodeImage→解码；cropImage 不处理（放行给 offscreen）。
import { handleCapture } from './capture.js';
import { decodeWithFallback } from './decode-core.js';

export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'areaSelected':
        handleCapture(request.area);
        sendResponse({ success: true });
        break;
      case 'decodeImage':
        decodeWithFallback(request.dataUrl)
          .then(result => sendResponse(result))
          .catch(err => sendResponse({ result: null, error: err.message }));
        return true; // 保持消息通道开放（异步响应）
      case 'cropImage':
        return false; // 不拦截，让消息继续流向 offscreen 处理
    }
    return false; // 未处理的 action 不占用消息通道
  });
}
