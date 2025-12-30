// client/src/api.js
// Bas-URL för servern
export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

async function parseJson(res) {
  // Vissa endpoints kan i framtiden svara 204 No Content
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request misslyckades");
  return data;
}

function authHeaders(sessionId, extra = {}) {
  return {
    ...extra,
    "x-session-id": sessionId,
  };
}

// ---------- Auth ----------
export async function register(username, password) {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJson(res);
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJson(res);
}

export async function logout(sessionId) {
  const res = await fetch(`${API_BASE}/api/logout`, {
    method: "POST",
    headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
  });
  return parseJson(res);
}

// ---------- Leaderboard ----------
export async function getLeaderboard(sessionId) {
  const res = await fetch(`${API_BASE}/api/leaderboard`, {
    headers: authHeaders(sessionId),
  });
  return parseJson(res);
}

// ---------- Me / visibility ----------
export async function getMe(sessionId) {
  const res = await fetch(`${API_BASE}/api/me`, {
    headers: authHeaders(sessionId),
  });
  const me = await parseJson(res);

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
    const res = await fetch(`${API_BASE}/api/me/leaderboard-visibility`, {
      method: "PATCH",
      headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ showOnLeaderboard }),
    });
    return parseJson(res);
  } catch (_e) {
    // 2) Fallback: POST /api/me/visibility (backward compat)
    const hidden = !showOnLeaderboard;
    const res = await fetch(`${API_BASE}/api/me/visibility`, {
      method: "POST",
      headers: authHeaders(sessionId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ hidden }),
    });
    return parseJson(res);
  }
}

// ---------- Badges / progression ----------

// Katalog: alla badges (definitioner)
export async function getBadgesCatalog(sessionId) {
  const res = await fetch(`${API_BASE}/api/badges`, {
    headers: authHeaders(sessionId),
  });
  return parseJson(res);
}

// Progress för valfri spelare (leaderboard-klick)
// ✅ matchar server: GET /api/users/:username/progression
export async function getUserProgress(sessionId, username) {
  const res = await fetch(
    `${API_BASE}/api/users/${encodeURIComponent(username)}/progression`,
    { headers: authHeaders(sessionId) }
  );
  return parseJson(res);
}

// Min progress (t.ex. “Progress”-knapp i Lobby)
// ✅ matchar server: GET /api/me/progression
export async function getMyProgress(sessionId) {
  const res = await fetch(`${API_BASE}/api/me/progression`, {
    headers: authHeaders(sessionId),
  });
  return parseJson(res);
}
