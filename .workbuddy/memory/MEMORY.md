# 项目长期记忆：QRcode-Scaner

## 架构要点
- 解码统一入口在 `background.js`：`decodeWithFallback(dataUrl)` —— 读 `decodeMode`（auto/local/online，存 `chrome.storage.local.decodeMode`），本地优先，失败回退草料 API。
- 本地离线解码在 **offscreen document** 执行（`offscreen.js` 已是 ESM）；`qr-decoder.js` 用 Canvas 预处理 + `zxing-wasm` 解码。background 与 offscreen 通过 `chrome.runtime.sendMessage({action:'decodeOffline'})` 桥接。
- 结果对象统一含 `source: 'local' | 'api'`，popup 据此显示「本地识别 / 在线识别（草料）」标签。

## 关键坑（务必记住）
- `zxing-wasm` 默认 `locateFile` 对 `zxing_reader.wasm` 会回退到 **jsdelivr CDN**，裸 ESM 下无法离线。必须运行时用 `chrome.runtime.getURL('libs/zxing_reader.wasm')` 取 wasm，再以 `wasmBinary` 注入 `readBarcodesFromImageFile`，否则会联网/加载失败。
- **MV3 扩展里用 vendored WASM（如 zxing-wasm）必须在 manifest 放行，但 `extension_pages` CSP 不接受 `'wasm-eval'` 关键字**（Chrome 会报 `Insecure CSP value "'wasm-eval'"` 且根本加载不了扩展）。扩展页只允许 `'self'` 与 `'unsafe-eval'`，所以要用：
  ```json
  "content_security_policy": { "extension_pages": "script-src 'self' 'unsafe-eval'; object-src 'self'" }
  ```
  （`unsafe-eval` 比 `wasm-eval` 更宽松——会同时放开 JS eval，但因 offscreen/popup 都是扩展自有静态页、代码可控，对本地工具风险可接受。）offscreen 文档属 extension_pages，wasm 编译就发生在其中。
- **offscreen 实例必须随代码更新而重建**：`chrome.offscreen.createDocument` 只创建一次且实例不会因改文件而自动重载。务必用版本号（存 `chrome.storage.local.offscreenVersion`）+ 无响应时 `recreateOffscreen()` 自愈，否则旧 offscreen 没有新监听器 → 本地解码全体静默失败/回退。
- **二值化阈值绝不能用 `lum === 0`**（参考 demo 的写法也别照抄）。真实截图/照片暗模块很少恰好为 0，会把二维码整体置白。用 `lum < 128` 全局阈值（zxing 的 `tryHarder` 已做大量内部预处理，外部二值化只是兜底）。
- vendored 文件来自 `zxing-wasm@3.1.4`：`dist/es/reader/index.js` → `libs/reader/index.js`，`dist/es/share.js` → `libs/share.js`，`dist/reader/zxing_reader.wasm` → `libs/zxing_reader.wasm`。`index.js` 仅依赖 `../share.js`；wasm 在工厂函数 `w()` 内懒实例化，import 期不会崩溃。

## 约定
- 项目为纯静态零构建（MV3），新增第三方能力优先 vendoring 而非引入打包器。
- popup 的识别流程结果既由 background 存 `lastResult`，也由 popup `handleDecodeResult` 本地存；二者格式需保持一致（含 source）。
