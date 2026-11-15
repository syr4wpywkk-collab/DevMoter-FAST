    const STORAGE_KEY = "devmoter-language";
    const I18N = {
      en: {
        pageTitle: "Sign in · DevMoter FAST",
        brandSubtitle: "Your AI coding agents, anywhere.",
        signInCardLabel: "Sign in",
        languageLabel: "Language",
        githubDevicePrompt: "Enter this code on GitHub to finish signing in.",
        openGithub: "Open GitHub",
        copyCode: "Copy code",
        copied: "Copied",
        copyCodeManual: "Select and copy the code above.",
        otherOptions: "Other options",
        useLocalRecovery: "Use local recovery",
        setupRecoverySummary: "Set up a sign-in method with local recovery",
        usernameLabel: "Username",
        recoveryPasswordLabel: "Recovery password",
        continueRecovery: "Continue with recovery",
        sessionFoot: "Your session stays signed in securely on this device.",
        passkey: "Continue with a passkey",
        verifyPasskey: "Verify with Passkey",
        github: "Continue with GitHub",
        google: "Continue with Google",
        microsoft: "Continue with Microsoft",
        providerNamePasskey: "Passkey",
        stepUpRequired: "This host requires an additional Passkey check.",
        noProvidersRecovery: "Use local recovery to sign in and set up a sign-in method.",
        oauthErrGoogle: "Google sign-in could not be completed.",
        oauthErrMicrosoft: "Microsoft sign-in could not be completed.",
        oauthErrUnlinked: "That account is not connected to this DevMoter owner.",
        oauthErrExpired: "That sign-in link expired. Please try again.",
        oauthErrDenied: "Sign-in was cancelled.",
        oauthErrFailed: "Sign-in could not be completed. Please try again.",
        oauthErrLinkConflict: "That account is already connected to another owner.",
        checkingRecovery: "Checking your recovery details…",
        errPasskeyUnsupported: "Passkeys are not supported in this browser.",
        signedInRedirecting: "Signed in. Redirecting…",
        linkAfterRecovery: "Sign in with local recovery, then connect this method in Account settings.",
        githubFirstRecovery: "Use local recovery first to connect the first GitHub account.",
        approveGithubDevice: "Approve the code on GitHub. This page will finish automatically.",
        connectingSecurely: "Connecting securely…",
        cancelledOrTimedOut: "Sign-in was cancelled or timed out.",
        err401: "Those sign-in details were not accepted. Try again.",
        errUnlinkedProvider: "{provider} is not linked to this DevMoter owner yet. Sign in with recovery or a connected method first.",
        errUnavailableProvider: "{provider} sign-in is not available on this host.",
        errUnavailableGeneric: "That sign-in method is not available on this host.",
        errCancelled: "Sign-in was cancelled. You can try again.",
        errGeneric: "We could not sign you in. Please try again.",
        loadFailed: "Sign-in options could not be loaded. Refresh and try again."
      },
      ja: {
        pageTitle: "サインイン · DevMoter FAST",
        brandSubtitle: "どこからでも使える AI コーディングエージェント",
        signInCardLabel: "サインイン",
        languageLabel: "言語",
        githubDevicePrompt: "GitHub にこのコードを入力してサインインを完了してください。",
        openGithub: "GitHub を開く",
        copyCode: "コードをコピー",
        copied: "コピーしました",
        copyCodeManual: "上のコードを選択してコピーしてください。",
        otherOptions: "その他の方法",
        useLocalRecovery: "ローカル復旧を使う",
        setupRecoverySummary: "ローカル復旧でサインイン方法を設定",
        usernameLabel: "ユーザー名",
        recoveryPasswordLabel: "復旧パスワード",
        continueRecovery: "復旧パスワードで続ける",
        sessionFoot: "セッションはこの端末上で安全に維持されます。",
        passkey: "パスキーで続ける",
        verifyPasskey: "パスキーで確認",
        github: "GitHub で続ける",
        google: "Google で続ける",
        microsoft: "Microsoft で続ける",
        providerNamePasskey: "パスキー",
        stepUpRequired: "このホストでは追加のパスキー確認が必要です。",
        noProvidersRecovery: "ローカル復旧でサインインして、サインイン方法を設定してください。",
        oauthErrGoogle: "Google サインインを完了できませんでした。",
        oauthErrMicrosoft: "Microsoft サインインを完了できませんでした。",
        oauthErrUnlinked: "そのアカウントはこの DevMoter 所有者に連携されていません。",
        oauthErrExpired: "サインインリンクの有効期限が切れました。もう一度お試しください。",
        oauthErrDenied: "サインインはキャンセルされました。",
        oauthErrFailed: "サインインを完了できませんでした。もう一度お試しください。",
        oauthErrLinkConflict: "そのアカウントはすでに別の所有者に連携されています。",
        checkingRecovery: "復旧情報を確認しています…",
        errPasskeyUnsupported: "このブラウザではパスキーがサポートされていません。",
        signedInRedirecting: "サインインしました。リダイレクト中…",
        linkAfterRecovery: "ローカル復旧でサインインしてから、アカウント設定でこの方法を接続してください。",
        githubFirstRecovery: "最初に GitHub アカウントを接続するには、まずローカル復旧を使用してください。",
        approveGithubDevice: "GitHub でコードを承認してください。このページは自動で完了します。",
        connectingSecurely: "安全に接続しています…",
        cancelledOrTimedOut: "サインインがキャンセルされたかタイムアウトしました。",
        err401: "サインイン情報が一致しませんでした。もう一度お試しください。",
        errUnlinkedProvider: "{provider} はまだこの DevMoter 所有者に連携されていません。まず復旧または連携済みの方法でサインインしてください。",
        errUnavailableProvider: "{provider} サインインはこのホストでは利用できません。",
        errUnavailableGeneric: "このサインイン方法はこのホストでは利用できません。",
        errCancelled: "サインインはキャンセルされました。もう一度お試しください。",
        errGeneric: "サインインできませんでした。もう一度お試しください。",
        loadFailed: "サインイン方法の読み込みに失敗しました。再読み込みしてお試しください。"
      },
      "zh-Hans": {
        pageTitle: "登录 · DevMoter FAST",
        brandSubtitle: "随时随地掌控您的 AI 编程代理。",
        signInCardLabel: "登录",
        languageLabel: "语言",
        githubDevicePrompt: "请在 GitHub 上输入此代码以完成登录。",
        openGithub: "打开 GitHub",
        copyCode: "复制代码",
        copied: "已复制",
        copyCodeManual: "请选中并复制上方的代码。",
        otherOptions: "其他选项",
        useLocalRecovery: "使用本地恢复登录",
        setupRecoverySummary: "使用本地恢复设置登录方式",
        usernameLabel: "用户名",
        recoveryPasswordLabel: "恢复密码",
        continueRecovery: "使用恢复密码继续",
        sessionFoot: "您的会话将安全地保持在此设备上的登录状态。",
        passkey: "使用通行密钥继续",
        verifyPasskey: "使用通行密钥验证",
        github: "使用 GitHub 继续",
        google: "使用 Google 继续",
        microsoft: "使用 Microsoft 继续",
        providerNamePasskey: "通行密钥",
        stepUpRequired: "此主机需要额外的通行密钥验证。",
        noProvidersRecovery: "请使用本地恢复登录并设置一种登录方式。",
        oauthErrGoogle: "无法完成 Google 登录。",
        oauthErrMicrosoft: "无法完成 Microsoft 登录。",
        oauthErrUnlinked: "该账户尚未关联到此 DevMoter 所有者。",
        oauthErrExpired: "该登录链接已过期，请重试。",
        oauthErrDenied: "登录已取消。",
        oauthErrFailed: "无法完成登录，请重试。",
        oauthErrLinkConflict: "该账户已关联到其他所有者。",
        checkingRecovery: "正在验证恢复信息…",
        errPasskeyUnsupported: "当前浏览器不支持通行密钥。",
        signedInRedirecting: "登录成功，正在跳转…",
        linkAfterRecovery: "请先使用本地恢复登录，然后在账户设置中连接此方式。",
        githubFirstRecovery: "请先使用本地恢复登录，再连接首个 GitHub 账户。",
        approveGithubDevice: "请在 GitHub 上批准该代码。此页面将自动完成登录。",
        connectingSecurely: "正在安全连接…",
        cancelledOrTimedOut: "登录已取消或超时。",
        err401: "登录凭据未被接受，请重试。",
        errUnlinkedProvider: "{provider} 尚未关联到此 DevMoter 所有者。请先使用恢复密码或已连接的方式登录。",
        errUnavailableProvider: "此主机不支持 {provider} 登录。",
        errUnavailableGeneric: "此主机不支持该登录方式。",
        errCancelled: "登录已取消，您可以重试。",
        errGeneric: "无法完成登录，请重试。",
        loadFailed: "无法加载登录选项，请刷新后重试。"
      },
      "zh-Hant": {
        pageTitle: "登入 · DevMoter FAST",
        brandSubtitle: "隨時隨地掌控您的 AI 程式設計代理程式。",
        signInCardLabel: "登入",
        languageLabel: "語言",
        githubDevicePrompt: "請在 GitHub 上輸入此驗證碼以完成登入。",
        openGithub: "開啟 GitHub",
        copyCode: "複製驗證碼",
        copied: "已複製",
        copyCodeManual: "請選取並複製上方的驗證碼。",
        otherOptions: "其他選項",
        useLocalRecovery: "使用本機復原登入",
        setupRecoverySummary: "使用本機復原設定登入方式",
        usernameLabel: "使用者名稱",
        recoveryPasswordLabel: "復原密碼",
        continueRecovery: "使用復原密碼繼續",
        sessionFoot: "您的工作階段將安全地維持在此裝置的登入狀態。",
        passkey: "使用密碼金鑰繼續",
        verifyPasskey: "使用密碼金鑰驗證",
        github: "使用 GitHub 繼續",
        google: "使用 Google 繼續",
        microsoft: "使用 Microsoft 繼續",
        providerNamePasskey: "密碼金鑰",
        stepUpRequired: "此主機需要額外的密碼金鑰驗證。",
        noProvidersRecovery: "請使用本機復原登入並設定一種登入方式。",
        oauthErrGoogle: "無法完成 Google 登入。",
        oauthErrMicrosoft: "無法完成 Microsoft 登入。",
        oauthErrUnlinked: "該帳號尚未連結至此 DevMoter 擁有者。",
        oauthErrExpired: "該登入連結已過期，請重試。",
        oauthErrDenied: "已取消登入。",
        oauthErrFailed: "無法完成登入，請重試。",
        oauthErrLinkConflict: "該帳號已連結至其他擁有者。",
        checkingRecovery: "正在驗證復原資訊…",
        errPasskeyUnsupported: "此瀏覽器不支援密碼金鑰。",
        signedInRedirecting: "已登入，正在重新導向…",
        linkAfterRecovery: "請先使用本機復原登入，再於帳號設定中連結此登入方式。",
        githubFirstRecovery: "請先使用本機復原登入，以連結第一個 GitHub 帳號。",
        approveGithubDevice: "請在 GitHub 上核准此驗證碼。此頁面將自動完成登入。",
        connectingSecurely: "正在安全連線…",
        cancelledOrTimedOut: "登入已取消或逾時。",
        err401: "系統未接受該登入資訊，請重試。",
        errUnlinkedProvider: "{provider} 尚未連結至此 DevMoter 擁有者。請先使用復原密碼或已連結的登入方式登入。",
        errUnavailableProvider: "此主機不支援 {provider} 登入。",
        errUnavailableGeneric: "此主機不支援該登入方式。",
        errCancelled: "登入已取消，您可以重試。",
        errGeneric: "無法為您登入，請重試。",
        loadFailed: "無法載入登入選項，請重新整理後重試。"
      }
    };
    function normalizeLang(value) {
      const lower = String(value || "").trim().toLowerCase().replace(/_/g, "-");
      if (!lower) return "";
      if (lower === "ja" || lower.startsWith("ja-")) return "ja";
      if (lower === "en" || lower.startsWith("en-")) return "en";
      if (lower === "zh" || lower.startsWith("zh-")) {
        const subtags = lower.split("-").slice(1);
        const extIdx = subtags.indexOf("x");
        const tags = extIdx === -1 ? subtags : subtags.slice(0, extIdx);
        if (tags.includes("hant")) return "zh-Hant";
        if (tags.includes("hans")) return "zh-Hans";
        if (tags.includes("tw") || tags.includes("hk") || tags.includes("mo")) return "zh-Hant";
        return "zh-Hans";
      }
      return "";
    }
    function resolveInitialLang() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const stored = normalizeLang(raw);
        if (stored) {
          if (stored === "zh-Hans" && typeof raw === "string" && raw.trim().toLowerCase() === "zh") {
            try { localStorage.setItem(STORAGE_KEY, "zh-Hans"); } catch {}
          }
          return stored;
        }
      } catch {}
      const list = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
      for (const candidate of list) {
        const matched = normalizeLang(candidate);
        if (matched) return matched;
      }
      return "en";
    }
    let currentLang = resolveInitialLang();
    let activeMessageState = null;
    let copiedState = false;
    let needsSetupRecoverySummary = false;
    function tLogin(key, params = {}) {
      const dict = I18N[currentLang] || I18N.en;
      const template = dict[key] ?? I18N.en[key] ?? key;
      return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) =>
        params[k] === undefined || params[k] === null ? "" : String(params[k])
      );
    }

    const $ = selector => document.querySelector(selector);
    const providerRoot = $("#providers"), localLogin = $("#localLogin"), username = $("#username"), password = $("#password");
    const recovery = $("#recovery"), recoverySummary = $("#recoverySummary"), loginCard = $("#loginCard"), langSelect = $("#languageSelect");
    const device = $("#device"), userCode = $("#userCode"), verifyLink = $("#verifyLink"), copyCode = $("#copyCode"), message = $("#message");
    let authStatus = null, activeFlow = "", pollTimer = 0;
    const icons = {
      passkey:'<svg class="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="15" r="1.2" fill="currentColor"/></svg>',
      github:'<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.07c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 .1.74 2.1 3.2 1.54.1-.72.39-1.2.7-1.48-2.47-.28-5.07-1.24-5.07-5.5 0-1.21.43-2.2 1.15-2.98-.12-.28-.5-1.42.11-2.95 0 0 .94-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.1-1.43 3.04-1.14 3.04-1.14.61 1.53.23 2.67.12 2.95.71.78 1.14 1.77 1.14 2.98 0 4.27-2.61 5.21-5.1 5.49.4.34.75 1.02.75 2.05V22c0 .29.2.64.77.53A11.1 11.1 0 0 0 12 .9Z"/></svg>',
      google:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.24c1.9-1.75 2.98-4.32 2.98-7.37Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.4l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.75-5.6-4.1H3.05v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.94a6 6 0 0 1 0-3.88v-2.6H3.05a10 10 0 0 0 0 9.08l3.35-2.6Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.78.5 3.82 1.5l2.86-2.86C16.95 2.97 14.7 2 12 2a10 10 0 0 0-8.95 5.46l3.35 2.6c.8-2.35 3-4.1 5.6-4.1Z"/></svg>',
      microsoft:'<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#f25022" d="M2 2h9.5v9.5H2z"/><path fill="#7fba00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00a4ef" d="M2 12.5h9.5V22H2z"/><path fill="#ffb900" d="M12.5 12.5H22V22h-9.5z"/></svg>'
    };
    function renderMessageState() {
      if (!activeMessageState) {
        message.textContent = "";
        message.className = "message";
        return;
      }
      message.textContent = activeMessageState.key
        ? tLogin(activeMessageState.key, activeMessageState.params)
        : (activeMessageState.text || "");
      message.className = "message" + (activeMessageState.tone ? " " + activeMessageState.tone : "");
    }
    function setMessageKey(key, params = {}, tone = "") {
      activeMessageState = key ? { key, params, tone } : null;
      renderMessageState();
    }
    function providerDisplayName(provider) {
      const lower = String(provider || "").toLowerCase();
      if (lower === "github") return "GitHub";
      if (lower === "google") return "Google";
      if (lower === "microsoft") return "Microsoft";
      if (lower === "passkey") return tLogin("providerNamePasskey");
      return String(provider || "");
    }
    function humanErrorDesc(error, provider = "") {
      const status = Number(error?.status || 0), raw = String(error?.message || "").toLowerCase();
      if (status === 401) return { key: "err401", params: {} };
      if (status === 403 && provider) return { key: "errUnlinkedProvider", params: { provider: providerDisplayName(provider) } };
      if (status === 404 || raw.includes("not configured") || raw.includes("unavailable")) {
        return provider
          ? { key: "errUnavailableProvider", params: { provider: providerDisplayName(provider) } }
          : { key: "errUnavailableGeneric", params: {} };
      }
      if (raw.includes("cancel")) return { key: "errCancelled", params: {} };
      if (error?.i18nKey) return { key: error.i18nKey, params: {} };
      return { key: "errGeneric", params: {} };
    }
    async function json(path, init = {}) {
      const headers = new Headers(init.headers || {}); if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const response = await fetch(path, { ...init, headers, cache: "no-store" }); const payload = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(payload?.error || "Request failed"); error.status = response.status; throw error; } return payload;
    }
    function providerInfo(name) {
      const direct = authStatus?.providers?.[name] || authStatus?.[name] || {};
      if (name === "github") return { configured: Boolean(direct.configured), linked: Boolean(direct.linked ?? direct.bound), available: Boolean(direct.available ?? direct.configured) };
      return { configured: Boolean(direct.configured ?? (name === "passkey" && direct.enabled)), linked: Boolean(direct.linked ?? direct.bound ?? direct.enabled), available: Boolean(direct.available ?? direct.enabled ?? direct.configured) };
    }
    function makeButton(name, key, primary = false) {
      const label = tLogin(key);
      const button = document.createElement("button"); button.type = "button"; button.className = "provider" + (primary ? " primary" : ""); button.dataset.provider = name; button.dataset.i18nKey = key;
      button.setAttribute("aria-label", label); button.innerHTML = icons[name];
      const span = document.createElement("span"); span.textContent = label; button.appendChild(span);
      button.addEventListener("click", () => startProvider(name, button)); return button;
    }
    function renderProviders() {
      if (!authStatus) return;
      const passkey = providerInfo("passkey"), github = providerInfo("github"), google = providerInfo("google"), microsoft = providerInfo("microsoft");
      const methods = [];
      if (passkey.available) methods.push(["passkey", authStatus.stepUpRequired ? "verifyPasskey" : "passkey", true]);
      if (!authStatus.stepUpRequired) {
        if (github.configured) methods.push(["github", "github", !methods.length]);
        if (google.configured) methods.push(["google", "google", !methods.length]);
        if (microsoft.configured) methods.push(["microsoft", "microsoft", !methods.length]);
      }
      providerRoot.replaceChildren(...methods.map(item => makeButton(...item)));
      providerRoot.hidden = methods.length === 0;
      recovery.hidden = Boolean(authStatus.stepUpRequired);
      needsSetupRecoverySummary = !authStatus.stepUpRequired && !methods.length;
    }
    function applyTranslations() {
      document.documentElement.lang = currentLang;
      document.title = tLogin("pageTitle");
      if (loginCard) loginCard.setAttribute("aria-label", tLogin("signInCardLabel"));
      if (langSelect) {
        langSelect.value = currentLang;
        langSelect.setAttribute("aria-label", tLogin("languageLabel"));
      }
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        if (key) el.textContent = tLogin(key);
      });
      if (recoverySummary) {
        recoverySummary.textContent = tLogin(needsSetupRecoverySummary ? "setupRecoverySummary" : "useLocalRecovery");
      }
      if (copyCode) {
        copyCode.textContent = tLogin(copiedState ? "copied" : "copyCode");
      }
      if (authStatus) renderProviders();
      renderMessageState();
    }
    function setLoginLanguage(next) {
      const normalized = normalizeLang(next) || "en";
      currentLang = normalized;
      try { localStorage.setItem(STORAGE_KEY, normalized); } catch {}
      applyTranslations();
    }
    if (langSelect) {
      langSelect.addEventListener("change", () => setLoginLanguage(langSelect.value));
    }
    applyTranslations();

    async function loadStatus() {
      authStatus = await json("/api/auth/status");
      if (authStatus.authenticated && !authStatus.stepUpRequired) { location.replace("/"); return; }
      renderProviders();
      if (authStatus.stepUpRequired) setMessageKey("stepUpRequired");
      else if (needsSetupRecoverySummary) {
        if (recoverySummary) recoverySummary.textContent = tLogin("setupRecoverySummary");
        setMessageKey("noProvidersRecovery");
      }
      const params = new URLSearchParams(location.search);
      const errors = {
        google: "oauthErrGoogle",
        microsoft: "oauthErrMicrosoft",
        account_not_linked: "oauthErrUnlinked",
        expired: "oauthErrExpired",
        access_denied: "oauthErrDenied",
        oauth_error: "oauthErrFailed",
        state: "oauthErrExpired",
        link_conflict: "oauthErrLinkConflict"
      };
      const authErrorKey = errors[params.get("auth_error")];
      if (authErrorKey) setMessageKey(authErrorKey, {}, "error");
    }
    async function signInLocal() {
      localLogin.disabled = true; setMessageKey("checkingRecovery");
      try { await json("/api/auth/local/login", { method: "POST", body: JSON.stringify({ username: username.value, password: password.value }) }); password.value = ""; await loadStatus(); }
      catch (error) { const desc = humanErrorDesc(error); setMessageKey(desc.key, desc.params, "error"); }
      finally { localLogin.disabled = false; }
    }
    function decodeBase64url(value) { const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/"); const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
    function encodeBase64url(value) { const bytes = new Uint8Array(value); let raw = ""; bytes.forEach(byte => raw += String.fromCharCode(byte)); return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
    function credentialJSON(credential) {
      const response = { clientDataJSON: encodeBase64url(credential.response.clientDataJSON), authenticatorData: encodeBase64url(credential.response.authenticatorData), signature: encodeBase64url(credential.response.signature), userHandle: credential.response.userHandle ? encodeBase64url(credential.response.userHandle) : null };
      return { id: credential.id, rawId: encodeBase64url(credential.rawId), type: credential.type, authenticatorAttachment: credential.authenticatorAttachment, response, clientExtensionResults: credential.getClientExtensionResults?.() || {} };
    }
    async function startPasskey() {
      if (!window.PublicKeyCredential || !navigator.credentials) {
        const err = new Error("Passkeys unsupported"); err.i18nKey = "errPasskeyUnsupported"; throw err;
      }
      const options = await json("/api/auth/passkey/login/options", { method: "POST", body: "{}" });
      const publicKey = options.publicKey || options; publicKey.challenge = decodeBase64url(publicKey.challenge);
      if (publicKey.allowCredentials) publicKey.allowCredentials = publicKey.allowCredentials.map(item => ({ ...item, id: decodeBase64url(item.id) }));
      const credential = await navigator.credentials.get({ publicKey });
      if (!credential) {
        const err = new Error("Sign-in cancelled"); err.i18nKey = "errCancelled"; throw err;
      }
      await json("/api/auth/passkey/login/verify", { method: "POST", body: JSON.stringify({ challengeId: options.challengeId, response: credentialJSON(credential) }) });
      setMessageKey("signedInRedirecting", {}, "ok"); location.replace("/");
    }
    async function startOAuth(provider) {
      if (!providerInfo(provider).linked) { recovery.open = true; setMessageKey("linkAfterRecovery"); return; }
      const result = await json("/api/auth/" + provider + "/start", { method: "POST", body: "{}" });
      const target = result.authorizationUrl || result.url;
      if (!target) throw new Error("Provider unavailable");
      const destination = new URL(target, location.href); if (destination.protocol !== "https:" && destination.hostname !== "localhost" && destination.hostname !== "127.0.0.1") throw new Error("Provider unavailable");
      location.assign(destination.href);
    }
    async function startGithub() {
      const info = providerInfo("github");
      if (!info.linked && !authStatus.authenticated) { recovery.open = true; setMessageKey("githubFirstRecovery"); return; }
      const flow = await json("/api/auth/github/start", { method: "POST", body: "{}" }); activeFlow = flow.flowId;
      userCode.textContent = flow.userCode; verifyLink.href = flow.verificationUri; device.hidden = false;
      setMessageKey("approveGithubDevice"); schedulePoll(Math.max(1000, Number(flow.interval || 5) * 1000));
    }
    async function startProvider(name, button) {
      button.disabled = true; setMessageKey("connectingSecurely");
      try { if (name === "passkey") await startPasskey(); else if (name === "github") await startGithub(); else await startOAuth(name); }
      catch (error) {
        if (error?.name === "NotAllowedError") setMessageKey("cancelledOrTimedOut", {}, "error");
        else { const desc = humanErrorDesc(error, name); setMessageKey(desc.key, desc.params, "error"); }
      }
      finally { button.disabled = false; }
    }
    function schedulePoll(delay) { clearTimeout(pollTimer); pollTimer = setTimeout(pollGithub, delay); }
    async function pollGithub() {
      if (!activeFlow) return;
      try {
        const result = await json("/api/auth/github/poll", { method: "POST", body: JSON.stringify({ flowId: activeFlow }) });
        if (result.status === "complete") { activeFlow = ""; device.hidden = true; await loadStatus(); return; }
        schedulePoll(Math.max(1000, Number(result.retryAfterMs || 5000)));
      } catch (error) { activeFlow = ""; const desc = humanErrorDesc(error, "GitHub"); setMessageKey(desc.key, desc.params, "error"); }
    }
    copyCode.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(userCode.textContent || "");
        copiedState = true;
        copyCode.textContent = tLogin("copied");
        setTimeout(() => { copiedState = false; copyCode.textContent = tLogin("copyCode"); }, 1400);
      } catch { setMessageKey("copyCodeManual"); }
    });
    localLogin.addEventListener("click", signInLocal); password.addEventListener("keydown", event => { if (event.key === "Enter") signInLocal(); });
    loadStatus().catch(() => setMessageKey("loadFailed", {}, "error"));
