/**
 * Global error boundary.
 *
 * A rejected query inside the shared provider tree otherwise blanks the whole
 * app, which is what a signed-out visitor hitting an authenticated query used
 * to see. This catches anything that still escapes and offers a way out.
 *
 * Convex surfaces server errors as strings carrying a request id, which means
 * nothing to a user, so they are mapped to a readable message and the raw text
 * is kept out of the screen (but available in the console for debugging).
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { BarePageLayout } from "@/components/BarePageLayout";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Classify a raw Convex/server error for logging and tests.
 *
 * Returns a stable slug. The UI shows a single generic message either way: the
 * boundary can render above the language provider, so it cannot look the slug
 * up in the dictionary, and a crash page is not the place to be specific.
 */
export function readableErrorKey(error: Error | null): string {
  const raw = (error?.message ?? "").toLowerCase();
  if (!raw) return "errGeneric";
  if (raw.includes("errnotsignedin") || raw.includes("unauthorized")) {
    return "errNotSignedIn";
  }
  if (raw.includes("errnotauthorized") || raw.includes("forbidden")) {
    return "errNotAuthorized";
  }
  if (raw.includes("ratelimit") || raw.includes("try again in")) {
    return "errRateLimited";
  }
  if (raw.includes("errnotfound")) return "errNotFound";
  if (raw.includes("failed to fetch") || raw.includes("network")) {
    return "errNetwork";
  }
  return "errGeneric";
}

/**
 * Bilingual copy kept here rather than in the dictionary because the boundary
 * can render above the `LanguageProvider` if the provider itself throws, in
 * which case the context is unavailable.
 */
const COPY = {
  ar: {
    title: "وقع مشكل",
    body: "صفحة ما تقدرش تعرض درو. جرّب من جديد، ولا رجع للصفحة الرئيسية.",
    retry: "عاود جرب",
    home: "الصفحة الرئيسية",
  },
  fr: {
    title: "Une erreur est survenue",
    body: "Cette page n'a pas pu s'afficher. Réessayez ou revenez à l'accueil.",
    retry: "Réessayer",
    home: "Accueil",
  },
} as const;

function currentLang(): "ar" | "fr" {
  if (typeof document === "undefined") return "ar";
  return document.documentElement.lang?.startsWith("fr") ? "fr" : "ar";
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the original for developers; never render it to the user.
    console.error("[TajirDz] render error:", error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const lang = currentLang();
    const copy = COPY[lang];

    return (
      <BarePageLayout className="bg-background" role="alert">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#eef6f1]">
            <AlertTriangle className="size-6 text-[#006233]" aria-hidden />
          </div>
          <h1 className="text-lg font-bold text-black">{copy.title}</h1>
          <p className="mt-2 text-sm text-neutral-600">{copy.body}</p>

          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={this.reset}
              className="tap-target flex w-full items-center justify-center gap-2 rounded-lg bg-[#006233] px-4 text-sm font-semibold text-white"
            >
              <RotateCcw className="size-4" aria-hidden />
              {copy.retry}
            </button>
            <a
              href="/"
              className="tap-target flex w-full items-center justify-center gap-2 rounded-lg border border-[#e3e8e5] px-4 text-sm font-medium text-neutral-700"
            >
              <Home className="size-4" aria-hidden />
              {copy.home}
            </a>
          </div>
        </div>
      </BarePageLayout>
    );
  }
}
