/**
 * Regenerates `.env.example` from a single source of truth.
 *
 * The file is committed (it is the documented template) but the tooling here
 * refuses to write `.env*` paths directly, so this script owns the content.
 * It contains placeholders only — never a real secret value.
 *
 * Run: node scripts/write-env-example.mjs
 */
import { writeFileSync } from "node:fs";

const content = `# TajirDz environment variables
#
# Copy to \`.env.local\` for local Vite use. NEVER commit a real value:
# \`.env.local\`, \`.env.keys\` and \`.env*.keys\` are git- and prettier-ignored.
#
# Convex-side variables are set on the deployment, not in this file:
#
#   npx convex env set VLY_EMAIL_API_KEY <value>
#   npx convex env set ADMIN_EMAILS you@example.com
#   npx convex env set VLY_APP_NAME TajirDz
#   npx convex env set VLY_EMAIL_HTML 1
#   npx convex env set VLY_EMAIL_LANG ar
#
# Run \`npx convex env list\` to see what is currently configured.
# Values below are placeholders only.

# ---------------------------------------------------------------------------
# Convex deployment (Vite client, prefixed VITE_ so Vite exposes it)
# ---------------------------------------------------------------------------
# Required: the deployment URL from the Convex dashboard.
VITE_CONVEX_URL=

# ---------------------------------------------------------------------------
# Convex server env (set with \`npx convex env set <NAME> <value>\`)
# ---------------------------------------------------------------------------

# API key for the transactional-email endpoint used by every auth flow:
# sign-up verification, password reset, email change and OTP sign-in.
# Without it, auth mail fails with a clear error instead of silently sending
# an unauthorised request.
VLY_EMAIL_API_KEY=

# Comma-separated allowlist of addresses that may become admin.
#
# An address here is promoted server-side on its first signed-in call, but ONLY
# after the email has been confirmed with a code. Registering the address is not
# enough: someone who does not control the inbox cannot claim admin.
#
# There is no seeded admin account. Promotion is granted, never revoked, so
# removing an address here does not demote an existing admin.
ADMIN_EMAILS=

# Display name used in outgoing email.
VLY_APP_NAME=TajirDz

# Opt-in branded HTML for auth e-mail (Arabic or French templates with the
# TajirDz wordmark, the code in large type and the "ignore this message"
# line). The endpoint rejects fields it does not recognise, so this defaults
# to off: set it to 1 only after the provider confirms it accepts "subject"
# and "html". Never put a secret value here.
VLY_EMAIL_HTML=

# Which language those templates use: ar (default) or fr.
VLY_EMAIL_LANG=ar

# Public site origin, used to build absolute URLs (sitemap, share links).
# Must match the deployed domain or the sitemap will point at the wrong host.
SITE_URL=
`;

writeFileSync(".env.example", content, "utf8");
console.log("wrote .env.example (placeholders only)");
