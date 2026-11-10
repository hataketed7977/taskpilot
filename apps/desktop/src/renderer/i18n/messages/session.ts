export const sessionMessages = {
  en: {
  logoutCleanupWarning: "Local sign-out cleanup could not be confirmed. Restarting this app may restore your previous session. Sign in again to replace it.",
  dismissLogoutWarning: "Dismiss sign-out warning",
  restoring: "Restoring your session…",
  unavailableTitle: "Temporarily unable to connect",
  unavailableDetail:
    "Your sign-in information remains safely stored on this device.",
},
  "zh-CN": {
  logoutCleanupWarning: "未能确认本地退出清理完成。重启应用可能恢复上一会话，重新登录可替换它。",
  dismissLogoutWarning: "关闭退出提示",
  restoring: "正在恢复会话…",
  unavailableTitle: "暂时无法连接",
  unavailableDetail: "你的登录信息仍安全保存在此设备上。",
},
} as const;
