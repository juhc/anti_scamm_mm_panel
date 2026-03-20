const storesTbody = document.getElementById("storesTbody");
const authGate = document.getElementById("authGate");
const appContent = document.getElementById("appContent");
const sitePasswordInput = document.getElementById("sitePasswordInput");
const siteLoginBtn = document.getElementById("siteLoginBtn");
const siteLoginError = document.getElementById("siteLoginError");
const dealsTbody = document.getElementById("dealsTbody");
const loadingEl = document.getElementById("loading");
const dealsLoadingEl = document.getElementById("dealsLoading");
const searchInput = document.getElementById("searchInput");
const banFilter = document.getElementById("banFilter");
const refreshBtn = document.getElementById("refreshBtn");
const dealsTitle = document.getElementById("dealsTitle");
const dealsCanvas = new bootstrap.Offcanvas("#dealsCanvas");
const dealsContext = document.getElementById("dealsContext");
const dealStatusFilter = document.getElementById("dealStatusFilter");
const dealSortMode = document.getElementById("dealSortMode");
const dealDetailsTitle = document.getElementById("dealDetailsTitle");
const dealDetailsContext = document.getElementById("dealDetailsContext");
const dealMessagesLoading = document.getElementById("dealMessagesLoading");
const dealMessagesEmpty = document.getElementById("dealMessagesEmpty");
const dealMessagesList = document.getElementById("dealMessagesList");
const dealDetailsModal = new bootstrap.Modal("#dealDetailsModal");
const banUserModal = new bootstrap.Modal("#banUserModal");
const storeFeedbacksModal = new bootstrap.Modal("#storeFeedbacksModal");
const storeFeedbacksTitle = document.getElementById("storeFeedbacksTitle");
const storeFeedbacksContext = document.getElementById("storeFeedbacksContext");
const storeFeedbacksLoading = document.getElementById("storeFeedbacksLoading");
const storeFeedbacksTbody = document.getElementById("storeFeedbacksTbody");
const banUserIdInput = document.getElementById("banUserId");
const globalAuthTokenInput = document.getElementById("globalAuthToken");
const banReasonInput = document.getElementById("banReason");
const banSubmitBtn = document.getElementById("banSubmitBtn");
const banUserResult = document.getElementById("banUserResult");
const scopeSalesCvInput = document.getElementById("scopeSalesCv");
const scopeSalesManualInput = document.getElementById("scopeSalesManual");
const scopePurchasesCvInput = document.getElementById("scopePurchasesCv");
const scopePurchasesManualInput = document.getElementById("scopePurchasesManual");
const scopeWithdrawalsInput = document.getElementById("scopeWithdrawals");
let searchDebounceTimer = null;

let stores = [];
let currentDeals = [];
let banOverrides = {};
let selectedStoreId = null;
let selectedDealId = null;
let isAuthorized = false;
const DEAL_STATUS_FILTER_OPTIONS = [
  { value: "0", label: "0 - Сделка создана покупателем" },
  { value: "10", label: "10 - Продавец подтвердил сделку" },
  { value: "20", label: "20 - Продавец подтвердил передачу" },
  { value: "40", label: "40 - Сделка в состоянии спора" },
  { value: "50", label: "50 - Сделка успешно закрыта" },
  { value: "60", label: "60 - Сделка отменена" },
];

function yesNo(value) {
  return value ? "Да" : "Нет";
}

