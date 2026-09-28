// 后台 Service Worker 入口：装配所有监听器并触发启动自检
import { ensureOffscreen } from './offscreen-manager.js';
import { installContextMenus, onContextMenuClicked } from './context-menu.js';
import { registerMessageRouter } from './message-router.js';
import { initResultExpiry } from './storage-states.js';

// 安装 / 更新时：重建右键菜单并确保 offscreen 就绪
chrome.runtime.onInstalled.addListener(() => {
  installContextMenus();
  ensureOffscreen();
});

// 启动自检
ensureOffscreen();

// 注册右键菜单点击分发
chrome.contextMenus.onClicked.addListener(onContextMenuClicked);

// 注册消息路由
registerMessageRouter();

// 启动结果过期清理
initResultExpiry();
