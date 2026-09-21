export type DevMoterLanguage = "en" | "ja" | "zh-CN";

const STORAGE_KEY = "devmoter-language";

type TranslationSet = Record<DevMoterLanguage, string>;

const dictionary: Record<string, TranslationSet> = {
  "閉じる": { en: "Close", ja: "閉じる", "zh-CN": "关闭" },
  "新しいチャット": { en: "New chat", ja: "新しいチャット", "zh-CN": "新建对话" },
  "チャットを検索": { en: "Search chats", ja: "チャットを検索", "zh-CN": "搜索对话" },
  "ライブラリ": { en: "Library", ja: "ライブラリ", "zh-CN": "资料库" },
  "モデル": { en: "Models", ja: "モデル", "zh-CN": "模型" },
  "プラグイン": { en: "Plugins", ja: "プラグイン", "zh-CN": "插件" },
  "エージェント": { en: "Agents", ja: "エージェント", "zh-CN": "智能体" },
  "エージェントを選択": { en: "Select agent", ja: "エージェントを選択", "zh-CN": "选择智能体" },
  "最近": { en: "Recent", ja: "最近", "zh-CN": "最近" },
  "読み込み中…": { en: "Loading…", ja: "読み込み中…", "zh-CN": "加载中…" },
  "メニュー": { en: "Menu", ja: "メニュー", "zh-CN": "菜单" },
  "モデルを選択": { en: "Select model", ja: "モデルを選択", "zh-CN": "选择模型" },
  "推論性能を選択": { en: "Select reasoning", ja: "推論性能を選択", "zh-CN": "选择推理强度" },
  "使用量": { en: "Usage", ja: "使用量", "zh-CN": "用量" },
  "何を作ろうか？": { en: "What do you want to build?", ja: "何を作ろうか？", "zh-CN": "想做什么？" },
  "CodexをChromebookで動かしたまま、ここから操作できます。": {
    en: "Keep Codex running on your Chromebook and control it from here.",
    ja: "CodexをChromebookで動かしたまま、ここから操作できます。",
    "zh-CN": "让 Codex 继续在 Chromebook 上运行，并从这里进行控制。"
  },
  "許可が必要です": { en: "Permission required", ja: "許可が必要です", "zh-CN": "需要权限" },
  "拒否": { en: "Deny", ja: "拒否", "zh-CN": "拒绝" },
  "今回だけ": { en: "Allow once", ja: "今回だけ", "zh-CN": "仅本次允许" },
  "セッション中は許可": { en: "Allow for session", ja: "セッション中は許可", "zh-CN": "本次会话允许" },
  "オフライン": { en: "Offline", ja: "オフライン", "zh-CN": "离线" },
  "Codexにメッセージ": { en: "Message Codex", ja: "Codexにメッセージ", "zh-CN": "给 Codex 发消息" },
  "Codexへのメッセージ": { en: "Message to Codex", ja: "Codexへのメッセージ", "zh-CN": "给 Codex 的消息" },
  "追加": { en: "Add", ja: "追加", "zh-CN": "添加" },
  "深く思考": { en: "Think deeply", ja: "深く思考", "zh-CN": "深度思考" },
  "音声入力": { en: "Voice input", ja: "音声入力", "zh-CN": "语音输入" },
  "送信": { en: "Send", ja: "送信", "zh-CN": "发送" },
  "画像送信": { en: "Send image", ja: "画像送信", "zh-CN": "发送图片" },
  "画像": { en: "Image", ja: "画像", "zh-CN": "图片" },
  "ファイル": { en: "File", ja: "ファイル", "zh-CN": "文件" },
  "設定": { en: "Settings", ja: "設定", "zh-CN": "设置" },
  "リモート": { en: "Remote", ja: "リモート", "zh-CN": "远程" },
  "DevMoter接続情報": { en: "DevMoter connection info", ja: "DevMoter接続情報", "zh-CN": "DevMoter 连接信息" },
  "このブラウザは音声入力に未対応です": {
    en: "Voice input is not supported in this browser",
    ja: "このブラウザは音声入力に未対応です",
    "zh-CN": "此浏览器不支持语音输入"
  },
  "音声入力に失敗しました": { en: "Voice input failed", ja: "音声入力に失敗しました", "zh-CN": "语音输入失败" },
  "プロジェクト": { en: "Projects", ja: "プロジェクト", "zh-CN": "项目" },
  "Codexの作業ディレクトリとMarkdownを管理します。": {
    en: "Manage Codex working directories and Markdown files.",
    ja: "Codexの作業ディレクトリとMarkdownを管理します。",
    "zh-CN": "管理 Codex 的工作目录和 Markdown 文件。"
  },
  "DevMoterに保存された素材と添付ファイル": {
    en: "Saved assets and attachments in DevMoter",
    ja: "DevMoterに保存された素材と添付ファイル",
    "zh-CN": "DevMoter 中保存的素材和附件"
  },
  "New session": { en: "New session", ja: "新しいセッション", "zh-CN": "新建会话" },
  "Search sessions": { en: "Search sessions", ja: "セッションを検索", "zh-CN": "搜索会话" },
  "Agents": { en: "Agents", ja: "エージェント", "zh-CN": "智能体" },
  "Commands": { en: "Commands", ja: "コマンド", "zh-CN": "命令" },
  "Skills": { en: "Skills", ja: "スキル", "zh-CN": "技能" },
  "Models": { en: "Models", ja: "モデル", "zh-CN": "模型" },
  "Codex UI": { en: "Codex UI", ja: "Codex UI", "zh-CN": "Codex 界面" },
  "SESSIONS": { en: "SESSIONS", ja: "セッション", "zh-CN": "会话" },
  "Connecting…": { en: "Connecting…", ja: "接続中…", "zh-CN": "正在连接…" },
  "Refresh": { en: "Refresh", ja: "更新", "zh-CN": "刷新" },
  "No session": { en: "No session", ja: "セッションなし", "zh-CN": "无会话" },
  "What do you want to build?": { en: "What do you want to build?", ja: "何を作ろうか？", "zh-CN": "想做什么？" },
  "OpenCode is running on your Chromebook.": {
    en: "OpenCode is running on your Chromebook.",
    ja: "OpenCodeはChromebook上で動作しています。",
    "zh-CN": "OpenCode 正在 Chromebook 上运行。"
  },
  "Plan first": { en: "Plan first", ja: "まず計画", "zh-CN": "先规划" },
  "Start building": { en: "Start building", ja: "実装を始める", "zh-CN": "开始构建" },
  "/ commands": { en: "/ commands", ja: "/ コマンド", "zh-CN": "/ 命令" },
  "PERMISSION REQUIRED": { en: "PERMISSION REQUIRED", ja: "許可が必要です", "zh-CN": "需要权限" },
  "OpenCode wants permission": { en: "OpenCode wants permission", ja: "OpenCodeが許可を求めています", "zh-CN": "OpenCode 请求权限" },
  "Reject": { en: "Reject", ja: "拒否", "zh-CN": "拒绝" },
  "Allow once": { en: "Allow once", ja: "今回だけ許可", "zh-CN": "仅本次允许" },
  "Always allow": { en: "Always allow", ja: "常に許可", "zh-CN": "始终允许" },
  "OPENCode QUESTION": { en: "OPENCODE QUESTION", ja: "OPENCODEからの質問", "zh-CN": "OPENCODE 提问" },
  "Question": { en: "Question", ja: "質問", "zh-CN": "问题" },
  "Type another answer…": { en: "Type another answer…", ja: "別の回答を入力…", "zh-CN": "输入其他答案…" },
  "Skip": { en: "Skip", ja: "スキップ", "zh-CN": "跳过" },
  "Submit": { en: "Submit", ja: "送信", "zh-CN": "提交" },
  "Plan": { en: "Plan", ja: "計画", "zh-CN": "规划" },
  "Build": { en: "Build", ja: "実装", "zh-CN": "构建" },
  "agent": { en: "agent", ja: "エージェント", "zh-CN": "智能体" },
  "model": { en: "model", ja: "モデル", "zh-CN": "模型" },
  "Message OpenCode…": { en: "Message OpenCode…", ja: "OpenCodeにメッセージ…", "zh-CN": "给 OpenCode 发消息…" },
  "OpenCodeへの指示": { en: "Message OpenCode", ja: "OpenCodeへの指示", "zh-CN": "给 OpenCode 的指令" },
  "添付": { en: "Attach", ja: "添付", "zh-CN": "附件" },
  "▧ 画像": { en: "▧ Image", ja: "▧ 画像", "zh-CN": "▧ 图片" },
  "⌑ ファイル": { en: "⌑ File", ja: "⌑ ファイル", "zh-CN": "⌑ 文件" },
  "Connected": { en: "Connected", ja: "接続済み", "zh-CN": "已连接" },
  "Offline": { en: "Offline", ja: "オフライン", "zh-CN": "离线" },
  "Transport": { en: "Transport", ja: "通信方式", "zh-CN": "传输方式" },
  "Access": { en: "Access", ja: "アクセス", "zh-CN": "访问" },
  "GitHub repositories": { en: "GitHub repositories", ja: "GitHubリポジトリ", "zh-CN": "GitHub 仓库" },
  "Language": { en: "Language", ja: "言語", "zh-CN": "语言" },
  "Settings": { en: "Settings", ja: "設定", "zh-CN": "设置" },
  "Recent": { en: "Recent", ja: "最近", "zh-CN": "最近" },
  "Loading…": { en: "Loading…", ja: "読み込み中…", "zh-CN": "加载中…" },
  "Library": { en: "Library", ja: "ライブラリ", "zh-CN": "资料库" },
  "Plugins": { en: "Plugins", ja: "プラグイン", "zh-CN": "插件" }
};