function short(value, size = 8) {
  const text = String(value ?? "");
  if (text.length <= size * 2) return text;
  return `${text.slice(0, size)}...${text.slice(-size)}`;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dealStatusBadge(deal) {
  const label = deal.status_label || `Статус ${deal.status}`;
  const status = Number(deal.status);
  let statusClass = "badge-status-default";
  if (status === 0) statusClass = "badge-status-created";
  if (status === 10 || status === 20) statusClass = "badge-status-progress";
  if (status === 40) statusClass = "badge-status-dispute";
  if (status === 50) statusClass = "badge-status-success";
  if (status === 60) statusClass = "badge-status-cancel";
  return `<span class="badge-status ${statusClass}">${esc(label)}</span>`;
}

function normalizeCounter(value) {
  if (typeof value !== "number") return { text: value ?? 0, isUnsynced: false };
  if (value < 0) return { text: "—", isUnsynced: true };
  return { text: value, isUnsynced: false };
}

function dealsCounterMarkup(value) {
  const normalized = normalizeCounter(value);
  if (!normalized.isUnsynced) return esc(normalized.text);
  return `${esc(normalized.text)} <span class="badge text-bg-warning ms-1">не синхронизировано</span>`;
}

function activeDealsMarkup(value) {
  const normalized = normalizeCounter(value);
  if (normalized.isUnsynced) {
    return `${esc(normalized.text)} <span class="badge text-bg-warning ms-1">не синхронизировано</span>`;
  }
  const numeric = Number(normalized.text);
  if (!Number.isNaN(numeric) && numeric > 10) {
    return `
      <div class="active-deals-cell">
        <span class="active-deals-pill active-deals-pill-hot">${esc(normalized.text)}</span>
        <span class="active-deals-note">высокая нагрузка</span>
      </div>
    `;
  }
  return `<span class="active-deals-pill">${esc(normalized.text)}</span>`;
}

function copyMarkup(value, display = null) {
  if (value === null || value === undefined || value === "") return "-";
  const raw = String(value);
  const shown = String(display ?? value);
  return `<code class="copyable-token" data-copy="${esc(shown)}" data-copy-full="${esc(raw)}" title="Нажмите, чтобы скопировать полный ID">${esc(shown)}</code>`;
}

function showCopyToast(text) {
  let toast = document.getElementById("copyToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "copyToast";
    toast.className = "copy-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(showCopyToast._timer);
  showCopyToast._timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1300);
}

async function copyToClipboard(value) {
  const text = String(value ?? "");
  if (!text) return { ok: false, method: "none" };

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: "clipboard-api" };
    }
  } catch {
    // Fallback below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return { ok: Boolean(ok), method: "execCommand" };
  } catch {
    return { ok: false, method: "none" };
  }
}

function setAuthError(message) {
  if (!message) {
    siteLoginError.textContent = "";
    siteLoginError.classList.add("d-none");
    return;
  }
  siteLoginError.textContent = message;
  siteLoginError.classList.remove("d-none");
}

function setAuthorizedState(authorized) {
  isAuthorized = Boolean(authorized);
  if (isAuthorized) {
    authGate.classList.add("d-none");
    appContent.classList.remove("d-none");
  } else {
    appContent.classList.add("d-none");
    authGate.classList.remove("d-none");
  }
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    setAuthorizedState(false);
    throw new Error("Требуется ввод пароля");
  }
  return response;
}

async function readJsonSafe(response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  const text = await response.text();
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 180);
  throw new Error(`Сервер вернул не JSON (HTTP ${response.status}): ${snippet || "пустой ответ"}`);
}

