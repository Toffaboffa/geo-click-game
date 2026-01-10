import React from "react";
import { useI18n } from "./LanguageProvider";

const LABELS = {
  sv: "SV",
  en: "EN",
  es: "ES",
};

export default function LanguageToggle({ className = "" }) {
  const { lang, setLang, supported, t } = useI18n();

  return (
    <div className={`lang-toggle ${className}`} role="group" aria-label={t("common.language")}>
      {supported.map((code) => {
        const active = code === lang;
        return (
          <button
            key={code}
            type="button"
            className={`lang-btn ${active ? "is-active" : ""}`}
            onClick={() => setLang(code)}
            aria-pressed={active}
            title={code}
          >
            {LABELS[code] || code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
