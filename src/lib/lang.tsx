/**
 * Language provider: Arabic (RTL, default) and French (LTR).
 *
 * The chosen language is written to <html lang> and <html dir> so the browser,
 * screen readers and the PWA manifest all agree with the UI. User-authored
 * content is never translated — only chrome.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LANG,
  HTML_DIR,
  HTML_LANG,
  getDict,
  type Dict,
  type Lang,
} from "@/lib/i18n";

const STORAGE_KEY = "tajirdz:lang";

type LangContextValue = {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: Dict;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
};

const LangContext = createContext<LangContextValue | null>(null);

function readStoredLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "fr" || stored === "ar" ? stored : DEFAULT_LANG;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // This is a Vite SPA with no server render, so the browser's stored
  // preference is available on the very first render. Seeding via the lazy
  // initializer avoids a default-then-switch flash and a cascading render.
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  const dir = HTML_DIR[lang];

  useEffect(() => {
    const root = document.documentElement;
    root.lang = HTML_LANG[lang];
    root.dir = dir;
    // The tab title is deliberately not touched here: `usePageMeta` keeps it
    // as the English wordmark on every route, in both languages.
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing can reject writes; the in-memory choice still applies.
    }
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      dir,
      t: getDict(lang),
      setLang,
      toggleLang: () => setLang(lang === "ar" ? "fr" : "ar"),
    }),
    [lang, dir, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside LanguageProvider");
  return ctx;
}

/** Shorthand when only the dictionary is needed. */
export function useT(): Dict {
  return useLang().t;
}