// client/src/api.js

// Base URL for the server
// Example prod: VITE_API_BASE_URL="https://geo-click-game.onrender.com"
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

// ---------- Helpers ----------
function looksLikeHtml(s) {
  const t = String(s || "").trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head");
}

function safeJsonParse(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function toError(code, extras = {}) {
  const e = new Error(code);
  Object.assign(e, extras);
  return e;
}

function mapServerErrorToKey(message) {
  const s = String(message || "");

  const map = {
    "Inte inloggad": "errors.notLoggedIn",
    "Serverfel": "errors.serverError",
    "Saknar användarnamn/lösen": "errors.missingCreds",
    "Användarnamn finns redan": "errors.usernameTaken",
    "Fel användarnamn eller lösenord": "errors.invalidCreds",
    "Kolumnen 'hidden' saknas i users": "errors.hiddenMissing",
    "Hittade inte användare": "errors.userNotFound",
    "Saknar username": "errors.missingUsername",
    "Ogiltiga sort-parametrar": "errors.invalidSort",
  };

  return map[s] || null;
}

async function parseJson(res) {
  if (res.status === 204) return {};

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const raw = await res.text().catch(() => "");
  const trimmed = raw.trim();

  let data = {};
  const seemsJson =
    ct.includes("application/json") ||
    (!looksLikeHtml(trimmed) && (trimmed.startsWith("{") || trimmed.startsWith("[")));

  if (seemsJson) {
    data = safeJsonParse(trimmed);
  }

  if (!res.ok) {
    if (looksLikeHtml(trimmed)) {
      throw toError("errors.apiHtml", { status: res.status });
    }

    const serverMsg = data?.error || "";
    const key = mapServerErrorToKey(serverMsg);

    if (key) {
      throw toError(key, { status: res.status, serverMessage: serverMsg });
    }

    if (serverMsg) {
      throw toError(serverMsg, { status: res.status, serverMessage: serverMsg });
    }

    throw toError("errors.requestFailed", { status: res.status });
  }

  return data;
}

function authHeaders(sessionId, extra = {}) {
  return {
    ...extra,
    "x-session-id": sessionId,
  };
}

// ---------- Progress normalization ----------
// Server/DB may return snake_case, camelCase, strings for bigint, etc.
// We keep original fields but add safe numeric/camel aliases so UI can be simple.
function toNumOrUndef(v) {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeProgress(p) {
  if (!p || typeof p !== "object") return p;

  const xpTotal = toNumOrUndef(p.xp_total ?? p.xpTotal);
  const level = toNumOrUndef(p.level);
  const xpLevelBase = toNumOrUndef(p.xpLevelBase);
  const xpNextLevelAt = toNumOrUndef(p.xpNextLevelAt);
  const xpIntoLevel = toNumOrUndef(p.xpIntoLevel);
  const xpToNext = toNumOrUndef(p.xpToNext);
  const xpPctToNext = toNumOrUndef(p.xpPctToNext);

  return {
    ...p,

    // snake_case preserved, but add/update consistent aliases
    xp_total: xpTotal ?? p.xp_total,
    xpTotal: xpTotal ?? p.xpTotal,
    xp_updated_at: p.xp_updated_at ?? p.xpUpdatedAt,
    xpUpdatedAt: p.xpUpdatedAt ?? p.xp_updated_at,

    level: level ?? p.level,
    xpLevelBase: xpLevelBase ?? p.xpLevelBase,
    xpNextLevelAt: xpNextLevelAt ?? p.xpNextLevelAt,
    xpIntoLevel: xpIntoLevel ?? p.xpIntoLevel,
    xpToNext: xpToNext ?? p.xpToNext,
    xpPctToNext: xpPctToNext ?? p.xpPctToNext,
  };
}

async function apiFetch(path, opts = {}) {
  const url = `${API_BASE}${path}`;

  const controller = new AbortController();
  // Default timeout increased to avoid false timeouts on slow networks.
  const timeoutMs = opts.timeoutMs ?? 120000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...opts,
      signal: controller.signal,
    });
    return await parseJson(res);
  } catch (e) {
    if (e?.name === "AbortError") {
      throw toError("errors.timeout");
    }
    if (String(e?.message || "").startsWith("errors.") || e?.serverMessage) {
      throw e;
    }
    throw toError("errors.network");
  } finally {
    clearTimeout(t);
  }
}

// ---------- Auth ----------
export async function register(username, password) {
  return apiFetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function login(username, password) {
  return apiFetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

// ---------- Guest / "Try" ----------
// Creates a temporary session without creating a user row (server-side).
// Used by the Login-page "Prova" button.
export async function guestLogin() {
  return apiFetch("/api/guest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function logout(sessionId) {
  return apiFetch("/api/logout", {
    method: "POST",
    headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
  });
}

// ---------- Leaderboard ----------
export async function getLeaderboard(sessionId) {
  return apiFetch("/api/leaderboard", {
    headers: authHeaders(sessionId),
  });
}

export async function getLeaderboardWide({
  sessionId,
  mode = "total",
  sort = "ppm",
  dir = "",
  limit = 50,
} = {}) {
  const params = new URLSearchParams();
  params.set("mode", String(mode));
  params.set("sort", String(sort));
  if (dir === "asc" || dir === "desc") params.set("dir", dir);
  params.set("limit", String(limit));

  const headers = sessionId ? authHeaders(sessionId) : undefined;

  return apiFetch(`/api/leaderboard-wide?${params.toString()}`, { headers });
}

// ---------- Me / visibility ----------
export async function getMe(sessionId) {
  const me = await apiFetch("/api/me", {
    headers: authHeaders(sessionId),
  });

  const hidden = !!me.hidden;
  return {
    ...me,
    hidden,
    showOnLeaderboard: typeof me.showOnLeaderboard === "boolean" ? me.showOnLeaderboard : !hidden,
  };
}

export async function setLeaderboardVisibility(sessionId, showOnLeaderboard) {
  try {
    return await apiFetch("/api/me/leaderboard-visibility", {
      method: "PATCH",
      headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ showOnLeaderboard }),
    });
  } catch (_e) {
    const hidden = !showOnLeaderboard;
    return apiFetch("/api/me/visibility", {
      method: "POST",
      headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ hidden }),
    });
  }
}

// ---------- Badges / progression ----------
export async function getBadgesCatalog(sessionId) {
  return apiFetch("/api/badges", {
    headers: authHeaders(sessionId),
  });
}

export async function getUserProgress(sessionId, username) {
  const p = await apiFetch(`/api/users/${encodeURIComponent(username)}/progression`, {
    headers: authHeaders(sessionId),
  });
  return normalizeProgress(p);
}

export async function getMyProgress(sessionId) {
  const p = await apiFetch("/api/me/progression", {
    headers: authHeaders(sessionId),
  });
  return normalizeProgress(p);
}
// ---------- Feedback (Bug report / Feature request) ----------
export async function createFeedback(sessionId, { kind, message, pageUrl, userAgent, lang, meta } = {}) {
  return apiFetch("/api/feedback", {
    method: "POST",
    headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
    body: JSON.stringify({ kind, message, pageUrl, userAgent, lang, meta }),
  });
}

export async function getFeedbackList(sessionId, { kind = null, limit = 200 } = {}) {
  const qs = new URLSearchParams();
  if (kind) qs.set("kind", kind);
  if (limit != null) qs.set("limit", String(limit));
  const q = qs.toString();
  return apiFetch(`/api/feedback${q ? `?${q}` : ""}`, {
    headers: authHeaders(sessionId),
  });
}
