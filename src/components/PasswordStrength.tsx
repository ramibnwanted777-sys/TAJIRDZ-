/**
 * Password strength meter.
 *
 * Advisory only: the server re-runs the same rules through
 * `validatePassword`, so this exists to tell somebody *why* a password will be
 * rejected before they press the button, not to decide anything.
 *
 * The score and the list of missing rules both come from `passwordStrength`,
 * which is shared with the server policy, so the meter can never disagree with
 * what the backend accepts.
 */

import { useLang } from "@/lib/lang";
import type { Dict } from "@/lib/i18n";
import { passwordStrength } from "@/convex/lib/security";

const LABEL_KEYS = [
  "strengthVeryWeak",
  "strengthWeak",
  "strengthFair",
  "strengthGood",
  "strengthStrong",
] as const;

const BAR_COLOURS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-600",
  "bg-[#006233]",
];

export function PasswordStrength({ password }: { password: string }) {
  const { t } = useLang();
  const strength = passwordStrength(password);
  const problems = strength.problems
    .filter((key): key is keyof Dict => key in t)
    .map((key) => t[key]);

  return (
    <div aria-live="polite">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-neutral-600">{t.authStrength}</span>
        {password && (
          <span className="text-[11px] font-semibold text-neutral-700">
            {t[LABEL_KEYS[strength.score]]}
          </span>
        )}
      </div>
      <div className="flex gap-1" role="img" aria-label={t.authStrength}>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${
              password && index < strength.score
                ? BAR_COLOURS[strength.score]
                : "bg-neutral-200"
            }`}
          />
        ))}
      </div>
      {problems.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {problems.map((problem) => (
            <li key={problem} className="text-[11px] text-neutral-500">
              {problem}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}