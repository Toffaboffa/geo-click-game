// Bas-URL för servern
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export async function register(username, password) {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Registrering misslyckades");
  return data;
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Inloggning misslyckades");
  return data;
}

export async function logout(sessionId) {
  const res = await fetch(`${API_BASE}/api/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-session-id": sessionId
    }
  });
  if (!res.ok) throw new Error("Utloggning misslyckades");
  return res.json();
}

export async function getLeaderboard(sessionId) {
  const res = await fetch(`${API_BASE}/api/leaderboard`, {
    headers: { "x-session-id": sessionId }
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Kunde inte ladda topplista");
  return data;
}

export { API_BASE };
