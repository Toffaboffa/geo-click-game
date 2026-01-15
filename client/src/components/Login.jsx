import React, { useMemo, useState } from "react";
import StartPings from "./StartPings";
import logo from "../assets/logo.png";
import LanguageToggle from "../i18n/LanguageToggle.jsx";
import { useI18n } from "../i18n/LanguageProvider.jsx";

export default function Login({ onSubmit, onTry, authLoading = false, authHint = "" }) {
  const { t } = useI18n();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [localLoading, setLocalLoading] = useState(false);
  const [showPromo, setShowPromo] = useState(true);

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

  const looksLikeEmail = (s) => /\S+@\S+\.\S+/.test(String(s || "").trim());
  const emailDetected = !isLogin && looksLikeEmail(username);

  return (
    <div className="screen start-screen">
      <div className="screen-topbar">
        <LanguageToggle />
      </div>

      <StartPings />
      <img className="screen-logo" src={logo} alt={t("common.appName")} />

      {/* Promo modal (Login overlay) */}
      {showPromo && (
        <div className="promo-overlay" role="dialog" aria-modal="true" aria-label={t("login.promo.aria")}>
          <div className="promo-modal">
            <button
              type="button"
              className="promo-close"
              onClick={() => setShowPromo(false)}
              aria-label={t("common.close")}
              disabled={loading}
            >
              ✕
            </button>

            <div className="promo-title">{t("login.promo.title")}</div>
            <div className="promo-text">{t("login.promo.text")}</div>

            <div className="promo-images">
              <div className="promo-img-wrap">
                <img className="promo-img" src="/screen1.png" alt="screen1" />
              </div>
              <div className="promo-img-wrap">
                <img className="promo-img" src="/screen2.png" alt="screen2" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        {/* "Prova" (guest practice) – top-right inside the panel */}
        <button
          className="try-corner-btn"
          type="button"
          onClick={() => onTry && onTry()}
          disabled={loading || !onTry}
        >
          {t("login.tryBtn")}
        </button>

        <h1 className="title">{t("login.headline")}</h1>
        <p className="subtitle">{t("login.blurb")}</p>

        {!isLogin && (
          <div className="privacy-note">
            <div>
              <strong>{t("login.noEmailTitle")}</strong>
            </div>
            <div>{t("login.noEmailBody")}</div>
          </div>
        )}

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

            <div className="field-stack">
              <input
                id="login-username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={
                  isLogin ? t("login.username") : t("login.usernamePlaceholder")
                }
                autoComplete="username"
                disabled={loading}
              />

              {!isLogin && (
                <div className="field-help">{t("login.usernameHelp")}</div>
              )}

              {emailDetected && (
                <div className="field-warn">{t("login.emailDetected")}</div>
              )}
            </div>
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
