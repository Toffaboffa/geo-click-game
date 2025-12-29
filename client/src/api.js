// client/src/api.js
// Bas-URL för servern
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request misslyckades");
  return data;
}

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
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    },
  });
  return parseJson(res);
}

export async function getLeaderboard(sessionId) {
  const res = await fetch(`${API_BASE}/api/leaderboard`, {
    headers: { "x-session-id": sessionId },
  });
  return parseJson(res);
}

// ✅ NYTT: hämta “me” (inkl showOnLeaderboard)
export async function getMe(sessionId) {
  const res = await fetch(`${API_BASE}/api/me`, {
    headers: { "x-session-id": sessionId },
  });
  return parseJson(res);
}

// ✅ NYTT: spara synlighet i topplistan
export async function setLeaderboardVisibility(sessionId, showOnLeaderboard) {
  const res = await fetch(`${API_BASE}/api/me/leaderboard-visibility`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId,
    },
    body: JSON.stringify({ showOnLeaderboard }),
  });
  return parseJson(res);
}

export { API_BASE };
