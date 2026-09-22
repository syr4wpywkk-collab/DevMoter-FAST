export type DevMoterLanguage = "en" | "ja" | "zh-CN";

const STORAGE_KEY = "devmoter-language";

type TranslationSet = Record<DevMoterLanguage, string>;

const dictionary: Record<string, TranslationSet> = {
  "Agent mode": { en: "Agent mode", ja: "エージェントモード", "zh-CN": "智能体模式" },
  "Agent mode control": { en: "Agent mode control", ja: "エージェントモード操作", "zh-CN": "智能体模式控制" },
  "Runs through the normal DevMoter approval flow.": { en: "Runs through the normal DevMoter approval flow.", ja: "通常のDevMoter承認フローで実行します。", "zh-CN": "通过正常的 DevMoter 审批流程运行。" },
  "Mode": { en: "Mode", ja: "モード", "zh-CN": "模式" },
  "Visible policy": { en: "Visible policy", ja: "適用ポリシー", "zh-CN": "可见策略" },
  "Task": { en: "Task", ja: "タスク", "zh-CN": "任务" },
  "Describe the failure or behavior to debug": { en: "Describe the failure or behavior to debug", ja: "調査したい不具合や挙動を入力", "zh-CN": "描述要调试的故障或行为" },
  "Describe the failure, regression, or test you want reproduced": { en: "Describe the failure, regression, or test you want reproduced", ja: "再現したい不具合・リグレッション・テストを入力", "zh-CN": "描述要复现的故障、回归或测试" },
  "Describe the task": { en: "Describe the task", ja: "タスクを入力", "zh-CN": "描述任务" },
  "Run in active chat": { en: "Run in active chat", ja: "現在のチャットで実行", "zh-CN": "在当前对话中运行" },
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
  "Plugins": { en: "Plugins", ja: "プラグイン", "zh-CN": "插件" },
  "Projects": { en: "Projects", ja: "プロジェクト", "zh-CN": "项目" },
  "workspace": { en: "workspace", ja: "ワークスペース", "zh-CN": "工作区" },
  "No project": { en: "No project", ja: "プロジェクトなし", "zh-CN": "无项目" },
  "default": { en: "default", ja: "デフォルト", "zh-CN": "默认" },
  "Auto": { en: "Auto", ja: "自動", "zh-CN": "自动" },
  "Fast": { en: "Fast", ja: "高速", "zh-CN": "快速" },
  "Balanced": { en: "Balanced", ja: "バランス", "zh-CN": "均衡" },
  "Deep": { en: "Deep", ja: "深く", "zh-CN": "深入" },
  "推論性能": { en: "Reasoning", ja: "推論性能", "zh-CN": "推理强度" },
  "このチャットの思考量を選択": { en: "Choose the reasoning effort for this chat", ja: "このチャットの思考量を選択", "zh-CN": "选择此对话的推理强度" },
  "Codexに自動選択させる": { en: "Let Codex choose automatically", ja: "Codexに自動選択させる", "zh-CN": "让 Codex 自动选择" },
  "回答中はモデルを変更できません": { en: "You cannot change models while a response is running", ja: "回答中はモデルを変更できません", "zh-CN": "回复进行中时无法切换模型" },
  "モデル変更に失敗しました": { en: "Failed to change model", ja: "モデル変更に失敗しました", "zh-CN": "切换模型失败" },
  "再接続中…": { en: "Reconnecting…", ja: "再接続中…", "zh-CN": "正在重新连接…" },
  "待機中": { en: "Idle", ja: "待機中", "zh-CN": "空闲" },
  "実行中…": { en: "Running…", ja: "実行中…", "zh-CN": "运行中…" },
  "確認待ち": { en: "Waiting for approval", ja: "確認待ち", "zh-CN": "等待确认" },
  "入力待ち": { en: "Waiting for input", ja: "入力待ち", "zh-CN": "等待输入" },
  "完了": { en: "Completed", ja: "完了", "zh-CN": "已完成" },
  "失敗": { en: "Failed", ja: "失敗", "zh-CN": "失败" },
  "中断": { en: "Interrupted", ja: "中断", "zh-CN": "已中断" },
  "回答を評価": { en: "Rate response", ja: "回答を評価", "zh-CN": "评价回复" },
  "評価": { en: "Feedback", ja: "評価", "zh-CN": "评价" },
  "良い回答": { en: "Good response", ja: "良い回答", "zh-CN": "回复不错" },
  "良くない回答": { en: "Poor response", ja: "良くない回答", "zh-CN": "回复不佳" },
  "回答を共有": { en: "Share response", ja: "回答を共有", "zh-CN": "分享回复" },
  "共有": { en: "Share", ja: "共有", "zh-CN": "分享" },
  "共有できないためコピーしました": { en: "Sharing is unavailable, so it was copied", ja: "共有できないためコピーしました", "zh-CN": "无法直接分享，已复制" },
  "見つかりません": { en: "Not found", ja: "見つかりません", "zh-CN": "未找到" },
  "まだチャットがありません": { en: "No chats yet", ja: "まだチャットがありません", "zh-CN": "还没有对话" },
  "メッセージを送るとここに会話が表示されます。": { en: "Send a message and the conversation will appear here.", ja: "メッセージを送るとここに会話が表示されます。", "zh-CN": "发送消息后，对话会显示在这里。" },
  "チャットを開けませんでした": { en: "Could not open chat", ja: "チャットを開けませんでした", "zh-CN": "无法打开对话" },
  "新しいチャットを作れませんでした": { en: "Could not create a new chat", ja: "新しいチャットを作れませんでした", "zh-CN": "无法创建新对话" },
  "ファイルをアップロードできませんでした": { en: "Could not upload file", ja: "ファイルをアップロードできませんでした", "zh-CN": "文件上传失败" },
  "送信できませんでした": { en: "Could not send", ja: "送信できませんでした", "zh-CN": "发送失败" },
  "停止できませんでした": { en: "Could not stop", ja: "停止できませんでした", "zh-CN": "停止失败" },
  "ファイル変更を許可しますか？": { en: "Allow file changes?", ja: "ファイル変更を許可しますか？", "zh-CN": "允许修改文件吗？" },
  "コマンド実行を許可しますか？": { en: "Allow command execution?", ja: "コマンド実行を許可しますか？", "zh-CN": "允许运行命令吗？" },
  "File change": { en: "File change", ja: "ファイル変更", "zh-CN": "文件修改" },
  "許可応答に失敗しました": { en: "Failed to send approval response", ja: "許可応答に失敗しました", "zh-CN": "权限响应发送失败" },
  "Plugin APIを読み込めませんでした。": { en: "Could not load the Plugin API.", ja: "Plugin APIを読み込めませんでした。", "zh-CN": "无法加载插件 API。" },
  "＋ 既存フォルダ": { en: "＋ Existing folder", ja: "＋ 既存フォルダ", "zh-CN": "＋ 现有文件夹" },
  "＋ 新規Project": { en: "＋ New project", ja: "＋ 新規Project", "zh-CN": "＋ 新建项目" },
  "Search all accessible repositories": { en: "Search all accessible repositories", ja: "アクセス可能なリポジトリを検索", "zh-CN": "搜索所有可访问的仓库" },
  "Search": { en: "Search", ja: "検索", "zh-CN": "搜索" },
  "Privateリポジトリが見つかりません。": { en: "No private repositories found.", ja: "Privateリポジトリが見つかりません。", "zh-CN": "未找到私有仓库。" },
  "リポジトリが見つかりません。": { en: "No repositories found.", ja: "リポジトリが見つかりません。", "zh-CN": "未找到仓库。" },
  "GitHub情報を読み込めませんでした。": { en: "Could not load GitHub information.", ja: "GitHub情報を読み込めませんでした。", "zh-CN": "无法加载 GitHub 信息。" },
  "ブランチを読み込み中…": { en: "Loading branches…", ja: "ブランチを読み込み中…", "zh-CN": "正在加载分支…" },
  "‹ 戻る": { en: "‹ Back", ja: "‹ 戻る", "zh-CN": "‹ 返回" },
  "新しいProjectを作成": { en: "Create new project", ja: "新しいProjectを作成", "zh-CN": "创建新项目" },
  "既存フォルダを追加": { en: "Add existing folder", ja: "既存フォルダを追加", "zh-CN": "添加现有文件夹" },
  "表示名（任意）": { en: "Display name (optional)", ja: "表示名（任意）", "zh-CN": "显示名称（可选）" },
  "Markdownを読み込み中…": { en: "Loading Markdown…", ja: "Markdownを読み込み中…", "zh-CN": "正在加载 Markdown…" },
  "✎ 新しいチャット": { en: "✎ New chat", ja: "✎ 新しいチャット", "zh-CN": "✎ 新建对话" },
  "このProjectの登録を解除": { en: "Remove this project from DevMoter", ja: "このProjectの登録を解除", "zh-CN": "从 DevMoter 移除此项目" },
  "Markdownを追加": { en: "Add Markdown", ja: "Markdownを追加", "zh-CN": "添加 Markdown" },
  "ファイル名": { en: "File name", ja: "ファイル名", "zh-CN": "文件名" },
  "ファイル名を入力してね": { en: "Enter a file name", ja: "ファイル名を入力してね", "zh-CN": "请输入文件名" },
  "未保存の変更があります。閉じますか？": { en: "You have unsaved changes. Close anyway?", ja: "未保存の変更があります。閉じますか？", "zh-CN": "有未保存的更改。仍要关闭吗？" },
  "未保存": { en: "Unsaved", ja: "未保存", "zh-CN": "未保存" },
  "保存中…": { en: "Saving…", ja: "保存中…", "zh-CN": "正在保存…" },
  "保存済み": { en: "Saved", ja: "保存済み", "zh-CN": "已保存" },
  "未保存の変更があります。戻りますか？": { en: "You have unsaved changes. Go back anyway?", ja: "未保存の変更があります。戻りますか？", "zh-CN": "有未保存的更改。仍要返回吗？" },
  "このチャットのモデルを変更": { en: "Change the model for this chat", ja: "このチャットのモデルを変更", "zh-CN": "更改此对话的模型" },
  "次のチャットで使うモデル": { en: "Model for the next chat", ja: "次のチャットで使うモデル", "zh-CN": "下一个对话使用的模型" },
  "新規セッション": { en: "New session", ja: "新規セッション", "zh-CN": "新建会话" },
  "No matching sessions": { en: "No matching sessions", ja: "一致するセッションはありません", "zh-CN": "没有匹配的会话" },
  "No sessions yet": { en: "No sessions yet", ja: "まだセッションがありません", "zh-CN": "还没有会话" },
  "OpenCode command": { en: "OpenCode command", ja: "OpenCodeコマンド", "zh-CN": "OpenCode 命令" },
  "OpenCode needs input": { en: "OpenCode needs input", ja: "OpenCodeが入力を求めています", "zh-CN": "OpenCode 需要输入" },
  "Choose how OpenCode should work": { en: "Choose how OpenCode should work", ja: "OpenCodeの動作方法を選択", "zh-CN": "选择 OpenCode 的工作方式" },
  "Choose the model for subsequent work": { en: "Choose the model for subsequent work", ja: "以降の作業で使うモデルを選択", "zh-CN": "选择后续工作使用的模型" },
  "OpenCode skill": { en: "OpenCode skill", ja: "OpenCodeスキル", "zh-CN": "OpenCode 技能" },
  "loading": { en: "loading", ja: "読み込み中", "zh-CN": "加载中" },
  "working": { en: "working", ja: "実行中", "zh-CN": "运行中" }
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