function setContext(el, text) {
  if (!el) return;
  if (!text) {
    el.classList.add("d-none");
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.remove("d-none");
}

function setSelectedStore(storeId) {
  selectedStoreId = storeId || null;
  for (const tr of storesTbody.querySelectorAll("tr[data-store-id]")) {
    tr.classList.toggle("is-selected-row", selectedStoreId && tr.dataset.storeId === selectedStoreId);
  }
}

function setSelectedDeal(dealId) {
  selectedDealId = dealId || null;
  for (const row of dealsTbody.querySelectorAll("[data-deal-id]")) {
    row.classList.toggle("is-selected-row", selectedDealId && row.dataset.dealId === selectedDealId);
  }
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function defaultScopeDateLocal() {
  return "2100-01-01T00:00";
}

function formatDealStatusOption(deal) {
  return deal.status_label || `Статус ${deal.status}`;
}

function refillDealStatusOptions(deals) {
  const currentValue = dealStatusFilter.value || "all";
  const byStatus = new Map(DEAL_STATUS_FILTER_OPTIONS.map((x) => [x.value, x.label]));
  for (const deal of deals) {
    const key = String(deal.status ?? "");
    if (!byStatus.has(key)) {
      byStatus.set(key, `${key} - ${formatDealStatusOption(deal)}`);
    }
  }
  const sorted = [...byStatus.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));

  dealStatusFilter.innerHTML = '<option value="all">Все статусы</option>';
  for (const [status, label] of sorted) {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = label;
    dealStatusFilter.appendChild(option);
  }

  if ([...dealStatusFilter.options].some((o) => o.value === currentValue)) {
    dealStatusFilter.value = currentValue;
  } else {
    dealStatusFilter.value = "all";
  }
}

function renderDealsTable() {
  const statusValue = dealStatusFilter.value;
  const sortMode = dealSortMode.value;

  let rows = [...currentDeals];
  if (statusValue !== "all") {
    rows = rows.filter((deal) => String(deal.status ?? "") === statusValue);
  }

  rows.sort((a, b) => {
    if (sortMode === "created_asc" || sortMode === "created_desc") {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return sortMode === "created_asc" ? ta - tb : tb - ta;
    }
    const sa = Number(a.status ?? 0);
    const sb = Number(b.status ?? 0);
    return sortMode === "status_asc" ? sa - sb : sb - sa;
  });

  dealsTbody.innerHTML = "";
  if (rows.length === 0) {
    dealsTbody.innerHTML = `<div class="text-secondary p-2">Сделок не найдено</div>`;
    return;
  }

  for (const deal of rows) {
    const hasFeedback = deal.feedback_rating !== null && deal.feedback_rating !== undefined;
    const feedbackCell = hasFeedback
      ? `<span class="badge text-bg-success">★ ${esc(deal.feedback_rating)}</span>${
          deal.feedback_comment ? ` <span class="text-secondary">${esc(short(deal.feedback_comment, 18))}</span>` : ""
        }`
      : '<span class="text-secondary">—</span>';
    const card = document.createElement("div");
    card.className = "deal-card";
    card.dataset.dealId = String(deal.id);
    card.innerHTML = `
      <div class="deal-card-header">
        <div>
          <div class="deal-title">Сделка ${copyMarkup(deal.id, short(deal.id))}</div>
          <div class="deal-meta">${deal.created_at ? new Date(deal.created_at).toLocaleString() : "-"}</div>
        </div>
        <div class="d-flex gap-2 align-items-center">
          ${dealStatusBadge(deal)}
          <button class="btn btn-sm btn-outline-info js-view-deal-details" data-deal-id="${deal.id}">Открыть</button>
        </div>
      </div>
      <div class="deal-grid">
        <div><span class="deal-label">Buyer:</span> ${copyMarkup(deal.buyer_id, short(deal.buyer_id))}</div>
        <div><span class="deal-label">Seller:</span> ${copyMarkup(deal.seller_id, short(deal.seller_id))}</div>
        <div><span class="deal-label">Предмет:</span> ${deal.item_names ? esc(deal.item_names) : '<span class="text-secondary">—</span>'}</div>
        <div><span class="deal-label">Игра:</span> ${deal.game_names ? esc(deal.game_names) : '<span class="text-secondary">—</span>'}</div>
        <div><span class="deal-label">Оплата:</span> ${deal.buyer_paid ? esc(deal.buyer_paid) : '<span class="text-secondary">—</span>'}</div>
        <div><span class="deal-label">Feedback:</span> ${feedbackCell}</div>
      </div>
    `;
    dealsTbody.appendChild(card);
  }

  if (selectedDealId) {
    setSelectedDeal(selectedDealId);
  }
}

function userLabel(store) {
  const user = store.owner_user;
  if (!user) return '<span class="text-secondary">не найден</span>';
  return user.public_username || user.username || user.email || user.id;
}

function getBanInfo(store) {
  if (store.is_banned_mongo) {
    return {
      isBanned: true,
      scope: store.mongo_ban_scope ?? store.owner_user?.ban_scope ?? "ban_scope",
      source: "mongo",
    };
  }
  return { isBanned: false, scope: null, source: "mongo" };
}

function matchesFilters(store) {
  const q = searchInput.value.trim().toLowerCase();
  const mode = banFilter.value;

  if (mode === "banned" && !store.is_banned_mongo) return false;
  if (mode === "not-banned" && store.is_banned_mongo) return false;

  if (!q) return true;
  const haystack = [
    store.id,
    store.alias,
    store.owner_id,
    store.owner_user?.public_username,
    store.owner_user?.username,
    store.owner_user?.email,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function renderStores() {
  const visible = stores.filter(matchesFilters);
  storesTbody.innerHTML = "";

  for (const store of visible) {
    const banInfo = getBanInfo(store);
    const tr = document.createElement("tr");
    tr.dataset.storeId = String(store.id);
    tr.innerHTML = `
      <td>${copyMarkup(store.id, short(store.id))}</td>
      <td>${copyMarkup(store.owner_id, short(store.owner_id))}</td>
      <td>${userLabel(store)}</td>
      <td>
        ${
          banInfo.isBanned
            ? `<span class="badge badge-ban">mongo ban_scope: ${esc(banInfo.scope)}</span>`
            : '<span class="badge badge-ok">нет</span>'
        }
      </td>
      <td>${dealsCounterMarkup(store.total_deals)}</td>
      <td>${activeDealsMarkup(store.active_deals)}</td>
      <td>${store.rating ?? "-"}</td>
      <td>
        <div class="store-actions">
          <button class="btn btn-sm btn-primary js-view-deals" data-store-id="${store.id}">Сделки</button>
          <button class="btn btn-sm btn-outline-info js-view-feedbacks" data-store-id="${store.id}">Отзывы</button>
          <button class="btn btn-sm btn-danger js-ban-user" data-user-id="${store.owner_id}">Блок</button>
        </div>
      </td>
    `;
    storesTbody.appendChild(tr);
  }

  if (selectedStoreId) {
    setSelectedStore(selectedStoreId);
  }

  if (visible.length === 0) {
    storesTbody.innerHTML = `<tr><td colspan="8" class="text-secondary">Нет данных по фильтру</td></tr>`;
  }
}

async function loadStores() {
  if (!isAuthorized) return;
  const searchValue = searchInput.value.trim();
  const endpoint = searchValue
    ? `/api/stores?q=${encodeURIComponent(searchValue)}`
    : "/api/stores";
  loadingEl.textContent = "Загрузка данных...";
  storesTbody.innerHTML = "";
  try {
    const response = await apiFetch(endpoint);
    if (!response.ok) throw new Error("Ошибка запроса stores");
    stores = await readJsonSafe(response);
    loadingEl.textContent = searchValue
      ? `Найдено магазинов по поиску: ${stores.length}`
      : `Найдено активных магазинов: ${stores.length}`;
    renderStores();
  } catch (error) {
    loadingEl.textContent = "Ошибка при загрузке продавцов";
    storesTbody.innerHTML = `<tr><td colspan="8" class="text-danger">${error.message}</td></tr>`;
  }
}

async function loadDeals(storeId) {
  if (!isAuthorized) return;
  setSelectedStore(String(storeId));
  dealsTitle.textContent = `Сделки магазина ${short(storeId)}`;
  setContext(dealsContext, `Магазин: ${storeId}`);
  dealsLoadingEl.classList.remove("d-none");
  dealsTbody.innerHTML = "";
  currentDeals = [];
  dealsCanvas.show();

  try {
    const response = await apiFetch(`/api/stores/${storeId}/deals`);
    if (!response.ok) throw new Error("Ошибка запроса deals");
    currentDeals = await readJsonSafe(response);
    dealsLoadingEl.classList.add("d-none");
    refillDealStatusOptions(currentDeals);
    renderDealsTable();
  } catch (error) {
    dealsLoadingEl.classList.add("d-none");
    dealsTbody.innerHTML = `<div class="text-danger p-2">${error.message}</div>`;
  }
}

async function loadDealMessages(dealId) {
  if (!isAuthorized) return;
  setSelectedDeal(String(dealId));
  dealDetailsTitle.textContent = `Сообщения сделки ${short(dealId)}`;
  setContext(dealDetailsContext, `Сделка: ${dealId}`);
  dealMessagesLoading.classList.remove("d-none");
  dealMessagesEmpty.classList.add("d-none");
  dealMessagesList.innerHTML = "";
  dealDetailsModal.show();

  try {
    const response = await apiFetch(`/api/deals/${dealId}/messages`);
    if (!response.ok) throw new Error("Ошибка запроса сообщений сделки");
    const messages = await readJsonSafe(response);
    dealMessagesLoading.classList.add("d-none");

    if (!messages.length) {
      dealMessagesEmpty.classList.remove("d-none");
      return;
    }

    for (const msg of messages) {
      const created = msg.sent_at ? new Date(msg.sent_at).toLocaleString() : "-";
      const sender = msg.sender_id ? short(msg.sender_id, 10) : "-";
      const senderType = msg.sender_type_label || `Тип ${msg.sender_type ?? "-"}`;
      const senderDisplay = `${senderType}${msg.sender_id ? ` (${sender})` : ""}`;
      const lang = msg.original_language || "-";
      const isSystemMessage = Boolean(msg.is_system_message);
      const text = msg.original_text || (isSystemMessage ? (msg.system_code_label || "[Системное сообщение]") : "[Нет текста в translations с is_original=true]");
      const systemLabel = msg.system_code_label
        ? `<span class="ms-3"><strong>Системный статус:</strong> ${esc(msg.system_code_label)}</span>`
        : "";
      const systemBadge = isSystemMessage
        ? '<span class="ms-3 badge text-bg-warning">Системное сообщение</span>'
        : "";

      const box = document.createElement("div");
      box.className = "message-item";
      box.innerHTML = `
        <div class="message-meta">
          <span><strong>Дата:</strong> ${esc(created)}</span>
          <span class="ms-3"><strong>Отправитель:</strong> ${esc(senderDisplay)}</span>
          <span class="ms-3"><strong>Язык:</strong> ${esc(lang)}</span>
          <span class="ms-3"><strong>Code:</strong> ${esc(msg.code)}</span>
          ${systemLabel}
          ${systemBadge}
        </div>
        <p class="message-text">${esc(text)}</p>
      `;
      dealMessagesList.appendChild(box);
    }
  } catch (error) {
    dealMessagesLoading.classList.add("d-none");
    dealMessagesList.innerHTML = `<div class="text-danger">${esc(error.message)}</div>`;
  }
}

async function loadStoreFeedbacks(storeId) {
  if (!isAuthorized) return;
  setSelectedStore(String(storeId));
  storeFeedbacksTitle.textContent = `Отзывы магазина ${short(storeId)}`;
  setContext(storeFeedbacksContext, `Магазин: ${storeId}`);
  storeFeedbacksLoading.classList.remove("d-none");
  storeFeedbacksTbody.innerHTML = "";
  storeFeedbacksModal.show();

  try {
    const response = await apiFetch(`/api/stores/${storeId}/feedbacks`);
    if (!response.ok) throw new Error("Ошибка запроса feedbacks");
    const feedbacks = await readJsonSafe(response);
    storeFeedbacksLoading.classList.add("d-none");

    if (!feedbacks.length) {
      storeFeedbacksTbody.innerHTML = `<tr><td colspan="9" class="text-secondary">Отзывы не найдены</td></tr>`;
      return;
    }

    for (const item of feedbacks) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${copyMarkup(item.deal_id, short(item.deal_id))}</td>
        <td>${item.deal_status_label ? esc(item.deal_status_label) : '<span class="text-secondary">—</span>'}</td>
        <td>${item.item_names ? esc(item.item_names) : '<span class="text-secondary">—</span>'}</td>
        <td>${item.game_names ? esc(item.game_names) : '<span class="text-secondary">—</span>'}</td>
        <td>${item.buyer_paid ? esc(item.buyer_paid) : '<span class="text-secondary">—</span>'}</td>
        <td>${copyMarkup(item.author_id, short(item.author_id, 10))}</td>
        <td>${item.rating !== null && item.rating !== undefined ? `<span class="badge text-bg-success">★ ${esc(item.rating)}</span>` : "-"}</td>
        <td>${item.comment ? esc(item.comment) : '<span class="text-secondary">—</span>'}</td>
        <td>${item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</td>
      `;
      storeFeedbacksTbody.appendChild(tr);
    }
  } catch (error) {
    storeFeedbacksLoading.classList.add("d-none");
    storeFeedbacksTbody.innerHTML = `<tr><td colspan="9" class="text-danger">${esc(error.message)}</td></tr>`;
  }
}

dealsTbody.addEventListener("click", (event) => {
  const detailsBtn = event.target.closest(".js-view-deal-details");
  if (!detailsBtn) return;
  loadDealMessages(detailsBtn.dataset.dealId);
});

storesTbody.addEventListener("click", (event) => {
  const feedbackBtn = event.target.closest(".js-view-feedbacks");
  if (feedbackBtn) {
    loadStoreFeedbacks(feedbackBtn.dataset.storeId);
    return;
  }

  const banBtn = event.target.closest(".js-ban-user");
  if (banBtn) {
    banUserIdInput.value = banBtn.dataset.userId || "";
    scopeSalesCvInput.value = defaultScopeDateLocal();
    scopeSalesManualInput.value = defaultScopeDateLocal();
    scopePurchasesCvInput.value = defaultScopeDateLocal();
    scopePurchasesManualInput.value = defaultScopeDateLocal();
    scopeWithdrawalsInput.value = defaultScopeDateLocal();
    banUserResult.textContent = "";
    banUserModal.show();
    return;
  }

  const button = event.target.closest(".js-view-deals");
  if (!button) return;
  loadDeals(button.dataset.storeId);
});

banSubmitBtn.addEventListener("click", async () => {
  if (!isAuthorized) return;
  const userId = banUserIdInput.value.trim();
  const token = globalAuthTokenInput.value.trim();
  const reason = banReasonInput.value.trim();
  const scopes = {
    sales_cv: toIsoOrNull(scopeSalesCvInput.value),
    sales_manual: toIsoOrNull(scopeSalesManualInput.value),
    purchases_cv: toIsoOrNull(scopePurchasesCvInput.value),
    purchases_manual: toIsoOrNull(scopePurchasesManualInput.value),
    withdrawals: toIsoOrNull(scopeWithdrawalsInput.value),
  };

  for (const key of Object.keys(scopes)) {
    if (!scopes[key]) delete scopes[key];
  }

  if (!token) {
    banUserResult.className = "mt-3 small text-danger";
    banUserResult.textContent = "Нужно заполнить Authentication Token на главной странице";
    return;
  }

  if (!Object.keys(scopes).length) {
    banUserResult.className = "mt-3 small text-danger";
    banUserResult.textContent = "Нужно заполнить хотя бы один scope";
    return;
  }

  banSubmitBtn.disabled = true;
  banUserResult.className = "mt-3 small text-secondary";
  banUserResult.textContent = "Отправка запроса на блокировку...";

  try {
    const response = await apiFetch("/api/users/ban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, userId, reason, scopes }),
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error?.message || data.error?.error || JSON.stringify(data.error || data));
    }
    const firstScope = Object.keys(scopes)[0] || "manual";
    stores = stores.map((store) =>
      String(store.owner_id || "") === userId
        ? {
            ...store,
            is_banned_mongo: true,
            mongo_ban_scope: firstScope,
            is_banned: true,
            owner_user: {
              ...(store.owner_user || {}),
              ban_scope: firstScope,
            },
          }
        : store
    );
    renderStores();
    setTimeout(() => {
      loadStores();
    }, 600);
    banUserResult.className = "mt-3 small text-success";
    banUserResult.textContent = "Пользователь успешно заблокирован";
  } catch (error) {
    banUserResult.className = "mt-3 small text-danger";
    banUserResult.textContent = `Ошибка блокировки: ${error.message}`;
  } finally {
    banSubmitBtn.disabled = false;
  }
});

const savedToken = localStorage.getItem("supportAuthToken") || "";
if (savedToken) {
  globalAuthTokenInput.value = savedToken;
}
try {
  banOverrides = JSON.parse(localStorage.getItem("banOverrides") || "{}");
} catch {
  banOverrides = {};
}

globalAuthTokenInput.addEventListener("input", () => {
  localStorage.setItem("supportAuthToken", globalAuthTokenInput.value.trim());
});

sitePasswordInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    siteLoginBtn.click();
  }
});

siteLoginBtn?.addEventListener("click", async () => {
  const password = (sitePasswordInput.value || "").trim();
  if (!password) {
    setAuthError("Введите пароль");
    return;
  }
  setAuthError("");
  siteLoginBtn.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await readJsonSafe(response);
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Ошибка авторизации");
    }
    setAuthorizedState(true);
    sitePasswordInput.value = "";
    await loadStores();
  } catch (error) {
    setAuthorizedState(false);
    setAuthError(error.message || "Ошибка авторизации");
  } finally {
    siteLoginBtn.disabled = false;
  }
});

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    loadStores();
  }, 250);
});
banFilter.addEventListener("change", renderStores);
refreshBtn.addEventListener("click", () => {
  loadStores();
});
dealStatusFilter.addEventListener("change", renderDealsTable);
dealSortMode.addEventListener("change", renderDealsTable);

document.addEventListener("click", async (event) => {
  const token = event.target.closest("[data-copy]");
  if (!token) return;
  const value = token.dataset.copyFull || token.dataset.copy;
  if (!value) return;
  const result = await copyToClipboard(value);
  if (result.ok && result.method === "clipboard-api") {
    showCopyToast(`Скопировано: ${value}`);
  } else if (result.ok && result.method === "execCommand") {
    // Some production browser contexts report success for execCommand but do
    // not actually populate clipboard. Provide an explicit manual fallback.
    window.prompt("Скопируйте ID вручную (Ctrl+C, Enter):", value);
    showCopyToast("Автокопирование ограничено браузером. Открыл ручное копирование.");
  } else {
    window.prompt("Скопируйте ID вручную (Ctrl+C, Enter):", value);
    showCopyToast("Открыл ручное копирование.");
  }
});

async function bootstrapAuth() {
  try {
    const response = await fetch("/api/auth/status");
    if (!response.ok) throw new Error("Не удалось проверить авторизацию");
    const data = await readJsonSafe(response);
    setAuthorizedState(Boolean(data.authorized));
    if (data.authorized) {
      await loadStores();
    }
  } catch {
    setAuthorizedState(false);
  }
}

bootstrapAuth();
