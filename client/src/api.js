// client/src/api.js

// Bas-URL för servern
// Exempel prod: VITE_API_BASE_URL="https://geo-click-game.onrender.com"
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

function looksLikeHtml(s) {
  const t = String(s || "").trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head");
}

async function parseJson(res) {
  // Vissa endpoints kan i framtiden svara 204 No Content
  if (res.status === 204) return {};

  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // Läs som text först => kan hantera både JSON och HTML-felsidor
  const raw = await res.text().catch(() => "");
  let data = {};

  // Försök JSON om det verkar rimligt
  if (ct.includes("application/json") || (!looksLikeHtml(raw) && raw.trim().startsWith("{"))) {
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
  } else {
    // HTML eller annat => behåll som tomt objekt, men vi kan ge bättre fel
    data = {};
  }

  if (!res.ok) {
    // Snyggare fel om man råkar prata med fel host (HTML)
    if (looksLikeHtml(raw)) {
      throw new Error(
        "API-svarade med HTML (fel host/proxy). Kontrollera VITE_API_BASE_URL eller att /api proxas till backend."
      );
    }
    throw new Error(data.error || `Request misslyckades (${res.status})`);
  }

  return data;
}

function authHeaders(sessionId, extra = {}) {
  return {
    ...extra,
    "x-session-id": sessionId,
  };
}

async function apiFetch(path, opts = {}) {
  // path ska börja med /api/...
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, opts);
  return parseJson(res);
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

// ✅ NEW: Wide leaderboard
// server: GET /api/leaderboard-wide?mode=total|easy|medium|hard&sort=ppm|pct|sp|vm|fm&dir=asc|desc&limit=...
export async function getLeaderboardWide({
  sessionId, // (valfri) – endpointen kräver inte auth, men skadar inte om du vill skicka
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

  return apiFetch(`/api/leaderboard-wide?${params.toString()}`, {
    headers,
  });
}

// ---------- Me / visibility ----------
export async function getMe(sessionId) {
  const me = await apiFetch("/api/me", {
    headers: authHeaders(sessionId),
  });

  // Normalisera så UI alltid kan använda showOnLeaderboard
  const hidden = !!me.hidden;
  return {
    ...me,
    hidden,
    showOnLeaderboard: typeof me.showOnLeaderboard === "boolean" ? me.showOnLeaderboard : !hidden,
  };
}

/**
 * Spara synlighet i topplistan
 * UI använder showOnLeaderboard (true/false)
 * Servern stödjer PATCH /api/me/leaderboard-visibility { showOnLeaderboard }
 * + fallback till gamla POST /api/me/visibility { hidden }
 */
export async function setLeaderboardVisibility(sessionId, showOnLeaderboard) {
  // 1) Primärt: PATCH /api/me/leaderboard-visibility
  try {
    return await apiFetch("/api/me/leaderboard-visibility", {
      method: "PATCH",
      headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ showOnLeaderboard }),
    });
  } catch (_e) {
    // 2) Fallback: POST /api/me/visibility (backward compat)
    const hidden = !showOnLeaderboard;
    return apiFetch("/api/me/visibility", {
      method: "POST",
      headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ hidden }),
    });
  }
}

// ---------- Badges / progression ----------

// Katalog: alla badges (definitioner)
export async function getBadgesCatalog(sessionId) {
  return apiFetch("/api/badges", {
    headers: authHeaders(sessionId),
  });
}

// Progress för valfri spelare (leaderboard-klick)
// ✅ matchar server: GET /api/users/:username/progression
export async function getUserProgress(sessionId, username) {
  return apiFetch(`/api/users/${encodeURIComponent(username)}/progression`, {
    headers: authHeaders(sessionId),
  });
}

// Min progress (t.ex. “Progress”-knapp i Lobby)
// ✅ matchar server: GET /api/me/progression
export async function getMyProgress(sessionId) {
  return apiFetch("/api/me/progression", {
    headers: authHeaders(sessionId),
  });
}
