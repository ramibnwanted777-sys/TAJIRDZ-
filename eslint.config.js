import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

/**
 * Fails if an emoji appears in a source file.
 *
 * The UI uses lucide icons throughout, so an emoji is always a regression: it
 * renders inconsistently across platforms, ignores the icon sizing tokens, and
 * cannot be styled for RTL. This rule makes that a lint error instead of
 * something a reviewer has to spot.
 *
 * Code-point ranges covered: pictographs, emoticons, transport, supplemental
 * symbols (the dingbat/star/check glyphs), and the variation selector.
 */
const noEmoji = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow emoji in source; use a lucide-react icon instead.",
    },
    messages: {
      noEmoji:
        'Emoji "{{emoji}}" is not allowed. Use a lucide-react icon (sizes 16/20/24 from the icon tokens) and an aria-label or aria-hidden as appropriate.',
    },
    schema: [],
  },
  create(context) {
    // Pictographs, emoticons, transport, supplemental symbols/dingbats
    // (star, check, warning), regional-indicator flags, and the variation
    // selector that renders them.
    //
    // Arrows U+2190-U+21FF are deliberately excluded: `→` is used as ordinary
    // typography in the admin conversion label, not as a pictograph.
    const EMOJI =
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const match = node.value.match(EMOJI);
        if (match) {
          context.report({ node, messageId: "noEmoji", data: { emoji: match[0] } });
        }
      },
      // Template literals and JSX text are not `Literal` nodes.
      TemplateElement(node) {
        const match = node.value.raw.match(EMOJI);
        if (match) {
          context.report({ node, messageId: "noEmoji", data: { emoji: match[0] } });
        }
      },
      JSXText(node) {
        const match = node.value.match(EMOJI);
        if (match) {
          context.report({ node, messageId: "noEmoji", data: { emoji: match[0] } });
        }
      },
    };
  },
};

export default tseslint.config(
  // `src/convex/_generated` is written by the Convex CLI (and is committed so
  // the project typechecks without a deployment). Linting it would only ever
  // report on machine-written code.
  { ignores: ["dist", "src/convex/_generated"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      tajirdz: { rules: { "no-emoji": noEmoji } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "tajirdz/no-emoji": "error",
    },
  },
  {
    // The shadcn barrel file documents its own API with ✅/❌ examples. Those are
    // code samples in a comment, never rendered, so they are exempt.
    files: ["src/components/ui/index.ts"],
    rules: { "tajirdz/no-emoji": "off" },
  },
);
