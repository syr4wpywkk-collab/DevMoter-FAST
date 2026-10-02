const github = document.querySelector("#github");
const localLogin = document.querySelector("#localLogin");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const recovery = document.querySelector("#recovery");
const device = document.querySelector("#device");
const userCode = document.querySelector("#userCode");
const verifyLink = document.querySelector("#verifyLink");
const copyCode = document.querySelector("#copyCode");
const message = document.querySelector("#message");

let authStatus = null;
let activeFlow = "";
let pollTimer = 0;

function setMessage(text, tone = "") {
  message.textContent = text || "";
  message.className = "message" + (tone ? " " + tone : "");
}

async function json(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || ("HTTP " + response.status));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadStatus() {
  authStatus = await json("/api/auth/status");
  if (authStatus.authenticated) {
    location.replace("/");
    return;
  }
  if (!authStatus.github?.configured) {
    github.disabled = true;
    github.textContent = "GitHubログイン — 設定が必要";
    setMessage("Chromebook側で DEVMOTER_GITHUB_CLIENT_ID を設定するとGitHubログインを有効化できます。");
  } else if (!authStatus.github?.bound) {
    github.textContent = "GitHubをオーナーとして接続";
    recovery.open = true;
    setMessage("初回のGitHub接続だけ、ローカル復旧パスワードで本人確認します。");
  }
}

async function signInLocal() {
  localLogin.disabled = true;
  setMessage("確認中…");
  try {
    await json("/api/auth/local/login", {
      method: "POST",
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    setMessage("ログインしました。", "ok");
    location.replace("/");
  } catch (error) {
    setMessage(error.message || String(error), "error");
  } finally {
    localLogin.disabled = false;
  }
}

async function startGithub() {
  github.disabled = true;
  setMessage("GitHub認証を準備中…");
  try {
    const body = authStatus?.github?.bound
      ? {}
      : { username: username.value, password: password.value };
    const flow = await json("/api/auth/github/start", {
      method: "POST",
      body: JSON.stringify(body)
    });
    activeFlow = flow.flowId;
    userCode.textContent = flow.userCode;
    verifyLink.href = flow.verificationUri;
    device.classList.remove("hidden");
    setMessage("GitHubでコードを承認してください。");
    window.open(flow.verificationUri, "_blank", "noopener,noreferrer");
    schedulePoll(Math.max(1000, Number(flow.interval || 5) * 1000));
  } catch (error) {
    if (error.status === 403 && !authStatus?.github?.bound) recovery.open = true;
    setMessage(error.message || String(error), "error");
    github.disabled = false;
  }
}

function schedulePoll(delay) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollGithub, delay);
}

async function pollGithub() {
  if (!activeFlow) return;
  try {
    const result = await json("/api/auth/github/poll", {
      method: "POST",
      body: JSON.stringify({ flowId: activeFlow })
    });
    if (result.status === "complete") {
      setMessage("GitHubでログインしました。", "ok");
      location.replace("/");
      return;
    }
    schedulePoll(Math.max(1000, Number(result.retryAfterMs || 5000)));
  } catch (error) {
    activeFlow = "";
    github.disabled = false;
    setMessage(error.message || String(error), "error");
  }
}

copyCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(userCode.textContent || "");
    copyCode.textContent = "コピー済み";
    setTimeout(() => { copyCode.textContent = "コピー"; }, 1400);
  } catch {
    setMessage("コードを長押ししてコピーしてください。", "error");
  }
});
github.addEventListener("click", startGithub);
localLogin.addEventListener("click", signInLocal);
password.addEventListener("keydown", event => {
  if (event.key === "Enter") signInLocal();
});

loadStatus().catch(error => setMessage(error.message || String(error), "error"));
