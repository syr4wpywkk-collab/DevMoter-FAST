(() => {
  'use strict';
  const STORAGE = 'qcm.state.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { chats: [], activeChatId: null, providers: [], keys: new Map(), activeProviderId: null, activeModel: '', draftImages: [], busyChatIds: new Set(), selectedProviderId: null, toastTimer: null };
  const IMAGE_DB = 'qcm.images.v1';
  let imageDbPromise;
  let saveQueue = Promise.resolve();
  const el = {
    sidebar: $('#sidebar'), scrim: $('#sidebar-scrim'), history: $('#history-list'), statusDot: $('#status-dot'), apiStatus: $('#api-status-label'), modelTrigger: $('#model-trigger'), attachButton: $('#attach-button'), conversation: $('#conversation'), modelLabel: $('#active-model-label'), popover: $('#model-popover'), tabs: $('#provider-tabs'), results: $('#model-results'), search: $('#model-search'), footnote: $('#model-footnote'), modal: $('#api-modal'), apiForm: $('#api-form'), apiName: $('#api-name'), apiUrl: $('#api-url'), apiKey: $('#api-key'), apiError: $('#api-error'), apiSubmit: $('#api-submit'), welcome: $('#welcome'), messageList: $('#message-list'), anchor: $('#scroll-anchor'), form: $('#composer-form'), input: $('#message-input'), send: $('#send-button'), imageInput: $('#image-input'), attachmentPreview: $('#attachment-preview'), toast: $('#toast')
  };
  const icon = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2v-6a7.5 7.5 0 1 1 17-3.5Z"/></svg>',
    check: '<span class="check" aria-hidden="true">✓</span>'
  };

  function openImageDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDBに対応していません'));
    if (!imageDbPromise) imageDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(IMAGE_DB, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images', { keyPath: 'id' }); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error('画像データベースを開けませんでした'));
    });
    return imageDbPromise;
  }
  function transactionDone(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error('画像の保存が中断されました')); }); }
  async function saveImageRecords(chats) {
    const images = new Map();
    for (const chat of chats) for (const message of chat.messages || []) for (const image of message.images || []) if (image?.id && image.data) images.set(image.id, { id: image.id, name: image.name || '添付画像', data: image.data });
    const db = await openImageDb();
    const read = db.transaction('images', 'readonly'); const existing = await new Promise((resolve, reject) => { const request = read.objectStore('images').getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await transactionDone(read);
    const transaction = db.transaction('images', 'readwrite'); const done = transactionDone(transaction); const store = transaction.objectStore('images');
    for (const image of images.values()) store.put(image);
    const keep = new Set(images.keys()); for (const id of existing) if (!keep.has(id)) store.delete(id);
    await done;
  }
  async function hydrateImages(chats) {
    const db = await openImageDb(); const transaction = db.transaction('images', 'readonly');
    const records = await new Promise((resolve, reject) => { const request = transaction.objectStore('images').getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error); });
    const stored = new Map(records.map(image => [image.id, image]));
    for (const chat of chats) for (const message of chat.messages || []) if (Array.isArray(message.images)) message.images = message.images.map(image => {
      if (image.data) return image; // Legacy localStorage Data URL; save() migrates it to IndexedDB.
      const record = stored.get(image.id); return record ? { id: record.id, name: record.name, data: record.data } : { ...image, data: '', missing: true };
    });
  }
  function serializeChat(chat) { return { ...chat, messages: (chat.messages || []).map(message => ({ ...message, ...(Array.isArray(message.images) ? { images: message.images.map(({ id, name }) => ({ id, name })) } : {}) })) }; }
  async function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      state.providers = Array.isArray(saved.providers) ? saved.providers : [];
      state.chats = Array.isArray(saved.chats) ? saved.chats : [];
      state.activeChatId = saved.activeChatId || state.chats[0]?.id || null;
      state.activeProviderId = saved.activeProviderId || null;
      state.activeModel = saved.activeModel || '';
      if (state.chats.length) await hydrateImages(state.chats);
    } catch (_) { if (!state.chats.length) { state.providers = []; state.chats = []; } toast('保存済み画像を読み込めませんでした'); }
    if (!state.chats.length) createChat(false);
    if (!state.chats.some(chat => chat.id === state.activeChatId)) state.activeChatId = state.chats[0]?.id || null;
    renderAll();
    await save(); // Also migrates older Data URLs out of localStorage.
  }
  function save() {
    const chats = state.chats.slice(-40);
    const payload = { providers: state.providers.map(({ id, name, baseUrl, models }) => ({ id, name, baseUrl, models: (models || []).slice(0, 300) })), chats: chats.map(serializeChat), activeChatId: state.activeChatId, activeProviderId: state.activeProviderId, activeModel: state.activeModel };
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      let imagesSaved = false;
      try { await saveImageRecords(chats); imagesSaved = true; } catch (_) { toast('画像をIndexedDBに保存できませんでした。画像データは可能な範囲で端末に残します'); }
      const storedPayload = imagesSaved ? payload : { ...payload, chats };
      try { localStorage.setItem(STORAGE, JSON.stringify(storedPayload)); } catch (_) { toast('端末の保存容量が足りず、履歴を保存できませんでした'); }
    });
    return saveQueue;
  }
  function activeChat() { return state.chats.find(chat => chat.id === state.activeChatId); }
  function createChat(announce = true) {
    const chat = { id: crypto.randomUUID(), title: '新しいチャット', updatedAt: Date.now(), messages: [] };
    state.chats.unshift(chat); state.activeChatId = chat.id; save(); renderAll(); updateSend(); closeSidebar(); closePopover();
    if (announce) el.input.focus();
  }
  function switchChat(id) { if (!state.chats.some(chat => chat.id === id)) return; state.activeChatId = id; save(); renderAll(); updateSend(); closeSidebar(); }
  function toggleSidebar() {
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    if (mobile) { el.sidebar.classList.toggle('open'); el.scrim.classList.toggle('show', el.sidebar.classList.contains('open')); }
    else el.sidebar.classList.toggle('collapsed');
    syncMenuAccessibility();
    if (mobile && el.sidebar.classList.contains('open')) document.querySelector('.sidebar-close')?.focus({ preventScroll: true });
  }
  function syncMenuAccessibility() {
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    if (mobile) el.sidebar.classList.remove('collapsed');
    else { el.sidebar.classList.remove('open'); el.scrim.classList.remove('show'); }
    const expanded = mobile ? el.sidebar.classList.contains('open') : !el.sidebar.classList.contains('collapsed');
    document.querySelector('.menu-button')?.setAttribute('aria-expanded', String(expanded));
    if (mobile && !expanded) el.sidebar.setAttribute('inert', '');
    else el.sidebar.removeAttribute('inert');
  }
  function closeSidebar() {
    const restoreFocus = window.matchMedia('(max-width: 760px)').matches && el.sidebar.classList.contains('open');
    el.sidebar.classList.remove('open'); el.sidebar.classList.remove('collapsed'); el.scrim.classList.remove('show'); syncMenuAccessibility();
    if (restoreFocus) document.querySelector('.menu-button')?.focus({ preventScroll: true });
  }
  function openPopover() { el.popover.hidden = false; el.modelTrigger.setAttribute('aria-expanded', 'true'); renderModels(); el.search.focus({ preventScroll: true }); }
  function closePopover() { el.popover.hidden = true; el.modelTrigger.setAttribute('aria-expanded', 'false'); }
  function openApi(provider = null) {
    closePopover();
    el.apiForm.reset(); el.apiError.hidden = true;
    el.apiName.value = provider?.name || '';
    el.apiUrl.value = provider?.baseUrl || '';
    el.apiKey.value = '';
    el.apiKey.placeholder = provider && !state.keys.has(provider.id) ? '再接続するためのAPIキー' : 'sk-…（保存されません）';
    el.apiSubmit.textContent = provider ? '再接続してモデルを取得' : '接続してモデルを取得';
    el.modal.dataset.providerId = provider?.id || '';
    el.modal.hidden = false;
    setTimeout(() => el.apiName.focus(), 20);
  }
  function closeApi() { el.modal.hidden = true; el.apiKey.value = ''; }
  function toast(message) {
    el.toast.textContent = message; el.toast.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }
  function safeTitle(text) { const clean = text.trim().replace(/\s+/g, ' '); return clean.length > 30 ? clean.slice(0, 29) + '…' : (clean || '新しいチャット'); }
  function escapeAttr(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function renderAll() { renderHistory(); renderMessages(); renderModelLabel(); renderStatus(); }
  function renderHistory() {
    el.history.replaceChildren();
    for (const chat of state.chats.slice().sort((a, b) => b.updatedAt - a.updatedAt)) {
      const button = document.createElement('button'); button.className = 'history-item' + (chat.id === state.activeChatId ? ' active' : ''); button.dataset.chatId = chat.id; button.innerHTML = icon.chat + `<span>${escapeAttr(chat.title)}</span>`; button.title = chat.title;
      if (chat.id === state.activeChatId) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => switchChat(chat.id)); el.history.append(button);
    }
  }
  function renderMessages() {
    const chat = activeChat(); const messages = chat?.messages || [];
    el.welcome.hidden = messages.length > 0; el.messageList.replaceChildren();
    for (const message of messages) {
      const row = document.createElement('article'); row.className = `message ${message.role}${message.error ? ' error' : ''}`;
      if (message.role === 'assistant') { const mark = document.createElement('div'); mark.className = 'assistant-mark'; mark.textContent = '✳'; row.append(mark); }
      const bubble = document.createElement('div'); bubble.className = 'message-bubble';
      if (message.role === 'assistant') { const label = document.createElement('div'); label.className = 'message-label'; label.textContent = 'Qwen'; bubble.append(label); }
      if (message.images?.length) { const images = document.createElement('div'); images.className = 'message-images'; for (const image of message.images) { if (!image.data) { const missing = document.createElement('span'); missing.className = 'missing-image'; missing.textContent = '画像データを読み込めません'; images.append(missing); continue; } const img = document.createElement('img'); img.src = image.data; img.alt = image.name || '添付画像'; images.append(img); } bubble.append(images); }
      if (message.pending) { bubble.append(document.createTextNode('考えています')); const dots = document.createElement('span'); dots.className = 'typing-dots'; dots.innerHTML = '<i></i><i></i><i></i>'; bubble.append(dots); }
      else { const text = document.createElement('div'); text.textContent = message.content || ''; bubble.append(text); }
      row.append(bubble); el.messageList.append(row);
    }
    requestAnimationFrame(() => el.conversation?.scrollTo({ top: el.conversation.scrollHeight, behavior: 'smooth' }));
  }
  function renderModelLabel() {
    const provider = state.providers.find(item => item.id === state.activeProviderId);
    el.modelLabel.textContent = state.activeModel ? state.activeModel : provider ? `${provider.name} · モデルを選択` : 'モデルを選択';
  }
  function renderStatus() {
    const connected = state.providers.some(provider => state.keys.has(provider.id));
    el.statusDot.classList.toggle('connected', connected); el.apiStatus.textContent = connected ? 'API接続済み' : state.providers.length ? 'キーを再入力してください' : 'API未接続';
  }
  function renderModels() {
    const query = el.search.value.trim().toLowerCase();
    if (!state.providers.some(provider => provider.id === state.selectedProviderId)) state.selectedProviderId = state.activeProviderId || state.providers[0]?.id || null;
    el.tabs.replaceChildren();
    if (state.providers.length > 1) for (const provider of state.providers) {
      const tab = document.createElement('button'); tab.className = 'provider-tab' + (provider.id === state.selectedProviderId ? ' active' : ''); tab.textContent = provider.name; tab.addEventListener('click', () => { state.selectedProviderId = provider.id; renderModels(); }); el.tabs.append(tab);
    }
    el.results.replaceChildren();
    const provider = state.providers.find(item => item.id === state.selectedProviderId);
    if (!provider) { el.footnote.textContent = ''; return; }
    const models = (provider.models || []).filter(model => model.toLowerCase().includes(query));
    for (const model of models.slice(0, 60)) appendModel(provider, model);
    if (!models.length) {
      const empty = document.createElement('div'); empty.className = 'empty-models'; empty.textContent = provider.models?.length ? '一致するモデルがありません。' : 'モデルが見つかりません。'; el.results.append(empty);
    }
    if (query && !models.some(model => model.toLowerCase() === query)) {
      const manual = document.createElement('button'); manual.className = 'model-manual'; manual.innerHTML = `<span>「${escapeAttr(el.search.value.trim())}」をモデルIDとして使う</span><span>↵</span>`; manual.addEventListener('click', () => chooseModel(provider, el.search.value.trim())); el.results.append(manual);
    }
    el.footnote.textContent = '';
  }
  function appendModel(provider, model) {
    const button = document.createElement('button'); const selected = provider.id === state.activeProviderId && model === state.activeModel; button.className = 'model-option' + (selected ? ' selected' : '');
    const copy = document.createElement('span'); copy.textContent = model; const details = document.createElement('small'); details.textContent = provider.name; copy.append(details); button.append(copy); if (selected) button.insertAdjacentHTML('beforeend', icon.check);
    button.addEventListener('click', () => chooseModel(provider, model)); el.results.append(button);
  }
  function chooseModel(provider, model) { state.activeProviderId = provider.id; state.activeModel = model; save(); renderModelLabel(); renderStatus(); closePopover(); }
  function normalizeBase(input) {
    const raw = input.trim();
    if (/[\s?#\\%]/.test(raw)) throw new Error('URLに空白・クエリ・フラグメント・エンコード文字は指定できません');
    const rawPath = raw.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*([^?#]*)$/)?.[1] || '/';
    if (rawPath.split('/').some(part => part === '.' || part === '..')) throw new Error('URLのパスに . や .. は指定できません');
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URLはhttps://で始めてください');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('HTTP接続はlocalhostのみ利用できます');
    if (!url.hostname || url.username || url.password) throw new Error('有効なホスト名を指定してください。ユーザー名やパスワードは使えません');
    if (url.search || url.hash) throw new Error('URLにクエリやフラグメントは指定できません');
    if (url.pathname.includes('%') || url.pathname.includes('\\') || url.pathname.split('/').some(part => part === '.' || part === '..')) throw new Error('URLのパスに使用できない文字が含まれています');
    if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(url.pathname)) throw new Error('URLのパスは英数字と / . _ ~ - のみ使用できます');
    const path = url.pathname.replace(/\/(chat\/completions|models)\/?$/i, '').replace(/\/$/, '');
    return url.origin + path;
  }
  function endpoint(provider, path) { return provider.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, ''); }
  async function loadModels(provider, key) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 90000);
    let response; let data;
    try { response = await fetch(endpoint(provider, 'models'), { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: controller.signal }); data = await response.json().catch(() => ({})); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `モデルの取得に失敗しました（${response.status}）`);
    const models = Array.isArray(data?.data) ? data.data.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean) : Array.isArray(data?.models) ? data.models.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean) : [];
    return [...new Set(models)].sort((a, b) => a.localeCompare(b));
  }
  async function submitApi(event) {
    event.preventDefault(); const previousText = el.apiSubmit.textContent; el.apiError.hidden = true;
    const providerId = el.modal.dataset.providerId; const existing = state.providers.find(item => item.id === providerId);
    const name = el.apiName.value.trim(); const key = el.apiKey.value.trim();
    if (!key) { showApiError('APIキーを入力してください。キーは保存せず、このタブのメモリ内だけで使用します。'); return; }
    let baseUrl;
    try { baseUrl = normalizeBase(el.apiUrl.value); } catch (error) { showApiError(error.message); return; }
    const provider = existing || { id: crypto.randomUUID(), name, baseUrl, models: [] };
    provider.name = name; provider.baseUrl = baseUrl;
    el.apiSubmit.disabled = true; el.apiSubmit.textContent = 'モデルを取得中…';
    try {
      const models = await loadModels(provider, key);
      if (!state.providers.some(item => item.id === provider.id)) state.providers.unshift(provider);
      provider.models = models; state.keys.set(provider.id, key); state.selectedProviderId = provider.id; state.activeProviderId = provider.id;
      if (!state.activeModel || !models.includes(state.activeModel)) state.activeModel = models[0] || '';
      save(); closeApi(); renderAll(); renderModels(); el.popover.hidden = false; el.modelTrigger.setAttribute('aria-expanded', 'true'); toast(models.length ? `${models.length}個のモデルを読み込みました` : '接続しました。モデルIDを検索欄に入力できます');
    } catch (error) { showApiError(`${error.message}。URLがOpenAI互換の /v1/models に対応し、ブラウザから接続できるか確認してください。`); }
    finally { el.apiSubmit.disabled = false; el.apiSubmit.textContent = previousText; }
  }
  function showApiError(message) { el.apiError.textContent = message; el.apiError.hidden = false; }
  async function refreshModels() {
    const provider = state.providers.find(item => item.id === state.selectedProviderId); if (!provider) { openApi(); return; }
    const key = state.keys.get(provider.id); if (!key) { openApi(provider); return; }
    el.footnote.textContent = 'モデルを再読み込み中…';
    try { provider.models = await loadModels(provider, key); save(); renderModels(); toast(`${provider.models.length}個のモデルに更新しました`); }
    catch (error) { el.footnote.textContent = error.message; toast('モデルを取得できませんでした'); }
  }
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image(); const objectUrl = URL.createObjectURL(file);
      image.onload = () => { const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(objectUrl); resolve({ id: crypto.randomUUID(), name: file.name, data: canvas.toDataURL('image/jpeg', .78) }); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('画像を読み込めませんでした')); }; image.src = objectUrl;
    });
  }
  async function addImages(files) {
    const choices = Array.from(files || []).filter(file => file.type.startsWith('image/'));
    for (const file of choices.slice(0, 4 - state.draftImages.length)) {
      try { state.draftImages.push(await resizeImage(file)); } catch (_) { toast('画像を追加できませんでした'); }
    }
    if (choices.length > 4) toast('画像は一度に4枚まで添付できます');
    renderAttachments(); updateSend(); el.imageInput.value = '';
  }
  function renderAttachments() {
    el.attachmentPreview.replaceChildren(); el.attachmentPreview.hidden = !state.draftImages.length;
    for (const image of state.draftImages) { const chip = document.createElement('div'); chip.className = 'attachment-chip'; const img = document.createElement('img'); img.src = image.data; img.alt = image.name; const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `${image.name}を削除`); remove.addEventListener('click', () => { state.draftImages = state.draftImages.filter(item => item.id !== image.id); renderAttachments(); updateSend(); }); chip.append(img, remove); el.attachmentPreview.append(chip); }
  }
  function updateSend() { el.send.disabled = state.busyChatIds.has(state.activeChatId) || (!el.input.value.trim() && !state.draftImages.length); }
  function messageContentFromResponse(data) {
    const content = data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.choices?.[0]?.text;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').filter(Boolean).join('\n').trim();
    return '';
  }
  async function sendMessage(event) {
    event.preventDefault(); const content = el.input.value.trim(); const images = state.draftImages.slice();
    if ((!content && !images.length) || state.busyChatIds.has(state.activeChatId)) return;
    const provider = state.providers.find(item => item.id === state.activeProviderId); const key = provider && state.keys.get(provider.id);
    if (!provider || !state.activeModel) { toast('先にモデルを選択してください'); openPopover(); return; }
    if (!key) { toast('APIキーを再入力してください'); openApi(provider); return; }
    const chat = activeChat(); if (!chat) return;
    const chatId = chat.id; const model = state.activeModel;
    const userMessage = { role: 'user', content, images };
    chat.messages.push(userMessage); if (chat.messages.length === 1) chat.title = safeTitle(content || '画像について相談'); chat.updatedAt = Date.now();
    state.draftImages = []; el.input.value = ''; el.input.style.height = 'auto'; renderAttachments();
    const pending = { role: 'assistant', content: '', pending: true }; chat.messages.push(pending); state.busyChatIds.add(chatId); updateSend(); renderAll();
    const payload = chat.messages.filter(item => !item.pending && !item.error).map(item => {
      const text = item.content || '';
      if (item.role === 'user' && item.images?.length) return { role: item.role, content: [{ type: 'text', text }, ...item.images.filter(image => image.data).map(image => ({ type: 'image_url', image_url: { url: image.data } }))] };
      return { role: item.role, content: text };
    });
    // Persist the user message and image bytes before awaiting the remote API.
    await save();
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 90000);
      let response; let data;
      try {
        response = await fetch(endpoint(provider, 'chat/completions'), { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ model, messages: payload, stream: false }), signal: controller.signal });
        data = await response.json().catch(() => ({}));
      } finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(data?.error?.message || data?.message || `リクエストに失敗しました（${response.status}）`);
      const answer = messageContentFromResponse(data); if (!answer) throw new Error('応答テキストがありません。モデルがチャット完了APIに対応しているか確認してください。');
      Object.assign(pending, { content: answer, pending: false });
    } catch (error) {
      const message = error.name === 'AbortError' ? '応答がタイムアウトしました。通信状況を確認して、もう一度お試しください。' : error instanceof TypeError ? '接続できませんでした。CORS設定、API URL、通信状態を確認してください。' : error.message || '接続に失敗しました。';
      Object.assign(pending, { content: message, pending: false, error: true });
    } finally { state.busyChatIds.delete(chatId); chat.updatedAt = Date.now(); await save(); if (activeChat()?.id === chatId) renderAll(); updateSend(); }
  }
  function bindEvents() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'toggle-sidebar') toggleSidebar(); if (action === 'close-sidebar') closeSidebar(); if (action === 'new-chat') createChat(); if (action === 'add-api') openApi(); if (action === 'close-api') closeApi(); if (action === 'open-models') { closeSidebar(); openPopover(); } if (action === 'refresh-models') refreshModels();
      if (event.target.closest('#model-trigger')) { if (el.popover.hidden) openPopover(); else closePopover(); return; }
      if (!event.target.closest('#model-popover') && !event.target.closest('#api-modal')) closePopover();
      const suggestion = event.target.closest('[data-prompt]'); if (suggestion) { el.input.value = suggestion.dataset.prompt; el.input.dispatchEvent(new Event('input')); el.input.focus(); }
    });
    el.search.addEventListener('input', renderModels);
    el.apiForm.addEventListener('submit', submitApi);
    el.attachButton.addEventListener('click', () => el.imageInput.click());
    el.imageInput.addEventListener('change', event => addImages(event.target.files));
    el.form.addEventListener('submit', sendMessage);
    el.input.addEventListener('input', () => { el.input.style.height = 'auto'; el.input.style.height = `${Math.min(el.input.scrollHeight, 144)}px`; updateSend(); });
    el.input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); el.form.requestSubmit(); } });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeApi(); closePopover(); closeSidebar(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); createChat(); } });
    window.addEventListener('beforeunload', () => { state.keys.clear(); });
  }
  bindEvents(); syncMenuAccessibility(); window.addEventListener('resize', syncMenuAccessibility); readSaved().catch(() => toast('保存データを読み込めませんでした'));
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