function resolveLanguage(): DevMoterLanguage {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "ja" || saved === "zh-CN") return saved;

  const browserLanguage = (navigator.languages?.[0] || navigator.language || "en").toLowerCase();
  if (browserLanguage.startsWith("ja")) return "ja";
  if (browserLanguage.startsWith("zh")) return "zh-CN";
  return "en";
}

let currentLanguage = resolveLanguage();

export function getLanguage(): DevMoterLanguage {
  return currentLanguage;
}

export function setLanguage(language: DevMoterLanguage) {
  currentLanguage = language;
  localStorage.setItem(STORAGE_KEY, language);
  document.documentElement.lang = language;
}

export function speechRecognitionLanguage() {
  if (currentLanguage === "ja") return "ja-JP";
  if (currentLanguage === "zh-CN") return "zh-CN";
  return "en-US";
}

function translateValue(value: string) {
  const entry = dictionary[value];
  return entry?.[currentLanguage] || value;
}

function shouldSkip(element: Element | null) {
  return Boolean(element?.closest(".cx-message, .ocx-message, pre, code, [data-i18n-skip]"));
}

function translateTextNode(node: Text) {
  if (shouldSkip(node.parentElement)) return;
  const match = node.data.match(/^(\s*)(.*?)(\s*)$/s);
  if (!match || !match[2]) return;
  const translated = translateValue(match[2]);
  if (translated !== match[2]) node.data = `${match[1]}${translated}${match[3]}`;
}

