import React, { useMemo, useState } from "react";
import StartPings from "./StartPings";
import logo from "../assets/logo.png";
import LanguageToggle from "../i18n/LanguageToggle.jsx";
import { useI18n } from "../i18n/LanguageProvider.jsx";

export default function Login({ onSubmit, authLoading = false, authHint = "" }) {
  const { t } = useI18n();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [localLoading, setLocalLoading] = useState(false);

  const loading = authLoading || localLoading;
  const year = useMemo(() => new Date().getFullYear(), []);

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setLocalLoading(true);
    try {
      await onSubmit({ username, password, mode });
    } finally {
      setLocalLoading(false);
    }
  };

  const isLogin = mode === "login";

  return (
    <div className="screen start-screen">
      <div className="screen-topbar">
        <LanguageToggle />
      </div>

      <StartPings />
          <img className="screen-logo" src={logo} alt={t("common.appName")} />

      <div className="panel">
        <h1 className="title">{t("login.headline")}</h1>
        <p className="subtitle">{t("login.blurb")}</p>

        <div className="mode-toggle">
          <button
            type="button"
            className={`mode-btn ${isLogin ? "is-active" : ""}`}
            onClick={() => setMode("login")}
            disabled={loading}
          >
            {t("login.loginBtn")}
          </button>
          <button
            type="button"
            className={`mode-btn ${!isLogin ? "is-active" : ""}`}
            onClick={() => setMode("register")}
            disabled={loading}
          >
            {t("login.registerBtn")}
          </button>
        </div>

        <form onSubmit={submit} className="form">
          <div className="form-row">
            <label className="form-label" htmlFor="login-username">
              {t("login.username")}
            </label>
            <input
              id="login-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("login.username")}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="login-password">
              {t("login.password")}
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login.password")}
              autoComplete={isLogin ? "current-password" : "new-password"}
              disabled={loading}
            />
          </div>

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading
              ? isLogin
                ? t("login.loggingIn")
                : t("login.registering")
              : isLogin
              ? t("login.loginBtn")
              : t("login.registerBtn")}
          </button>

          <div className="hint">{authHint ? authHint : t("login.hint")}</div>
        </form>

        <div className="footer">© {year} {t("common.appName")} (by Kristoffer Åberg)</div>
      </div>
    </div>
  );
}
