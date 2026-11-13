/**
 * The auth e-mails, in both languages.
 *
 * These are the parts of the template the brief calls out by name: the English
 * `TajirDz` wordmark, the code in large type, the line telling someone who did
 * not ask for a code to ignore the message, and correct direction for Arabic.
 */

import { describe, expect, it } from "vitest";

import { authEmailHtml, authEmailSubject } from "@/convex/auth/emailTemplates";

const CODE = "481902";

describe("auth e-mail templates", () => {
  for (const lang of ["ar", "fr"] as const) {
    for (const kind of ["verify", "reset"] as const) {
      const html = authEmailHtml({ lang, kind, code: CODE });

      it(`${lang}/${kind} keeps the English wordmark`, () => {
        expect(html).toContain("TajirDz");
        // The brand name is never translated or transliterated.
        expect(html).not.toContain("طاجير");
        expect(authEmailSubject(lang, kind)).toContain("TajirDz");
      });

      it(`${lang}/${kind} shows the code in large type`, () => {
        expect(html).toContain(CODE);
        expect(html).toMatch(/font-size:\s*40px/);
        // bdi keeps the digits from being reordered inside an RTL document.
        expect(html).toMatch(/<bdi[^>]*>481902<\/bdi>/);
      });

      it(`${lang}/${kind} carries the ignore line`, () => {
        expect(html).toContain(
          lang === "ar"
            ? "تجاهل هذه الرسالة إذا ما كنتش طلبت هاد الرمز."
            : "Ignorez ce message si vous n'avez pas demandé ce code.",
        );
      });

      it(`${lang}/${kind} sets the document direction`, () => {
        expect(html).toContain(lang === "ar" ? 'dir="rtl"' : 'dir="ltr"');
        expect(html).toContain(lang === "ar" ? 'lang="ar-DZ"' : 'lang="fr-DZ"');
      });
    }
  }

  it("says how long the code lasts and that it works once", () => {
    const ar = authEmailHtml({ lang: "ar", kind: "reset", code: CODE });
    const fr = authEmailHtml({ lang: "fr", kind: "reset", code: CODE });
    expect(ar).toContain("10 دقايق");
    expect(ar).toContain("يستعمل مرة واحدة");
    expect(fr).toContain("10 minutes");
    expect(fr).toContain("Utilisable une seule fois");
  });

  it("distinguishes the two kinds of message", () => {
    const verify = authEmailHtml({ lang: "ar", kind: "verify", code: CODE });
    const reset = authEmailHtml({ lang: "ar", kind: "reset", code: CODE });
    expect(verify).toContain("أكّد بريدك الإلكتروني");
    expect(reset).toContain("استرجاع كلمة المرور");
    expect(verify).not.toContain("استرجاع كلمة المرور");
  });

  it("escapes anything interpolated into the markup", () => {
    const html = authEmailHtml({ lang: "fr", kind: "verify", code: "<script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
