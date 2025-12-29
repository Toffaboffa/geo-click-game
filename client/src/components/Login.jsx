import React, { useState } from "react";

export default function Login({ onSubmit }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!username || !password) return;
    onSubmit(mode, username, password);
  };

  return (
    <div className="screen">
      <div className="panel">
        <h1>GeoSense</h1>
        <p>Logga in eller skapa konto med valfritt användarnamn och lösenord.</p>

        <div className="tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Logga in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
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
          />
          <input
            type="password"
            placeholder="Lösenord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="submit">
            {mode === "login" ? "Logga in" : "Skapa konto"}
          </button>
        </form>
      </div>
    </div>
  );
}
