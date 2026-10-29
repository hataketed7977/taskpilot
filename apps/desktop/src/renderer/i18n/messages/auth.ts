export const authMessages = {
  en: {
  skip: "Skip to main content",
  region: "Account access",
  security: "Secure sign-in",
  brandEyebrow: "People and agents, moving work on one board",
  brandTitleLine1: "Don’t just track work.",
  brandTitleLine2: "Let Agents move it forward.",
  brandCopy:
    "Shape your board, assign people and Agents, inspect execution, and step in at key decisions—from task creation to delivered result.",
  brandPointIdentity: "Secure identity",
  brandPointVisibility: "Visible execution",
  brandPointControl: "Human control",
  checkingTitle: "Checking sign-in availability",
  checkingStatus: "Checking GitHub sign-in configuration…",
  unavailableTitle: "GitHub sign-in is not configured",
  unavailableOffline:
    "Unable to read sign-in configuration. Check your network and try again.",
  unavailableConfig:
    "GitHub sign-in is not enabled in this development environment.",
  recheck: "Check again",
  title: "Sign in to TaskPilot",
  description:
    "Verify your identity with GitHub. Existing identities sign in directly; new identities only need to confirm account details once.",
  opening: "Opening GitHub…",
  signIn: "Sign in with GitHub",
  openingBrowser: "Opening your system browser…",
  footnote:
    "Authorization is completed in your system browser. TaskPilot never receives your GitHub password or repository permissions.",
  browserTitle: "Continue in your browser",
  browserCompletion:
    "Waiting for the browser to securely finish sign-in…",
  browserWaiting: "Waiting for you to finish GitHub authorization…",
  cancelling: "Cancelling…",
  cancel: "Cancel sign-in",
  completeTitle: "Sign-in complete",
  entering: "Opening TaskPilot…",
  terminal: {
    denied: {
      title: "GitHub authorization was not completed",
      detail:
        "GitHub did not authorize this sign-in. You can start again.",
    },
    cancelled: {
      title: "GitHub sign-in cancelled",
      detail: "This sign-in was safely cancelled.",
    },
    expired: {
      title: "Sign-in request expired",
      detail:
        "The previous request is no longer valid. Start sign-in again.",
    },
    failed: {
      title: "Unable to complete GitHub sign-in",
      detail: "Authentication did not complete. Please start again.",
    },
    resultUnavailable: {
      title: "Sign-in result is no longer available",
      detail: "This sign-in result cannot be reused. Please start again.",
    },
  },
  issue: {
    offline: {
      title: "Temporarily unable to connect",
      detail:
        "Your sign-in progress is still safely preserved. Check your network and try again.",
    },
    expired: {
      title: "Sign-in request expired",
      detail:
        "The previous request is no longer valid. Start sign-in again.",
    },
    unable: {
      title: "Unable to complete GitHub sign-in",
      detail:
        "Authentication could not be completed securely. Please start again.",
    },
  },
},
  "zh-CN": {
  skip: "跳到主要内容",
  region: "账号访问",
  security: "安全登录",
  brandEyebrow: "人和 Agent，在同一块看板上协作",
  brandTitleLine1: "不只管理任务，",
  brandTitleLine2: "让 Agent 真正推进任务。",
  brandCopy:
    "自定义看板，分配人与 Agent，随时查看执行过程，并在关键节点做出决定——从任务创建到结果交付，都在一个地方完成。",
  brandPointIdentity: "身份安全",
  brandPointVisibility: "过程可见",
  brandPointControl: "随时干预",
  checkingTitle: "正在检查登录能力",
  checkingStatus: "正在检查 GitHub 登录配置…",
  unavailableTitle: "GitHub 登录尚未配置",
  unavailableOffline: "无法读取登录配置，请检查网络后重试。",
  unavailableConfig: "当前开发环境尚未启用 GitHub 登录。",
  recheck: "重新检查",
  title: "登录 TaskPilot",
  description:
    "使用 GitHub 验证身份。已有身份会直接登录，新身份只需确认一次账号资料。",
  opening: "正在打开 GitHub…",
  signIn: "使用 GitHub 登录",
  openingBrowser: "正在打开系统浏览器…",
  footnote:
    "授权将在系统浏览器中完成。TaskPilot 不会获得你的 GitHub 密码或仓库权限。",
  browserTitle: "在浏览器中继续",
  browserCompletion: "等待浏览器安全完成登录…",
  browserWaiting: "等待你在浏览器完成 GitHub 授权…",
  cancelling: "正在取消…",
  cancel: "取消登录",
  completeTitle: "登录已完成",
  entering: "正在进入 TaskPilot…",
  terminal: {
    denied: {
      title: "未完成 GitHub 授权",
      detail: "GitHub 未授权本次登录。你可以重新开始。",
    },
    cancelled: {
      title: "已取消 GitHub 登录",
      detail: "本次登录已安全取消。",
    },
    expired: {
      title: "登录请求已过期",
      detail: "旧请求已失效，请重新开始登录。",
    },
    failed: {
      title: "无法完成 GitHub 登录",
      detail: "身份验证没有完成，请重新开始。",
    },
    resultUnavailable: {
      title: "登录结果已失效",
      detail: "本次登录结果不可再使用，请重新开始。",
    },
  },
  issue: {
    offline: {
      title: "暂时无法连接",
      detail: "登录进度仍安全保留。请检查网络后重试。",
    },
    expired: {
      title: "登录请求已过期",
      detail: "旧请求已失效，请重新开始登录。",
    },
    unable: {
      title: "无法完成 GitHub 登录",
      detail: "无法安全完成身份验证，请重新开始。",
    },
  },
},
} as const;
