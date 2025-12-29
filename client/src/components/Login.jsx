import React, { useState } from "react";

export default function Login({ onSubmit }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    if (loading) return;
    setLoading(true);
    try {
      await onSubmit(mode, username, password);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen">
      <div className="panel">
        <h1>GeoSense</h1>
        <p>Logga in eller skapa konto med valfritt användarnamn och lösenord.</p>

        <div className="tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
            disabled={loading}
          >
            Logga in
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
            disabled={loading}
          >
            Registrera
          </button>
        </div>

        <form onSubmit={submit}>
          <input
            placeholder="Användarnamn"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            disabled={loading}
          />
          <input
            type="password"
            placeholder="Lösenord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading
              ? mode === "login"
                ? "Loggar in…"
                : "Skapar konto…"
              : mode === "login"
              ? "Logga in"
              : "Skapa konto"}
          </button>

          {loading && (
            <div className="login-loading-hint">
              Loggar in, stäng inte fönstret.
            </div>
          )}
        </form>
      </div>

      <div className="login-copyright">© Kristoffer Åberg 2026</div>
    </div>
  );
}
