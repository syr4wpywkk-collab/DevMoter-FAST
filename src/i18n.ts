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
  "New session": { en: "New session", ja: "新しいチャット", "zh-CN": "新建会话" },
  "Search conversation history": { en: "Search conversation history", ja: "チャットを検索", "zh-CN": "搜索对话" },
  "Sort conversation history": { en: "Sort conversation history", ja: "履歴の並べ替え", "zh-CN": "排序" },
  "Sort history": { en: "Sort history", ja: "並べ替え", "zh-CN": "排序" },
  "CONVERSATION HISTORY": { en: "Conversation history", ja: "チャット", "zh-CN": "对话" },
  "Recent activity": { en: "Recent activity", ja: "最近の更新", "zh-CN": "最近活动" },
  "Created time": { en: "Created time", ja: "作成日時", "zh-CN": "创建时间" },
  "Message count": { en: "Message count", ja: "メッセージ数", "zh-CN": "消息数" },
  "Free": { en: "Free", ja: "無料", "zh-CN": "免费" },
  "Available": { en: "Available", ja: "使える", "zh-CN": "可用" },
  "Needs key": { en: "Needs key", ja: "キーが必要", "zh-CN": "需要密钥" },
  "Deprecated": { en: "Deprecated", ja: "非推奨", "zh-CN": "已弃用" },
  "Search models": { en: "Search models", ja: "モデルを検索", "zh-CN": "搜索模型" },
  "使える": { en: "Ready", ja: "使える", "zh-CN": "可用" },
  "キーが必要": { en: "Needs a key", ja: "キーが必要", "zh-CN": "需要密钥" },
  "表示": { en: "Appearance", ja: "表示", "zh-CN": "外观" },
  "開発ツール": { en: "Developer tools", ja: "開発ツール", "zh-CN": "开发工具" },
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
  "Light": { en: "Light", ja: "ライト", "zh-CN": "浅色" },
  "Dark": { en: "Dark", ja: "ダーク", "zh-CN": "深色" },
  "System": { en: "System", ja: "システム", "zh-CN": "系统" },
  "Tasks": { en: "Tasks", ja: "タスク", "zh-CN": "任务" },
  "Extensions": { en: "Extensions", ja: "拡張", "zh-CN": "扩展" },
  "offline": { en: "offline", ja: "オフライン", "zh-CN": "离线" },
  "No models match": { en: "No models match", ja: "一致するモデルはありません", "zh-CN": "没有匹配的模型" },
  "Provider · Model · Agent": { en: "Provider · Model · Agent", ja: "モデルとエージェント", "zh-CN": "模型与智能体" },
  "Provider · Model": { en: "Provider · Model", ja: "モデル", "zh-CN": "模型" },
  "Filter models": { en: "Filter models", ja: "モデルを絞り込む", "zh-CN": "筛选模型" },
  "Refresh models": { en: "Refresh models", ja: "モデルを更新", "zh-CN": "刷新模型" },
  "available": { en: "available", ja: "使える", "zh-CN": "可用" },
  "provider unavailable": { en: "provider unavailable", ja: "プロバイダを利用できません", "zh-CN": "Provider 不可用" },
  "非推奨": { en: "Deprecated", ja: "非推奨", "zh-CN": "已弃用" },
  "Plan, ask, and build in your workspace.": {
    en: "Plan, ask, and build in your workspace.",
    ja: "このワークスペースで計画し、質問し、実装できます。",
    "zh-CN": "在此工作区里规划、提问和实现。"
  },
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
  "agent": { en: "agent", ja: "エージェント", "zh-CN": "智能体" },
  "model": { en: "model", ja: "モデル", "zh-CN": "模型" },
  "Message OpenCode…": { en: "Message OpenCode…", ja: "OpenCodeにメッセージ…", "zh-CN": "给 OpenCode 发消息…" },
  "OpenCodeへの指示": { en: "Message OpenCode", ja: "OpenCodeへの指示", "zh-CN": "给 OpenCode 的指令" },
  "添付": { en: "Attach", ja: "添付", "zh-CN": "附件" },
  "▧ 画像": { en: "▧ Image", ja: "▧ 画像", "zh-CN": "▧ 图片" },
  "⌑ ファイル": { en: "⌑ File", ja: "⌑ ファイル", "zh-CN": "⌑ 文件" },
  "Connected": { en: "Connected", ja: "接続済み", "zh-CN": "已连接" },
  "No matching sessions.": { en: "No matching sessions", ja: "一致するセッションはありません", "zh-CN": "没有匹配的会话" },
  "Offline": { en: "Offline", ja: "オフライン", "zh-CN": "离线" },
  "Syncing": { en: "Syncing", ja: "同期中", "zh-CN": "同步中" },
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
  "Codexはオフラインです": { en: "Codex is offline", ja: "Codexはオフラインです", "zh-CN": "Codex 离线" },
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
  "Choose the model for subsequent work": { en: "Choose the model for subsequent work", ja: "以降の作業で使うモデルを選択", "zh-CN": "选择后续工作使用的模型" },
  "OpenCode skill": { en: "OpenCode skill", ja: "OpenCodeスキル", "zh-CN": "OpenCode 技能" },
  "loading": { en: "loading", ja: "読み込み中", "zh-CN": "加载中" },
  "working": { en: "working", ja: "実行中", "zh-CN": "运行中" },
  "＋ 新しいチャット": { en: "＋ New chat", ja: "＋ 新しいチャット", "zh-CN": "＋ 新建对话" },
  "API Providers": { en: "API Providers", ja: "API Providers", "zh-CN": "API Provider" },
  "推論モード": { en: "Reasoning mode", ja: "推論モード", "zh-CN": "推理模式" },
  "API設定": { en: "API settings", ja: "API設定", "zh-CN": "API 设置" },
  "こんにちは": { en: "Hello", ja: "こんにちは", "zh-CN": "你好" },
  "どのAPIで考える？": { en: "Which API should think about this?", ja: "どのAPIで考える？", "zh-CN": "要用哪个 API 来思考？" },
  "メッセージを入力": { en: "Type a message", ja: "メッセージを入力", "zh-CN": "输入消息" },
  "メッセージ": { en: "Message", ja: "メッセージ", "zh-CN": "消息" },
  "画像を添付": { en: "Attach image", ja: "画像を添付", "zh-CN": "附加图片" },
  "接続先を読み込み中…": { en: "Loading providers…", ja: "接続先を読み込み中…", "zh-CN": "正在加载 Provider…" },
  "接続先": { en: "Providers", ja: "接続先", "zh-CN": "Provider" },
  "＋ APIを追加": { en: "＋ Add API", ja: "＋ APIを追加", "zh-CN": "＋ 添加 API" },
  "まだAPIがありません": { en: "No APIs configured yet", ja: "まだAPIがありません", "zh-CN": "尚未配置 API" },
  "企業を選んでAPIキーを追加すると、上のモデル切替からすぐ使えます。": { en: "Choose a provider and add an API key, then select its model from the top bar.", ja: "企業を選んでAPIキーを追加すると、上のモデル切替からすぐ使えます。", "zh-CN": "选择 Provider 并添加 API 密钥后，即可从顶部选择模型。" },
  "APIを追加": { en: "Add API", ja: "APIを追加", "zh-CN": "添加 API" },
  "API Key": { en: "API Key", ja: "API Key", "zh-CN": "API 密钥" },
  "詳細設定": { en: "Advanced settings", ja: "詳細設定", "zh-CN": "高级设置" },
  "表示名": { en: "Display name", ja: "表示名", "zh-CN": "显示名称" },
  "API形式": { en: "API format", ja: "API形式", "zh-CN": "API 格式" },
  "更新": { en: "Update", ja: "更新", "zh-CN": "更新" },
  "接続して追加": { en: "Connect and add", ja: "接続して追加", "zh-CN": "连接并添加" },
  "このAPI設定を削除": { en: "Delete this API configuration", ja: "このAPI設定を削除", "zh-CN": "删除此 API 配置" },
  // Settings and the sheets it opens (Group D copy pass). A sheet title is the
  // label of the row that opened it, so both sides map to the same words.
  "アクティビティ": { en: "Activity", ja: "アクティビティ", "zh-CN": "活动" },
  "Activity": { en: "Activity", ja: "アクティビティ", "zh-CN": "活动" },
  "実行中・キュー・チェックポイント・履歴": { en: "Running · Queue · Checkpoints · History", ja: "実行中・キュー・チェックポイント・履歴", "zh-CN": "运行中 · 队列 · 检查点 · 历史" },
  "レビューとタスク": { en: "Review & tasks", ja: "レビューとタスク", "zh-CN": "审查与任务" },
  "Review & Tasks": { en: "Review & Tasks", ja: "レビューとタスク", "zh-CN": "审查与任务" },
  "差分・ワークツリー・GitHub": { en: "Diffs · Worktrees · GitHub", ja: "差分・ワークツリー・GitHub", "zh-CN": "差异 · 工作树 · GitHub" },
  "モード・サブエージェント・フリート": { en: "Mode · Subagents · Fleet", ja: "モード・サブエージェント・フリート", "zh-CN": "模式 · 子智能体 · 编队" },
  "表示履歴": { en: "Context", ja: "表示履歴", "zh-CN": "上下文" },
  "表示量の目安と整理": { en: "Estimated size and cleanup", ja: "表示量の目安と整理", "zh-CN": "估算大小与整理" },
  "チェックポイント": { en: "Checkpoints", ja: "チェックポイント", "zh-CN": "检查点" },
  "Checkpoints": { en: "Checkpoints", ja: "チェックポイント", "zh-CN": "检查点" },
  "現在のタスク": { en: "Current task", ja: "現在のタスク", "zh-CN": "当前任务" },
  "拡張機能": { en: "Extensions", ja: "拡張機能", "zh-CN": "扩展" },
  "パスキー": { en: "Passkeys", ja: "パスキー", "zh-CN": "通行密钥" },
  "Passkeys": { en: "Passkeys", ja: "パスキー", "zh-CN": "通行密钥" },
  "信頼済み端末": { en: "Trusted devices", ja: "信頼済み端末", "zh-CN": "受信任设备" },
  "ホスト一覧": { en: "Hosts", ja: "ホスト一覧", "zh-CN": "主机" },
  "Hosts": { en: "Hosts", ja: "ホスト一覧", "zh-CN": "主机" },
  "自動化": { en: "Automation", ja: "自動化", "zh-CN": "自动化" },
  "Automation": { en: "Automation", ja: "自動化", "zh-CN": "自动化" },
  "Remote & automation": { en: "Remote & automation", ja: "リモートと自動化", "zh-CN": "远程与自动化" },
  "リモートと自動化": { en: "Remote & automation", ja: "リモートと自動化", "zh-CN": "远程与自动化" },
  "ファイルとプレビュー": { en: "Files & preview", ja: "ファイルとプレビュー", "zh-CN": "文件与预览" },
  "Files & preview": { en: "Files & preview", ja: "ファイルとプレビュー", "zh-CN": "文件与预览" },
  "Terminal": { en: "Terminal", ja: "ターミナル", "zh-CN": "终端" },
  "Safety": { en: "Safety", ja: "セーフティ", "zh-CN": "安全" },
  "Safety scan": { en: "Safety scan", ja: "セーフティスキャン", "zh-CN": "安全扫描" },
  "Index": { en: "Index", ja: "インデックス", "zh-CN": "索引" },
  "Project index": { en: "Project index", ja: "プロジェクトインデックス", "zh-CN": "项目索引" },
  // Rows and gate merged in #504 (theme + density, devices + pairing, external bug report).
  "テーマと表示": { en: "Theme & display", ja: "テーマと表示", "zh-CN": "主题与显示" },
  "端末の登録とペアリングコード": { en: "Register this device · pairing code", ja: "端末の登録とペアリングコード", "zh-CN": "注册设备与配对码" },
  "不具合を報告": { en: "Report a bug", ja: "不具合を報告", "zh-CN": "报告问题" },
  "GitHub の Issue を開く": { en: "Opens a GitHub issue", ja: "GitHub の Issue を開く", "zh-CN": "打开 GitHub Issue" },
  "この端末は未登録です": { en: "This device is not registered", ja: "この端末は未登録です", "zh-CN": "此设备尚未注册" },
  "端末を登録すると使えます": { en: "Register this device to use it", ja: "端末を登録すると使えます", "zh-CN": "注册此设备后即可使用" },
  "端末を登録": { en: "Register device", ja: "端末を登録", "zh-CN": "注册设备" },
  // Activity sheet (session-control.ts)
  "Queue": { en: "Queue", ja: "キュー", "zh-CN": "队列" },
  "History": { en: "History", ja: "履歴", "zh-CN": "历史" },
  "Search · agent: project: state:": { en: "Search · agent: project: state:", ja: "検索 · agent: project: state:", "zh-CN": "搜索 · agent: project: state:" },
  "Open": { en: "Open", ja: "開く", "zh-CN": "打开" },
  "Handoff": { en: "Handoff", ja: "引き継ぎ", "zh-CN": "交接" },
  "More": { en: "More", ja: "その他", "zh-CN": "更多" },
  "Stop": { en: "Stop", ja: "停止", "zh-CN": "停止" },
  "Running": { en: "Running", ja: "実行中", "zh-CN": "运行中" },
  "Waiting": { en: "Waiting", ja: "待機中", "zh-CN": "等待中" },
  "Done": { en: "Done", ja: "完了", "zh-CN": "完成" },
  "Idle": { en: "Idle", ja: "アイドル", "zh-CN": "空闲" },
  "Failed": { en: "Failed", ja: "失敗", "zh-CN": "失败" },
  "Interrupted": { en: "Interrupted", ja: "中断", "zh-CN": "已中断" },
  "Unknown": { en: "Unknown", ja: "不明", "zh-CN": "未知" },
  "No queued follow-ups.": { en: "No queued follow-ups", ja: "キューに追加された指示はありません", "zh-CN": "队列为空" },
  "No checkpoints yet.": { en: "No checkpoints yet", ja: "チェックポイントはまだありません", "zh-CN": "暂无检查点" },
  "No control history yet.": { en: "No history yet", ja: "履歴はまだありません", "zh-CN": "暂无历史" },
  // Remote & automation sheet (remote-control.ts)
  "This host": { en: "This host", ja: "このホスト", "zh-CN": "本机" },
  "Online": { en: "Online", ja: "オンライン", "zh-CN": "在线" },
  "Auth required": { en: "Sign-in required", ja: "要サインイン", "zh-CN": "需要登录" },
  "Timeout": { en: "Timeout", ja: "タイムアウト", "zh-CN": "超时" },
  "Remove": { en: "Remove", ja: "削除", "zh-CN": "移除" },
  "Label": { en: "Label", ja: "名前", "zh-CN": "名称" },
  "Address": { en: "Address", ja: "アドレス", "zh-CN": "地址" },
  "Trust": { en: "Trust", ja: "信頼", "zh-CN": "信任" },
  "Unverified": { en: "Unverified", ja: "未確認", "zh-CN": "未验证" },
  "Trusted": { en: "Trusted", ja: "信頼済み", "zh-CN": "已信任" },
  "Add host": { en: "Add host", ja: "ホストを追加", "zh-CN": "添加主机" },
  "Laptop / home server": { en: "Laptop / home server", ja: "ノートPC、自宅サーバーなど", "zh-CN": "笔记本 / 家用服务器" },
  "Schedules": { en: "Schedules", ja: "スケジュール", "zh-CN": "计划" },
  "Event triggers": { en: "Event triggers", ja: "イベントトリガー", "zh-CN": "事件触发" },
  "Autopilot": { en: "Autopilot", ja: "オートパイロット", "zh-CN": "自动驾驶" },
  "Pause": { en: "Pause", ja: "一時停止", "zh-CN": "暂停" },
  "Resume": { en: "Resume", ja: "再開", "zh-CN": "继续" },
  "Delete": { en: "Delete", ja: "削除", "zh-CN": "删除" },
  "Cancel": { en: "Cancel", ja: "キャンセル", "zh-CN": "取消" },
  "Name": { en: "Name", ja: "名前", "zh-CN": "名称" },
  "Timezone": { en: "Time zone", ja: "タイムゾーン", "zh-CN": "时区" },
  "Backend": { en: "Backend", ja: "バックエンド", "zh-CN": "后端" },
  "Project": { en: "Project", ja: "プロジェクト", "zh-CN": "项目" },
  "Source": { en: "Source", ja: "ソース", "zh-CN": "来源" },
  "Event": { en: "Event", ja: "イベント", "zh-CN": "事件" },
  "Task to run": { en: "Task to run", ja: "実行するタスク", "zh-CN": "要运行的任务" },
  "Task for this event": { en: "Task for this event", ja: "このイベントで実行するタスク", "zh-CN": "此事件的任务" },
  "Long-running task": { en: "Long-running task", ja: "長時間のタスク", "zh-CN": "长时间任务" },
  "Nightly review": { en: "Nightly review", ja: "夜間レビュー", "zh-CN": "夜间审查" },
  "Create schedule": { en: "Create schedule", ja: "スケジュールを作成", "zh-CN": "创建计划" },
  "Create trigger": { en: "Create trigger", ja: "トリガーを作成", "zh-CN": "创建触发器" },
  "Max turns": { en: "Max turns", ja: "最大ターン数", "zh-CN": "最大轮数" },
  "Max minutes": { en: "Max minutes", ja: "最大時間（分）", "zh-CN": "最长分钟数" },
  "Max budget (0 = unset)": { en: "Max budget (0 = unset)", ja: "予算上限（0で未設定）", "zh-CN": "预算上限（0 为不限）" },
  "Start bounded autopilot": { en: "Start autopilot", ja: "オートパイロットを開始", "zh-CN": "启动自动驾驶" },
  "Registered passkeys": { en: "Registered passkeys", ja: "登録済みパスキー", "zh-CN": "已注册通行密钥" },
  "Signed in": { en: "Signed in", ja: "サインイン済み", "zh-CN": "已登录" },
  "Sign-in required": { en: "Sign-in required", ja: "要サインイン", "zh-CN": "需要登录" },
  "No passkeys registered": { en: "No passkeys registered", ja: "登録済みのパスキーはありません", "zh-CN": "未注册通行密钥" },
  "This browser does not support passkeys": { en: "This browser does not support passkeys", ja: "このブラウザはパスキーに対応していません", "zh-CN": "此浏览器不支持通行密钥" },
  "Sign in with passkey": { en: "Sign in with passkey", ja: "パスキーでサインイン", "zh-CN": "使用通行密钥登录" },
  "Signed in with passkey": { en: "Signed in with passkey", ja: "パスキーでサインインしました", "zh-CN": "已使用通行密钥登录" },
  "Register passkey": { en: "Register passkey", ja: "パスキーを登録", "zh-CN": "注册通行密钥" },
  "Passkey registered": { en: "Passkey registered", ja: "パスキーを登録しました", "zh-CN": "通行密钥已注册" },
  "Sign out": { en: "Sign out", ja: "サインアウト", "zh-CN": "退出登录" },
  // Checkpoint and extension sheets (workspace-control.ts)
  "Continue": { en: "Continue", ja: "続ける", "zh-CN": "继续" },
  "Looks good": { en: "Looks good", ja: "問題なし", "zh-CN": "没问题" },
  "Retry": { en: "Retry", ja: "再試行", "zh-CN": "重试" },
  "Needs fix": { en: "Needs fix", ja: "要修正", "zh-CN": "需要修复" },
  "Install": { en: "Install", ja: "インストール", "zh-CN": "安装" },
  // Group G light-mode sheet sweep: Tools, Agent mode, Review, Mission Control, Automation.
  "Close": { en: "Close", ja: "閉じる", "zh-CN": "关闭" },
  "Default": { en: "Default", ja: "デフォルト", "zh-CN": "默认" },
  "Saved sessions": { en: "Saved sessions", ja: "保存済みセッション", "zh-CN": "已保存会话" },
  "Select saved session…": { en: "Select a saved session", ja: "保存済みセッションを選択", "zh-CN": "选择已保存会话" },
  "Keep running after restart (tmux)": { en: "Keep running after restart (tmux)", ja: "再起動後も実行を続ける（tmux）", "zh-CN": "重启后继续运行（tmux）" },
  "Session name": { en: "Session name", ja: "セッション名", "zh-CN": "会话名称" },
  "Start / Reattach": { en: "Start / reattach", ja: "開始・再接続", "zh-CN": "启动 / 重新连接" },
  "Kill session": { en: "End session", ja: "セッションを終了", "zh-CN": "结束会话" },
  "Forget password": { en: "Forget password", ja: "パスワードを消去", "zh-CN": "清除密码" },
  "Not started": { en: "Not started", ja: "未起動", "zh-CN": "未启动" },
  "Terminal not started": { en: "Terminal not started", ja: "ターミナルは未起動です", "zh-CN": "终端未启动" },
  "Pick a project and press Start": { en: "Pick a project and press Start", ja: "プロジェクトを選んで開始を押してください", "zh-CN": "选择项目后点击启动" },
  "Runs in the project folder and keeps running when you close this sheet": { en: "Runs in the project folder and keeps running when you close this sheet", ja: "プロジェクトのフォルダで動き、閉じても実行を続けます", "zh-CN": "在项目文件夹中运行，关闭此面板后仍继续运行" },
  "Terminal output": { en: "Terminal output", ja: "ターミナル出力", "zh-CN": "终端输出" },
  "Preparing terminal…": { en: "Preparing terminal…", ja: "ターミナルを準備中…", "zh-CN": "正在准备终端…" },
  "Terminal session killed.": { en: "Session ended", ja: "セッションを終了しました", "zh-CN": "会话已结束" },
  "Terminal disconnected. Reconnecting…": { en: "Disconnected, reconnecting…", ja: "切断されました。再接続中…", "zh-CN": "已断开，正在重新连接…" },
  "Terminal process exited.": { en: "Terminal exited", ja: "ターミナルが終了しました", "zh-CN": "终端已退出" },
  "Register/select a project first.": { en: "Select a project first", ja: "先にプロジェクトを選んでください", "zh-CN": "请先选择项目" },
  "No terminal session to kill.": { en: "No session to end", ja: "終了するセッションはありません", "zh-CN": "没有可结束的会话" },
  "Stored terminal password cleared for this browser tab.": { en: "Password cleared for this tab", ja: "このタブのパスワードを消去しました", "zh-CN": "已清除此标签页的密码" },
  "Command check": { en: "Command check", ja: "コマンドの確認", "zh-CN": "命令检查" },
  "Paste a command to check": { en: "Paste a command to check", ja: "確認するコマンドを貼り付け", "zh-CN": "粘贴要检查的命令" },
  "Command to scan": { en: "Command to check", ja: "確認するコマンド", "zh-CN": "要检查的命令" },
  "Scan": { en: "Check", ja: "確認", "zh-CN": "检查" },
  "Scanning command…": { en: "Checking…", ja: "確認中…", "zh-CN": "检查中…" },
  "Remembered approvals": { en: "Remembered approvals", ja: "記憶した承認", "zh-CN": "已记住的批准" },
  "No remembered approvals": { en: "No remembered approvals", ja: "記憶した承認はありません", "zh-CN": "没有已记住的批准" },
  "Revoke": { en: "Revoke", ja: "取り消す", "zh-CN": "撤销" },
  "Exclude (comma-separated)": { en: "Exclude (comma-separated)", ja: "除外（カンマ区切り）", "zh-CN": "排除（逗号分隔）" },
  "Rebuild index": { en: "Rebuild index", ja: "インデックスを再作成", "zh-CN": "重建索引" },
  "Delete index": { en: "Delete index", ja: "インデックスを削除", "zh-CN": "删除索引" },
  "Repo map": { en: "Repo map", ja: "リポジトリマップ", "zh-CN": "仓库地图" },
  "Details": { en: "Details", ja: "詳細", "zh-CN": "详情" },
  "Symbol, file name or phrase": { en: "Symbol, file name or phrase", ja: "シンボル・ファイル名・語句", "zh-CN": "符号、文件名或短语" },
  "Index not built.": { en: "Index not built", ja: "インデックスは未作成です", "zh-CN": "索引尚未创建" },
  "Loading index status…": { en: "Loading…", ja: "読み込み中…", "zh-CN": "加载中…" },
  "Building local index…": { en: "Building index…", ja: "インデックスを作成中…", "zh-CN": "正在创建索引…" },
  "Deleting project index…": { en: "Deleting index…", ja: "インデックスを削除中…", "zh-CN": "正在删除索引…" },
  "Index deleted.": { en: "Index deleted", ja: "インデックスを削除しました", "zh-CN": "索引已删除" },
  "Searching local index…": { en: "Searching…", ja: "検索中…", "zh-CN": "搜索中…" },
  "Loading repository map…": { en: "Loading map…", ja: "マップを読み込み中…", "zh-CN": "正在加载地图…" },
  "Repository map loaded.": { en: "Map loaded", ja: "マップを読み込みました", "zh-CN": "地图已加载" },
  "Structure": { en: "Structure", ja: "構成", "zh-CN": "结构" },
  "Symbols": { en: "Symbols", ja: "シンボル", "zh-CN": "符号" },
  "No matches.": { en: "No matches", ja: "一致なし", "zh-CN": "无匹配" },
  "信頼済み端末を開く": { en: "Open trusted devices", ja: "信頼済み端末を開く", "zh-CN": "打开受信任设备" },
  "Reproduce a failure and propose the smallest fix": { en: "Reproduce a failure and propose the smallest fix", ja: "不具合を再現し、最小の修正を提案", "zh-CN": "复现故障并提出最小修复" },
  "Review a diff and report risks without editing": { en: "Review a diff and report risks without editing", ja: "差分を確認し、編集せずにリスクを報告", "zh-CN": "审查差异并报告风险，不修改代码" },
  "Split a large task and delegate after approval": { en: "Split a large task and delegate after approval", ja: "大きなタスクを分け、承認後に任せる", "zh-CN": "拆分大型任务，批准后委派" },
  "＋ Custom mode": { en: "＋ Custom mode", ja: "＋ カスタムモード", "zh-CN": "＋ 自定义模式" },
  "Edit selected": { en: "Edit selected", ja: "選択中を編集", "zh-CN": "编辑所选" },
  "Role model routing": { en: "Model per role", ja: "役割ごとのモデル", "zh-CN": "按角色分配模型" },
  "Save role models": { en: "Save", ja: "保存", "zh-CN": "保存" },
  "Run as subagent": { en: "Run as subagent", ja: "サブエージェントで実行", "zh-CN": "作为子智能体运行" },
  "Preview decomposition": { en: "Preview split", ja: "分割をプレビュー", "zh-CN": "预览拆分" },
  "Describe the working tree, diff, or range to review": { en: "Describe the diff or range to review", ja: "レビューする差分や範囲を入力", "zh-CN": "描述要审查的差异或范围" },
  "Describe the large task to decompose": { en: "Describe the large task to split", ja: "分割したい大きなタスクを入力", "zh-CN": "描述要拆分的大型任务" },
  "Save mode": { en: "Save mode", ja: "モードを保存", "zh-CN": "保存模式" },
  "Mode id": { en: "Mode id", ja: "モードID", "zh-CN": "模式 ID" },
  "Instructions (one per line)": { en: "Instructions (one per line)", ja: "指示（1行に1つ）", "zh-CN": "指令（每行一条）" },
  "Preferred provider": { en: "Preferred provider", ja: "優先プロバイダー", "zh-CN": "首选提供方" },
  "Preferred model": { en: "Preferred model", ja: "優先モデル", "zh-CN": "首选模型" },
  "Allowed tool groups": { en: "Allowed tool groups", ja: "許可するツール", "zh-CN": "允许的工具组" },
  "Denied tool groups": { en: "Denied tool groups", ja: "禁止するツール", "zh-CN": "禁止的工具组" },
  "Mutation policy": { en: "Change policy", ja: "変更ポリシー", "zh-CN": "修改策略" },
  "Approval required": { en: "Approval required", ja: "承認が必要", "zh-CN": "需要批准" },
  "optional": { en: "optional", ja: "任意", "zh-CN": "可选" },
  "Changes": { en: "Changes", ja: "変更", "zh-CN": "更改" },
  "Worktrees": { en: "Worktrees", ja: "作業ツリー", "zh-CN": "工作树" },
  "Reviewed changes": { en: "Reviewed changes", ja: "変更内容", "zh-CN": "已审查的更改" },
  "Files change only after you accept": { en: "Files change only after you accept", ja: "承認するまでファイルは変わりません", "zh-CN": "接受前不会修改文件" },
  "Working diff": { en: "Working diff", ja: "作業中の差分", "zh-CN": "工作区差异" },
  "No changes to review": { en: "No changes to review", ja: "レビュー待ちの変更はありません", "zh-CN": "没有待审查的更改" },
  "No worktrees": { en: "No worktrees", ja: "作業ツリーはありません", "zh-CN": "没有工作树" },
  "Isolated worktrees": { en: "Worktrees", ja: "作業ツリー", "zh-CN": "工作树" },
  "Ready": { en: "Ready", ja: "準備完了", "zh-CN": "就绪" },
  "Refreshing…": { en: "Refreshing…", ja: "更新中…", "zh-CN": "正在刷新…" },
  "Active agents": { en: "Active agents", ja: "実行中のエージェント", "zh-CN": "活动智能体" },
  "Fleet queue": { en: "Fleet queue", ja: "フリートの待ち", "zh-CN": "队列" },
  "Live sessions": { en: "Live sessions", ja: "実行中のセッション", "zh-CN": "活动会话" },
  "Projects online": { en: "Projects online", ja: "利用可能なプロジェクト", "zh-CN": "在线项目" },
  "Agent Runs": { en: "Agent runs", ja: "エージェント実行", "zh-CN": "智能体运行" },
  "Sessions": { en: "Sessions", ja: "セッション", "zh-CN": "会话" },
  "Host": { en: "Host", ja: "ホスト", "zh-CN": "主机" },
  "Not loaded": { en: "Not loaded", ja: "未読み込み", "zh-CN": "未加载" },
  "Updated": { en: "Updated", ja: "更新", "zh-CN": "更新于" },
  "Source unavailable": { en: "Unavailable", ja: "読み込めません", "zh-CN": "无法加载" },
  "No agent runs": { en: "No agent runs", ja: "エージェント実行はありません", "zh-CN": "没有智能体运行" },
  "No sessions": { en: "No sessions", ja: "セッションはありません", "zh-CN": "没有会话" },
  "No projects": { en: "No projects", ja: "プロジェクトはありません", "zh-CN": "没有项目" },
  "New schedule": { en: "New schedule", ja: "スケジュールを追加", "zh-CN": "新建计划" },
  "New trigger": { en: "New trigger", ja: "トリガーを追加", "zh-CN": "新建触发器" },
  "New autopilot run": { en: "New autopilot run", ja: "オートパイロットを追加", "zh-CN": "新建自动驾驶" },
  "No schedules": { en: "No schedules", ja: "スケジュールはありません", "zh-CN": "没有计划" },
  "No triggers": { en: "No triggers", ja: "トリガーはありません", "zh-CN": "没有触发器" },
  // Home launcher and unified workspace navigation copy.
  "Office": { en: "Office", ja: "文書", "zh-CN": "文档" },
  "Chat": { en: "Chat", ja: "チャット", "zh-CN": "聊天" },
  "Mission Control": { en: "Mission Control", ja: "状況", "zh-CN": "总览" },
  "Knowledge": { en: "Knowledge", ja: "ナレッジ", "zh-CN": "知识库" },
  "Git": { en: "Git", ja: "Git", "zh-CN": "Git" },
  "Review": { en: "Review", ja: "レビュー", "zh-CN": "审查" },
  "Sessions / Activity": { en: "Sessions / Activity", ja: "セッション・実行履歴", "zh-CN": "会话 / 活动" },
  "Browser": { en: "Browser", ja: "ブラウザー", "zh-CN": "浏览器" },
  "Developer Workflows": { en: "Developer Workflows", ja: "開発ワークフロー", "zh-CN": "开发工作流" },
  "DOCX editing, original files and AI proposals": { en: "DOCX editing, original files and AI proposals", ja: "DOCXの編集、元ファイル、AIへの提案", "zh-CN": "DOCX 编辑、原始文件和 AI 提案" },
  "Codex, OpenCode and API conversations": { en: "Codex, OpenCode and API conversations", ja: "Codex、OpenCode、APIでの会話", "zh-CN": "Codex、OpenCode 和 API 对话" },
  "Browse registered workspaces": { en: "Browse registered workspaces", ja: "登録済みのワークスペースを確認", "zh-CN": "浏览已注册的工作区" },
  "Agents, sessions, host and projects at a glance": { en: "Agents, sessions, host and projects at a glance", ja: "エージェント、セッション、ホスト、プロジェクトの概要", "zh-CN": "查看智能体、会话、主机和项目概况" },
  "Notes and project knowledge": { en: "Notes and project knowledge", ja: "メモとプロジェクトの情報", "zh-CN": "笔记和项目信息" },
  "Persistent project terminal sessions": { en: "Persistent project terminal sessions", ja: "プロジェクトのターミナルセッション", "zh-CN": "持久化的项目终端会话" },
  "Working tree and bounded diff viewer": { en: "Working tree and bounded diff viewer", ja: "作業ツリーと差分の確認", "zh-CN": "工作区和受限差异查看器" },
  "Changes, worktrees and GitHub task workflow": { en: "Changes, worktrees and GitHub task workflow", ja: "変更、作業ツリー、GitHubタスクの確認", "zh-CN": "更改、工作树和 GitHub 任务流程" },
  "Agent planning and orchestration": { en: "Agent planning and orchestration", ja: "エージェントの計画と実行管理", "zh-CN": "智能体规划和编排" },
  "Activity, queue, checkpoints and handoff": { en: "Activity, queue, checkpoints and handoff", ja: "アクティビティ、キュー、チェックポイント、引き継ぎ", "zh-CN": "活动、队列、检查点和交接" },
  "Project files, previews and browser automation": { en: "Project files, previews and browser automation", ja: "プロジェクトのファイル、プレビュー、ブラウザー自動化", "zh-CN": "项目文件、预览和浏览器自动化" },
  "Schedules, triggers, runs and bounded autopilot": { en: "Schedules, triggers, runs and bounded autopilot", ja: "スケジュール、トリガー、実行、範囲を限定した自動実行", "zh-CN": "计划、触发器、运行和受限自动执行" },
  "MCP, Skills, Rules, ACP, CI and verification": { en: "MCP, Skills, Rules, ACP, CI and verification", ja: "MCP、スキル、ルール、ACP、CI、検証", "zh-CN": "MCP、技能、规则、ACP、CI 和验证" },
  "Knowledge is not available yet. Its app shell is planned separately.": { en: "Knowledge is not available yet. Its app shell is planned separately.", ja: "ナレッジ機能は準備中です。専用画面は今後追加予定です。", "zh-CN": "知识库功能尚未开放，独立应用界面计划另行添加。" },
  "Browser does not have a separate app surface yet. Open Files & Preview from the sidebar.": { en: "Browser does not have a separate app surface yet. Open Files & Preview from the sidebar.", ja: "ブラウザー専用の画面はまだありません。サイドバーの「ファイルとプレビュー」を開いてください。", "zh-CN": "浏览器尚无独立界面，请从侧边栏打开“文件与预览”。" },
  "Preview": { en: "Preview", ja: "プレビュー", "zh-CN": "预览" },
  "Unavailable": { en: "Unavailable", ja: "利用不可", "zh-CN": "不可用" },
  "Knowledge, Preview": { en: "Knowledge, Preview", ja: "ナレッジ、プレビュー", "zh-CN": "知识库，预览" },
  "Browser, Preview": { en: "Browser, Preview", ja: "ブラウザー、プレビュー", "zh-CN": "浏览器，预览" },
  "DevMoter FAST Home": { en: "DevMoter FAST Home", ja: "DevMoter FAST ホーム", "zh-CN": "DevMoter FAST 首页" },
  "DevMoter workspace": { en: "DevMoter workspace", ja: "DevMoterのワークスペース", "zh-CN": "DevMoter 工作区" },
  "Current project": { en: "Current project", ja: "現在のプロジェクト", "zh-CN": "当前项目" },
  "Workspace": { en: "Workspace", ja: "ワークスペース", "zh-CN": "工作区" },
  "UNIFIED WORKSPACE": { en: "UNIFIED WORKSPACE", ja: "統合ワークスペース", "zh-CN": "统一工作区" },
  "AI backend": { en: "AI backend", ja: "AIバックエンド", "zh-CN": "AI 后端" },
  "API Chat": { en: "API Chat", ja: "APIチャット", "zh-CN": "API 聊天" },
  "Switch screen": { en: "Switch screen", ja: "画面を切り替え", "zh-CN": "切换页面" },
  "Tasks and sessions": { en: "Tasks and sessions", ja: "タスクとセッション", "zh-CN": "任务和会话" },
  "Current chat and conversation history": { en: "Current chat and conversation history", ja: "現在のチャットと会話履歴", "zh-CN": "当前聊天和对话记录" },
  "Review changes": { en: "Review changes", ja: "変更を確認", "zh-CN": "查看更改" },
  "Open tools": { en: "Open tools", ja: "ツールを開く", "zh-CN": "打开工具" },
  "Tools": { en: "Tools", ja: "ツール", "zh-CN": "工具" },
  "Chat を開く": { en: "Open Chat", ja: "チャットを開く", "zh-CN": "打开聊天" },
  "Projects を開く": { en: "Open Projects", ja: "プロジェクトを開く", "zh-CN": "打开项目" },
  "Terminal を開く": { en: "Open Terminal", ja: "ターミナルを開く", "zh-CN": "打开终端" },
  "Review を開く": { en: "Open Review", ja: "レビューを開く", "zh-CN": "打开审查" },
  "Sessions / Activity を開く": { en: "Open Sessions / Activity", ja: "セッション・実行履歴を開く", "zh-CN": "打开会话 / 活动" },
  "Office をもう一度開く": { en: "Reopen Office", ja: "文書をもう一度開く", "zh-CN": "重新打开文档" },
  "Chat をもう一度開く": { en: "Reopen Chat", ja: "チャットをもう一度開く", "zh-CN": "重新打开聊天" },
  "Projects をもう一度開く": { en: "Reopen Projects", ja: "プロジェクトをもう一度開く", "zh-CN": "重新打开项目" },
  "Mission Control をもう一度開く": { en: "Reopen Mission Control", ja: "状況をもう一度開く", "zh-CN": "重新打开总览" },
  "Terminal をもう一度開く": { en: "Reopen Terminal", ja: "ターミナルをもう一度開く", "zh-CN": "重新打开终端" },
  "Git をもう一度開く": { en: "Reopen Git", ja: "Gitをもう一度開く", "zh-CN": "重新打开 Git" },
  "Review をもう一度開く": { en: "Reopen Review", ja: "レビューをもう一度開く", "zh-CN": "重新打开审查" },
  "Agents をもう一度開く": { en: "Reopen Agents", ja: "エージェントをもう一度開く", "zh-CN": "重新打开智能体" },
  "Sessions / Activity をもう一度開く": { en: "Reopen Sessions / Activity", ja: "セッション・実行履歴をもう一度開く", "zh-CN": "重新打开会话 / 活动" },
  "Automation をもう一度開く": { en: "Reopen Automation", ja: "自動化をもう一度開く", "zh-CN": "重新打开自动化" },
  "Developer Workflows をもう一度開く": { en: "Reopen Developer Workflows", ja: "開発ワークフローをもう一度開く", "zh-CN": "重新打开开发工作流" },
  "Chat、Git、Terminalなどを検索": { en: "Search Chat, Git, Terminal, and more", ja: "チャット、Git、ターミナルなどを検索", "zh-CN": "搜索聊天、Git、终端等" },
  "0 modules": { en: "0 modules", ja: "0件", "zh-CN": "0 个模块" },
  "1 modules": { en: "1 modules", ja: "1件", "zh-CN": "1 个模块" },
  "2 modules": { en: "2 modules", ja: "2件", "zh-CN": "2 个模块" },
  "3 modules": { en: "3 modules", ja: "3件", "zh-CN": "3 个模块" },
  "4 modules": { en: "4 modules", ja: "4件", "zh-CN": "4 个模块" },
  "5 modules": { en: "5 modules", ja: "5件", "zh-CN": "5 个模块" },
  "6 modules": { en: "6 modules", ja: "6件", "zh-CN": "6 个模块" },
  "7 modules": { en: "7 modules", ja: "7件", "zh-CN": "7 个模块" },
  "8 modules": { en: "8 modules", ja: "8件", "zh-CN": "8 个模块" },
  "9 modules": { en: "9 modules", ja: "9件", "zh-CN": "9 个模块" },
  "10 modules": { en: "10 modules", ja: "10件", "zh-CN": "10 个模块" },
  "11 modules": { en: "11 modules", ja: "11件", "zh-CN": "11 个模块" },
  "12 modules": { en: "12 modules", ja: "12件", "zh-CN": "12 个模块" },
  "13 modules": { en: "13 modules", ja: "13件", "zh-CN": "13 个模块" },
  // Review and task workflow copy (#515).
  "Review changes and tasks": { en: "Review changes and tasks", ja: "変更とタスクを確認", "zh-CN": "查看更改和任务" },
  "DEVMOTER WORKFLOW": { en: "DEVMOTER WORKFLOW", ja: "DevMoterのワークフロー", "zh-CN": "DEVMOTER 工作流" },
  "Workflow sections": { en: "Workflow sections", ja: "ワークフローのセクション", "zh-CN": "工作流分区" },
  "Pending review never mutates files.": { en: "Pending review never mutates files.", ja: "確認中の変更はファイルに反映されません。", "zh-CN": "待审核的更改不会修改文件。" },
  "No staged change sets yet. Agent integrations can POST proposals to the workflow API.": { en: "No staged change sets yet. Agent integrations can POST proposals to the workflow API.", ja: "変更セットはまだありません。エージェント連携からWorkflow APIに提案を送信できます。", "zh-CN": "目前没有暂存的更改集。可通过智能体集成向工作流 API 提交提案。" },
  "No active task worktrees.": { en: "No active task worktrees.", ja: "実行中の作業ツリーはありません。", "zh-CN": "没有正在使用的任务工作树。" }
};

function resolveLanguage(): DevMoterLanguage {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "ja" || saved === "zh-CN") return saved;
  return "ja";
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
  return Boolean(element?.closest(".cx-message, .ocx-message, .api-message, pre, code, [data-i18n-skip]"));
}

function translateTextNode(node: Text) {
  if (shouldSkip(node.parentElement)) return;
  const exact = dictionary[node.data]?.[currentLanguage];
  if (exact && exact !== node.data) {
    node.data = exact;
    return;
  }
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
