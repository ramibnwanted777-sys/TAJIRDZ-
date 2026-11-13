/**
 * Document-level metadata for the page currently on screen.
 *
 * The tab title is deliberately the English wordmark on every route, in both
 * languages: a browser tab has no room for an Arabic sentence, the brand name
 * is "TajirDz" everywhere else, and a title that changed with the language made
 * the tab read like a different site after a switch.
 *
 * Theme colour is set from here rather than only from `index.html` because some
 * Android browsers read the meta tag at navigation time, and a wrong colour
 * shows up as a white status bar around a green app.
 *
 * Called by both layouts (`AppShell` and `BarePageLayout`), so every route —
 * including the auth screens that render without the header — gets it.
 */

import { useEffect } from "react";

const PAGE_TITLE = "TajirDz";
const THEME_COLOR = "#006233";

export function usePageMeta(title: string = PAGE_TITLE): void {
  useEffect(() => {
    document.title = title;

    let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!theme) {
      theme = document.createElement("meta");
      theme.setAttribute("name", "theme-color");
      document.head.appendChild(theme);
    }
    theme.setAttribute("content", THEME_COLOR);
  }, [title]);
}
