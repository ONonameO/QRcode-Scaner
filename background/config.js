// 全局常量集中管理

export const CAOLIAO_API = 'https://api.2dcode.biz/v1/read-qr-code';

// 每次修改 offscreen 相关逻辑（offscreen.js / qr-decoder.js / libs）后请把此版本号 +1，
// 以便扩展重载后强制重建 offscreen，避免使用陈旧（旧代码）的 offscreen 实例。
export const OFFSCREEN_VERSION = 2;
export const OFFSCREEN_URL = 'offscreen/offscreen.html';
export const OFFSCREEN_REASONS = ['DOM_PARSER', 'IFRAME_SCRIPTING', 'BLOBS'];
export const OFFSCREEN_JUSTIFICATION =
  '需要在 DOM 环境中裁剪图片，并用 Canvas + zxing-wasm 做本地离线解码';

// 识别模式默认值：'auto'(本地优先失败回退草料) / 'local'(仅本地) / 'online'(仅草料)
export const DEFAULT_MODE = 'auto';
