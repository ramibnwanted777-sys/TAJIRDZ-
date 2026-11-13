/**
 * The body of every e-mail the auth flows send, in Arabic and French.
 *
 * The outbound endpoint (`auth.freebuff.app/send_otp`) takes `to`, `otp` and
 * `appName` and renders its own shell; anything beyond those fields is rejected
 * by the endpoint, so the markup here is only put on the wire when the
 * deployment opts in with `VLY_EMAIL_HTML`. Defaults are deliberately left
 * alone: a rejected payload would break sign-up and password reset outright.
 *
 * Every message follows the same three rules:
 *  - the wordmark is the English `TajirDz` in both languages;
 *  - the code is the biggest thing on the page, in `<bdi>` so its digits are
 *    never reordered by the surrounding direction;
 *  - a line tells anyone who did not ask for the code to ignore the message.
 */

export type AuthEmailLang = "ar" | "fr";

export type AuthEmailKind =
  /** Proving a new address, or a change of address. */
  | "verify"
  /** The six digits that unlock a password reset. */
  | "reset";

const COPY: Record<
  AuthEmailLang,
  Record<AuthEmailKind, { heading: string; body: string }> & {
    expires: string;
    singleUse: string;
    ignore: string;
  }
> = {
  ar: {
    verify: {
      heading: "أكّد بريدك الإلكتروني",
      body: "استعمل الرمز أدناه باش تفعّل حسابك في TajirDz.",
    },
    reset: {
      heading: "استرجاع كلمة المرور",
      body: "استعمل الرمز أدناه باش تبدّل كلمة مرورك.",
    },
    expires: "صالح لمدة 10 دقايق",
    singleUse: "يستعمل مرة واحدة",
    ignore: "تجاهل هذه الرسالة إذا ما كنتش طلبت هاد الرمز.",
  },
  fr: {
    verify: {
      heading: "Confirmez votre adresse e-mail",
      body: "Utilisez le code ci-dessous pour activer votre compte TajirDz.",
    },
    reset: {
      heading: "Réinitialiser le mot de passe",
      body: "Utilisez le code ci-dessous pour changer votre mot de passe.",
    },
    expires: "Valable 10 minutes",
    singleUse: "Utilisable une seule fois",
    ignore: "Ignorez ce message si vous n'avez pas demandé ce code.",
  },
};

/** The wordmark is English in both languages, by design. */
const WORDMARK = "TajirDz";

/** Direction of the document, so Arabic mail is not laid out left-to-right. */
const DIR: Record<AuthEmailLang, "rtl" | "ltr"> = { ar: "rtl", fr: "ltr" };

/** Escapes a value before it is placed in markup. Codes are digits anyway. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function authEmailSubject(
  lang: AuthEmailLang,
  kind: AuthEmailKind,
): string {
  const copy = COPY[lang];
  return `${copy[kind].heading} — ${WORDMARK}`;
}

/**
 * Full HTML for one auth e-mail.
 *
 * Inline styles only: mail clients strip `<style>` blocks, and the whole point
 * of the large code is that it survives being rendered by a webmail client.
 */
export function authEmailHtml({
  lang,
  kind,
  code,
}: {
  lang: AuthEmailLang;
  kind: AuthEmailKind;
  code: string;
}): string {
  const copy = COPY[lang];
  const heading = copy[kind].heading;
  const body = copy[kind].body;
  const dir = DIR[lang];

  return `<!doctype html>
<html dir="${dir}" lang="${lang === "ar" ? "ar-DZ" : "fr-DZ"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(
    heading,
  )}</title></head>
<body style="margin:0;padding:24px 12px;background:#eef6f1;font-family:Georgia,'Times New Roman',serif;color:#111;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e3e8e5;border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px 24px 8px;text-align:center;">
  <div style="font-size:24px;font-weight:800;letter-spacing:0.02em;color:#006233;">${WORDMARK}</div>
</td></tr>
<tr><td style="padding:0 24px 8px;text-align:center;">
  <h1 style="margin:0;font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h1>
  <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#374151;">${escapeHtml(body)}</p>
</td></tr>
<tr><td style="padding:16px 24px;text-align:center;">
  <div style="display:inline-block;padding:14px 22px;border:1px dashed #006233;border-radius:10px;background:#eef6f1;">
    <bdi style="display:block;font-size:40px;font-weight:800;letter-spacing:0.28em;color:#006233;line-height:1.1;">${escapeHtml(code)}</bdi>
  </div>
  <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">${copy.expires} · ${copy.singleUse}</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e3e8e5;">
  <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">${escapeHtml(
    copy.ignore,
  )}</p>
</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}
