import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

import sv from "./dictionaries/sv";
import en from "./dictionaries/en";
import es from "./dictionaries/es";

const STORAGE_KEY = "geosense_lang";
const SUPPORTED = ["sv", "en", "es"];

function normalizeLang(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  const base = raw.split("-")[0].split("_")[0];
  return SUPPORTED.includes(base) ? base : null;
}

function getInitialLang() {
  try {
    const stored = normalizeLang(window?.localStorage?.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // ignore
  }

  const nav = normalizeLang(typeof navigator !== "undefined" ? navigator.language : "");
  return nav || "sv";
}

function getByPath(obj, keyPath) {
  if (!obj || !keyPath) return undefined;
  const parts = String(keyPath).split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function interpolate(template, vars) {
  const s = String(template ?? "");
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => {
    if (Object.prototype.hasOwnProperty.call(vars, k)) return String(vars[k]);
    return m;
  });
}

const I18nContext = createContext({
  lang: "sv",
  setLang: () => {},
  t: (key) => String(key || ""),
  supported: SUPPORTED,
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLang);

  const dicts = useMemo(() => ({ sv, en, es }), []);

  const setLang = (next) => {
    const normalized = normalizeLang(next) || "sv";
    setLangState(normalized);
    try {
      window?.localStorage?.setItem(STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
  };

  const t = useMemo(() => {
    return (key, vars) => {
      const k = String(key || "");
      const primary = dicts[lang] || dicts.sv;
      const fallback = dicts.sv;

      let val = getByPath(primary, k);
      if (typeof val !== "string") val = getByPath(fallback, k);
      if (typeof val !== "string") return k;

      return interpolate(val, vars);
    };
  }, [dicts, lang]);

  // Keep <html lang="..."> in sync (nice for accessibility)
  useEffect(() => {
    try {
      document.documentElement.lang = lang || "sv";
    } catch {
      // ignore
    }
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t, supported: SUPPORTED }), [lang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