function translateElement(element: Element) {
  if (shouldSkip(element)) return;

  for (const attribute of ["placeholder", "aria-label", "title"]) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = translateValue(value);
    if (translated !== value) element.setAttribute(attribute, translated);
  }

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) translateTextNode(child as Text);
    else if (child.nodeType === Node.ELEMENT_NODE) translateElement(child as Element);
  }
}

export function bindLanguageSelectors(root: ParentNode = document) {
  root.querySelectorAll<HTMLSelectElement>("[data-language-select]").forEach(select => {
    select.value = currentLanguage;
    if (select.dataset.languageBound === "true") return;
    select.dataset.languageBound = "true";
    select.addEventListener("change", () => {
      const value = select.value as DevMoterLanguage;
      if (!["en", "ja", "zh-CN"].includes(value)) return;
      setLanguage(value);
      window.location.reload();
    });
  });
}

export function startI18n() {
  document.documentElement.lang = currentLanguage;
  translateElement(document.body);
  bindLanguageSelectors(document);

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "characterData" && record.target.nodeType === Node.TEXT_NODE) {
        translateTextNode(record.target as Text);
        continue;
      }

      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text);
        else if (node.nodeType === Node.ELEMENT_NODE) {
          translateElement(node as Element);
          bindLanguageSelectors(node as Element);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}
