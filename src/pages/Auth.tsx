/**
 * Authentication and onboarding.
 *
 * Sign-in is email + password through the Convex Auth password provider, with
 * a one-time code by email kept as a secondary option for people who never set
 * a password. Every credential flow is preceded by `authGuard.chargeAttempt`,
 * which is what produces the "try again in X minutes" messages and the
 * five-try lock, and every password failure is reported as one generic message
 * so the form cannot be used to discover which addresses have accounts.
 *
 * Creating an account is self-service: the password alone signs the new user
 * in, because the deployment has no mail sender yet (see
 * `src/convex/auth/password.ts`). The address is stored unproven, so nothing
 * that demands a verified address — admin bootstrap in particular — can be
 * claimed by typing someone else's e-mail. Onboarding then runs, and the
 * wholesaler form creates the shop that every product hangs off.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { Store, ShoppingBag, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { useLang } from "@/lib/lang";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, DELIVERY_OPTIONS, STORE_TYPES, WILAYAS } from "@/lib/catalog";
import { Logo } from "@/components/Logo";
import {
  BarePageLayout,
  BarePageHeader,
} from "@/components/BarePageLayout";
import { PasswordStrength } from "@/components/PasswordStrength";
import { interpolate } from "@/lib/i18n";
import { authErrorText } from "@/lib/authErrors";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/convex/lib/security";
import { parseAuthGuardError } from "@/convex/lib/authGuard";

/** The provider id registered in `src/convex/auth.ts`. */
const PASSWORD_PROVIDER = "password";

/** Resend cooldown, matching the server's `resetRequest` bucket window. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Which screen the page is showing. */
type Step = "signin" | "signup" | "role" | "wholesaler" | "retailer";

/**
 * Accept only a same-site absolute path (`/dashboard?tab=x`).
 *
 * Rejects protocol-relative (`//evil.com`), absolute URLs, and anything with a
 * scheme, so a crafted sign-in link cannot bounce a just-authenticated user
 * off the origin.
 */
function safeReturnTo(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  // `//host` and `/\host` are both treated as protocol-relative by browsers.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export function Auth({ redirectAfterAuth }: { redirectAfterAuth: string }) {
  const { t } = useLang();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { signOut, isAuthenticated, isLoading, user } = useAuth();

  const [chosenStep, setChosenStep] = useState<Step | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // `returnTo` arrives from the URL, so it must be treated as untrusted input:
  // only same-site paths are honoured, otherwise `/auth?returnTo=https://evil`
  // would turn this page into an open redirect after a successful sign-in.
  const returnTo = safeReturnTo(params.get("returnTo"), redirectAfterAuth);
  const initialRole = params.get("role");

  // A signed-in, fully onboarded user or admin never needs the onboarding screens.
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;
    if (user?.role === "admin") {
      navigate("/admin", { replace: true });
      return;
    }
    if (user?.onboardedAt && user.role) {
      navigate(returnTo, { replace: true });
    }
  }, [isAuthenticated, isLoading, user?.onboardedAt, user?.role, navigate, returnTo]);

  const signedInNeedsOnboarding =
    isAuthenticated && user?.role !== "admin" && !(user?.onboardedAt && user.role);
  const roleFromQuery =
    initialRole === "wholesaler" || initialRole === "retailer" ? initialRole : null;

  const storedRole: Step =
    user?.role === "wholesaler"
      ? "wholesaler"
      : user?.role === "retailer"
        ? "retailer"
        : "role";
  const effectiveChosen =
    signedInNeedsOnboarding && (chosenStep === "signin" || chosenStep === "signup")
      ? null
      : chosenStep;
  const step: Step =
    effectiveChosen ?? (signedInNeedsOnboarding ? (roleFromQuery ?? storedRole) : "signin");

  const inOnboarding = step === "role" || step === "wholesaler" || step === "retailer";

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-neutral-500">
        {t.loading}
      </div>
    );
  }

  return (
    <BarePageLayout
      header={
        <BarePageHeader
          mark={<Logo size="md" label={null} />}
          title={t.authTitle}
          subtitle={t.authSubtitle}
        />
      }
    >

      {!inOnboarding && (
        <div
          role="tablist"
          aria-label={t.authTitle}
          className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-[#eef6f1] p-1.5 border border-[#dcefe4]"
        >
          <TabButton
            active={!resetOpen && step === "signin"}
            onClick={() => {
              setChosenStep("signin");
              setResetOpen(false);
              setNotice(null);
            }}
          >
            {t.authTabSignIn}
          </TabButton>
          <TabButton
            active={!resetOpen && step === "signup"}
            onClick={() => {
              setChosenStep("signup");
              setResetOpen(false);
              setNotice(null);
            }}
          >
            {t.authTabSignUp}
          </TabButton>
        </div>
      )}

      <div className="rounded-2xl border border-[#e3e8e5] bg-card p-4 shadow-xs sm:p-6">
        {step === "role" && (
          <RolePicker
            onPick={(pick) => setChosenStep(pick)}
            onCancel={() => signOut()}
          />
        )}

        {step === "wholesaler" && (
          <WholesalerForm onDone={() => navigate("/dashboard", { replace: true })} />
        )}
        {step === "retailer" && (
          <RetailerForm onDone={() => navigate("/", { replace: true })} />
        )}

        {step === "signin" && (
          <>
            {resetOpen ? (
              <ResetPasswordPanel
                onCancel={() => {
                  setResetOpen(false);
                  setNotice(t.authResetDone);
                }}
              />
            ) : (
              <SignInPanel
                onForgotPassword={() => {
                  setResetOpen(true);
                  setNotice(null);
                }}
                onSwitchToSignup={() => setChosenStep("signup")}
              />
            )}
          </>
        )}

        {step === "signup" && (
          <SignUpPanel onSwitchToSignIn={() => setChosenStep("signin")} />
        )}

        {notice && !resetOpen && (
          <p
            role="status"
            className="mt-4 rounded-lg bg-[#eef6f1] px-3 py-2 text-center text-xs text-[#006233]"
          >
            {notice}
          </p>
        )}

        {!inOnboarding && isAuthenticated && (
          <button
            onClick={() => signOut()}
            className="mt-4 w-full text-center text-xs text-neutral-500 underline"
          >
            {t.navLogout}
          </button>
        )}
      </div>

    </BarePageLayout>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "tap-target rounded-lg bg-white px-3 text-sm font-bold text-[#006233] shadow-xs transition-all"
          : "tap-target rounded-lg px-3 text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

const inputClass =
  "tap-target w-full rounded-xl border border-[#e3e8e5] bg-white px-3.5 text-sm outline-none transition-all duration-150 focus:border-[#006233] focus:ring-2 focus:ring-[#006233]/20 shadow-xs";

function Field({
  label,
  children,
  hint,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold text-neutral-800"
      >
        {label}
      </label>
      {children}
      {hint && <span className="block text-[11px] text-neutral-500">{hint}</span>}
    </div>
  );
}

function ErrorNote({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800"
    >
      {children}
    </p>
  );
}

/**
 * Password input with a show/hide toggle.
 *
 * `autoComplete` is passed through deliberately: browsers use it to offer the
 * right saved credential and to keep the sign-up and change-password forms
 * from autofilling each other.
 */
function PasswordField({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  placeholder?: string;
}) {
  const { t } = useLang();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        dir="ltr"
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={autoComplete === "current-password" ? t.authPassword : t.authNewPassword}
        className={`${inputClass} pe-12 text-start`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t.authHidePassword : t.authShowPassword}
        aria-pressed={visible}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-neutral-500"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

/** Six-digit code entry. Numeric keypad on phones, OTP autofill on desktop. */
function CodeField({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      dir="ltr"
      maxLength={6}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      className={`${inputClass} text-center text-lg tracking-[0.4em]`}
    />
  );
}

function PrimaryButton({
  busy,
  children,
  type = "submit",
  disabled,
  onClick,
}: {
  busy: boolean;
  children: React.ReactNode;
  type?: "submit" | "button";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      aria-busy={busy}
      className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#006233] hover:bg-[#004d29] px-4 text-sm font-bold text-white shadow-xs transition-all disabled:opacity-60 cursor-pointer active:scale-[0.99]"
    >
      {/* The label stays put while the spinner runs: swapping it out leaves the
          button with no accessible name for as long as the request lasts. */}
      {busy && <Spinner />}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

function SignInPanel({
  onForgotPassword,
  onSwitchToSignup,
}: {
  onForgotPassword: () => void;
  onSwitchToSignup: () => void;
}) {
  const { t } = useLang();
  const { signIn } = useAuth();
  const chargeAttempt = useMutation(api.authGuard.chargeAttempt);
  const clearLockout = useMutation(api.authGuard.clearSignInLockout);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [codeMode, setCodeMode] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError(t.errRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await chargeAttempt({ kind: "signIn", email }).catch((err) => {
        if (err instanceof Error && err.message.startsWith("errAuthGuard:")) {
          throw err;
        }
      });
      const result = await signIn(PASSWORD_PROVIDER, {
        flow: "signIn",
        email,
        password,
      });
      // `signIn` always resolves to an object, so the only way to tell a real
      // sign-in from a pending verification is `signingIn`. Testing the result
      // for truthiness is what made the button look dead: the branch below
      // could never run.
      if (result && !result.signingIn) {
        // The account exists but the address was never proven. Convex Auth has
        // just emailed a fresh code, so offer to confirm it rather than
        // pretending the password was wrong.
        setNeedsCode(true);
        toast.success(interpolate(t.authCodeSentTo, { email }));
        return;
      }
      // A correct password clears the failed-attempt counter, so a couple of
      // typos never lock someone out.
      await clearLockout({ email }).catch(() => {});
      toast.success(t.authSignInSubmit);
    } catch (err) {
      setError(authErrorText(err, t, t.authInvalidCredentials));
    } finally {
      setBusy(false);
    }
  };

  if (codeMode) {
    return <CodeSignInPanel email={email} onBack={() => setCodeMode(false)} />;
  }

  // The code screen is a form of its own, so it replaces this one instead of
  // sitting inside it: a nested <form> is dropped by the browser, which made
  // its confirm button submit the sign-in form behind it and do nothing.
  if (needsCode) {
    return (
      <VerifyAccountNotice
        email={email}
        onVerified={() => setNeedsCode(false)}
        onBack={() => setNeedsCode(false)}
      />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t.authEmail} htmlFor="signin-email">
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputClass} text-start`}
        />
      </Field>

      <Field label={t.authPassword} htmlFor="signin-password">
        <PasswordField
          id="signin-password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </Field>

      <button
        type="button"
        onClick={onForgotPassword}
        className="tap-target inline-flex items-center text-xs font-medium text-[#006233] underline"
      >
        {t.authForgotPassword}
      </button>

      {error && <ErrorNote>{error}</ErrorNote>}

      <PrimaryButton busy={busy}>{t.authSignInSubmit}</PrimaryButton>

      <div className="space-y-2 border-t border-[#e3e8e5] pt-3 text-center">
        <p className="text-xs text-neutral-600">
          {t.authNoAccount}{" "}
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="font-semibold text-[#006233] underline hover:text-[#004d29]"
          >
            {t.authCreateOne}
          </button>
        </p>
        <button
          type="button"
          onClick={() => setCodeMode(true)}
          className="tap-target inline-flex items-center text-xs text-neutral-500 underline hover:text-neutral-800"
        >
          {t.authUseCodeInstead}
        </button>
      </div>

    </form>
  );
}

/**
 * Shown when a password is accepted but the address is still unproven.
 *
 * Kept separate from the sign-in form because it is a genuinely different
 * state, not an error: the account exists, it just cannot be used yet.
 */
function VerifyAccountNotice({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  /** Optional way back to whatever form this replaced. */
  onBack?: () => void;
}) {
  const { t } = useLang();
  const { signIn } = useAuth();
  const chargeAttempt = useMutation(api.authGuard.chargeAttempt);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) {
      setError(t.errRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await chargeAttempt({ kind: "emailVerify", email });
      const result = await signIn(PASSWORD_PROVIDER, {
        flow: "email-verification",
        email,
        code,
      });
      if (!result.signingIn) {
        setError(t.authCodeWrong);
        return;
      }
      toast.success(t.authVerified);
      onVerified();
    } catch (err) {
      setError(authErrorText(err, t, t.authCodeWrong));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-[#e3e8e5] pt-4" noValidate>
      <h2 className="text-sm font-bold text-black">{t.authVerifyTitle}</h2>
      <p className="text-xs leading-relaxed text-neutral-600">
        {interpolate(t.authVerifyHint, { email })}
      </p>
      <CodeField id="verify-code" value={code} onChange={setCode} label={t.authVerifyTitle} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton busy={busy}>{t.authVerify}</PrimaryButton>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="tap-target inline-flex items-center justify-center text-xs text-neutral-500 underline"
        >
          {t.authBackToSignIn}
        </button>
      )}
    </form>
  );
}

/** The original one-time-code sign-in, kept as a secondary option. */
function CodeSignInPanel({ email, onBack }: { email: string; onBack: () => void }) {
  const { t } = useLang();
  const { signIn } = useAuth();
  // With no deployment URL the app runs against the in-browser demo backend,
  // which shows the code in a toast instead of sending mail. Saying so beats
  // leaving someone waiting for an e-mail that will never arrive.
  const isLocalDemo = !(
    import.meta.env.VITE_CONVEX_URL as string | undefined
  )?.trim();

  const [address, setAddress] = useState(email);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!address.includes("@")) {
      setError(t.errRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn("email-otp", { email: address });
      setCodeSent(true);
      toast.success(t.authCodeSent);
    } catch (err) {
      // A failed send is usually the deployment's mail key, not a wrong
      // address; `authErrorText` names it instead of saying "something failed".
      setError(authErrorText(err, t, t.errGeneric));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length < 4) {
      setError(t.errRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn("email-otp", { email: address, code });
      toast.success(t.authVerified);
    } catch (err) {
      setError(authErrorText(err, t, t.authCodeWrong));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-xs font-medium text-neutral-600">
        <button type="button" onClick={onBack} className="underline">
          {t.authBackToSignIn}
        </button>
      </div>

      <Field label={t.authEmail} htmlFor="otp-email">
        <input
          id="otp-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={`${inputClass} text-start`}
        />
      </Field>

      {isLocalDemo && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-neutral-600">
          {t.authLocalDemoNotice}
        </p>
      )}

      {!codeSent ? (
        <PrimaryButton busy={busy} type="button" onClick={send}>
          {t.authContinue}
        </PrimaryButton>
      ) : (
        <>
          <Field label={t.authCodePlaceholder} htmlFor="otp-code">
            <CodeField id="otp-code" value={code} onChange={setCode} label={t.authCodePlaceholder} />
          </Field>
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton busy={busy} type="button" onClick={verify}>
              {t.authVerify}
            </PrimaryButton>
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="tap-target rounded-lg border border-[#e3e8e5] px-4 text-sm disabled:opacity-60"
            >
              {t.authResend}
            </button>
          </div>
        </>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create account
// ---------------------------------------------------------------------------

function SignUpPanel({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  const { t } = useLang();
  const { signIn } = useAuth();
  const chargeAttempt = useMutation(api.authGuard.chargeAttempt);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<"wholesaler" | "retailer" | "">("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError(t.authNameRequired);
      return;
    }
    if (!email.includes("@")) {
      setError(t.errRequired);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t.errPasswordTooShort);
      return;
    }
    if (passwordStrength(password).problems.length > 0) {
      setError(t.errPasswordTooWeak);
      return;
    }
    if (password !== confirm) {
      setError(t.authPasswordMismatch);
      return;
    }
    if (!role) {
      setError(t.authRoleLabel);
      return;
    }
    if (!accepted) {
      setError(t.authTermsRequired);
      return;
    }

    setBusy(true);
    try {
      await chargeAttempt({ kind: "signUp", email }).catch((err) => {
        if (err instanceof Error && err.message.startsWith("errAuthGuard:")) {
          throw err;
        }
      });
      const result = await signIn(PASSWORD_PROVIDER, {
        flow: "signUp",
        email,
        password,
        name: name.trim(),
        role,
      });
      // Sign-up always needs the e-mail code first, so `signingIn` stays false
      // until the address is proven — that is the cue to show the code screen.
      if (!result.signingIn) {
        // Expected: the account exists but is inert until the code is proven.
        setPendingEmail(email);
        toast.success(interpolate(t.authCodeSentTo, { email }));
        return;
      }
      toast.success(t.authVerified);
    } catch (err) {
      setError(authErrorText(err, t, t.errGeneric));
    } finally {
      setBusy(false);
    }
  };

  if (pendingEmail) {
    return (
      <VerifyAccountNotice email={pendingEmail} onVerified={() => setPendingEmail(null)} />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label={t.authFullName} htmlFor="signup-name">
        <input
          id="signup-name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label={t.authEmail} htmlFor="signup-email">
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`${inputClass} text-start`}
        />
      </Field>

      <Field label={t.authPassword} htmlFor="signup-password">
        <PasswordField
          id="signup-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
      </Field>
      <PasswordStrength password={password} />

      <Field
        label={t.authConfirmPassword}
        htmlFor="signup-confirm"
        hint={confirm && confirm !== password ? t.authPasswordMismatch : undefined}
      >
        <PasswordField
          id="signup-confirm"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-neutral-700">{t.authRoleLabel}</legend>
        <div className="grid grid-cols-2 gap-2">
          <RoleChoice
            active={role === "wholesaler"}
            onClick={() => setRole("wholesaler")}
            icon={Store}
            label={t.roleWholesaler}
          />
          <RoleChoice
            active={role === "retailer"}
            onClick={() => setRole("retailer")}
            icon={ShoppingBag}
            label={t.roleRetailer}
          />
        </div>
      </fieldset>

      <label className="flex items-start gap-2 text-xs leading-relaxed text-neutral-700">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span>
          {t.authAcceptTerms}{" "}
          <Link to="/terms" className="font-medium text-[#006233] underline">
            {t.footerTerms}
          </Link>
        </span>
      </label>

      {error && <ErrorNote>{error}</ErrorNote>}

      <PrimaryButton busy={busy}>{t.authSignUpSubmit}</PrimaryButton>

      <p className="text-center text-xs text-neutral-600">
        {t.authHaveAccount}{" "}
        <button
          type="button"
          onClick={onSwitchToSignIn}
          className="font-semibold text-[#006233] underline hover:text-[#004d29]"
        >
          {t.authSignInNow}
        </button>
      </p>
    </form>
  );
}

function RoleChoice({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Store;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tap-target flex min-h-18 flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-3 py-2.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
        active
          ? "border-[#006233] bg-[#eef6f1] text-[#006233] shadow-xs scale-[1.02]"
          : "border-[#e3e8e5] bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
      }`}
    >
      <div className={`p-1.5 rounded-lg ${active ? "bg-[#006233] text-white" : "bg-neutral-100 text-neutral-600"}`}>
        <Icon className="size-5 shrink-0" aria-hidden />
      </div>
      <span className="text-balance w-full text-center leading-tight line-clamp-2">
        {label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

function ResetPasswordPanel({ onCancel }: { onCancel: () => void }) {
  const { t, lang } = useLang();
  const { signIn } = useAuth();
  const chargeAttempt = useMutation(api.authGuard.chargeAttempt);
  const emailReady = useQuery(api.authGuard.emailSenderConfigured);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // State, not a ref: the deadline has to survive switching between the code
  // and password screens, and a ref read during render would not re-render the
  // countdown when the second passes.
  const [deadline, setDeadline] = useState(0);

  // One ticker drives both the countdown label and the resend button.
  useEffect(() => {
    if (step !== 2) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));

  /**
   * Ask for a code. The response is identical whether or not the address has
   * an account, so this screen cannot be used to enumerate users.
   */
  const requestCode = async (address: string) => {
    setBusy(true);
    setError(null);
    setDeadline(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    setNow(Date.now());
    try {
      await chargeAttempt({ kind: "resetRequest", email: address });
      await signIn(PASSWORD_PROVIDER, { flow: "reset", email: address });
    } catch {
      // Swallowed on purpose: an unknown address and a rate-limited one must
      // look the same to the person in front of the screen.
    } finally {
      setStep(2);
      setBusy(false);
      toast.success(t.authResetSent);
    }
  };

  const submitEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.includes("@")) {
      setError(t.errRequired);
      return;
    }
    await requestCode(email);
  };

  const resend = async () => {
    if (secondsLeft > 0) return;
    await requestCode(email);
  };

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError(t.errRequired);
      return;
    }
    // The code is not checked here on purpose. Convex Auth applies the new
    // password and consumes the code in one atomic step, so asking for the
    // password first avoids telling a stranger whether a code was right.
    setStep(3);
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t.errPasswordTooShort);
      return;
    }
    if (passwordStrength(password).problems.length > 0) {
      setError(t.errPasswordTooWeak);
      return;
    }
    if (password !== confirm) {
      setError(t.authPasswordMismatch);
      return;
    }

    setBusy(true);
    try {
      await chargeAttempt({ kind: "resetVerify", email });
      await signIn(PASSWORD_PROVIDER, {
        flow: "reset-verification",
        email,
        code,
        newPassword: password,
      });
      toast.success(t.authResetDone);
      onCancel();
    } catch (err) {
      const guard = parseAuthGuardError(err instanceof Error ? err.message : "");
      if (guard) {
        setError(interpolate(t.authLockout, { minutes: guard.minutes }));
        return;
      }
      // Anything else from the provider at this point is the code: expired,
      // already used, or simply wrong. Send them back to retype it.
      setError(t.authCodeWrong);
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  if (step === 1) {
    // Without a sender the next screen would ask for a code that can never
    // arrive, so say what is actually wrong and how to get a new password.
    if (emailReady === false) {
      return (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-black">{t.authResetTitle}</h2>
          <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            {t.authResetUnavailable}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="tap-target inline-flex items-center gap-1 text-xs font-semibold text-[#006233]"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {lang === "ar" ? "رجوع" : "Retour"}
          </button>
        </div>
      );
    }

    return (
      <form onSubmit={submitEmail} className="space-y-4" noValidate>
        <h2 className="text-sm font-bold text-black">{t.authResetTitle}</h2>
        <p className="text-xs leading-relaxed text-neutral-600">{t.authResetStepEmail}</p>
        <Field label={t.authEmail} htmlFor="reset-email">
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} text-start`}
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton busy={busy}>{t.authContinue}</PrimaryButton>
        <BackToSignIn onCancel={onCancel} />
      </form>
    );
  }

  if (step === 3) {
    return (
      <form onSubmit={submitPassword} className="space-y-4" noValidate>
        <h2 className="text-sm font-bold text-black">{t.authResetStepPassword}</h2>
        <Field label={t.authNewPassword} htmlFor="reset-password">
          <PasswordField
            id="reset-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
        </Field>
        <PasswordStrength password={password} />
        <Field
          label={t.authConfirmPassword}
          htmlFor="reset-confirm"
          hint={confirm && confirm !== password ? t.authPasswordMismatch : undefined}
        >
          <PasswordField
            id="reset-confirm"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton busy={busy}>{t.authResetStepPassword}</PrimaryButton>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setStep(2);
          }}
          className="flex w-full items-center justify-center gap-1 text-xs text-neutral-600 underline"
        >
          <ArrowLeft className="size-3" aria-hidden />
          {t.authResetStepCode}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="space-y-4" noValidate>
      <h2 className="text-sm font-bold text-black">{t.authResetStepCode}</h2>
      <p className="text-xs leading-relaxed text-neutral-600">
        {t.authResetSent} {t.authCodeSentCheck}
      </p>
      <CodeField id="reset-code" value={code} onChange={setCode} label={t.authResetStepCode} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <PrimaryButton busy={busy}>{t.authVerify}</PrimaryButton>
      <button
        type="button"
        onClick={resend}
        disabled={busy || secondsLeft > 0}
        className="tap-target w-full rounded-lg border border-[#e3e8e5] text-sm text-neutral-700 disabled:opacity-60"
      >
        {secondsLeft > 0
          ? interpolate(t.authResendIn, { seconds: secondsLeft })
          : t.authResendCode}
      </button>
      <BackToSignIn onCancel={onCancel} />
    </form>
  );
}

function BackToSignIn({ onCancel }: { onCancel: () => void }) {
  const { t } = useLang();
  return (
    <button
      type="button"
      onClick={onCancel}
      className="flex w-full items-center justify-center gap-1 text-xs text-neutral-600 underline"
    >
      <ArrowLeft className="size-3" aria-hidden />
      {t.authBackToSignIn}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Role picker (shown after verification, when no role was chosen at sign-up)
// ---------------------------------------------------------------------------

function RolePicker({
  onPick,
  onCancel,
}: {
  onPick: (step: "wholesaler" | "retailer") => void;
  onCancel: () => void;
}) {
  const { t } = useLang();

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <RoleCard
          icon={Store}
          title={t.roleWholesaler}
          description={t.roleWholesalerDesc}
          onClick={() => onPick("wholesaler")}
        />
        <RoleCard
          icon={ShoppingBag}
          title={t.roleRetailer}
          description={t.roleRetailerDesc}
          onClick={() => onPick("retailer")}
        />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="flex w-full items-center justify-center gap-1 text-xs text-neutral-600 underline"
      >
        <ArrowLeft className="size-3" aria-hidden />
        {t.navLogout}
      </button>
    </div>
  );
}

function RoleCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Store;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap-target flex h-full w-full flex-col items-center gap-1.5 rounded-lg border border-[#e3e8e5] p-4 text-center transition-colors hover:border-[#006233]"
    >
      <Icon className="size-5 shrink-0 text-[#006233]" aria-hidden />
      <span className="block text-balance text-sm font-semibold leading-tight text-black line-clamp-2">
        {title}
      </span>
      <span className="block text-xs text-neutral-600">{description}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Wholesaler onboarding
// ---------------------------------------------------------------------------

function WholesalerForm({ onDone }: { onDone: () => void }) {
  const { t, lang } = useLang();
  const complete = useMutation(api.wholesaler.completeWholesalerOnboarding);

  const [form, setForm] = useState({
    shopName: "",
    ownerName: "",
    wilaya: WILAYAS[15].code,
    commune: "",
    whatsapp: "",
    address: "",
    rcNumber: "",
    avgPrepDays: 2,
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [delivery, setDelivery] = useState<string[]>(["pickup"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await complete({
        shopName: form.shopName,
        ownerName: form.ownerName,
        wilaya: form.wilaya,
        commune: form.commune || undefined,
        whatsapp: form.whatsapp,
        address: form.address || undefined,
        rcNumber: form.rcNumber || undefined,
        avgPrepDays: form.avgPrepDays,
        categories: categories.length ? categories : ["other"],
        deliveryOptions: delivery.length ? delivery : ["pickup"],
      });
      toast.success(t.navDashboard);
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "alreadyOnboarded") {
        onDone();
      } else if (message === "errInvalidPhone") {
        setError(t.errInvalidPhone);
      } else if (message === "errRequired") {
        setError(t.errRequired);
      } else {
        setError(t.errGeneric);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-base font-bold text-black">{t.roleWholesaler}</h2>

      <Field label={t.shopName}>
        <input
          required
          value={form.shopName}
          onChange={(e) => setForm({ ...form, shopName: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label={t.ownerName}>
        <input
          required
          value={form.ownerName}
          onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label={t.filterWilaya}>
        <select
          className={inputClass}
          value={form.wilaya}
          onChange={(e) => setForm({ ...form, wilaya: Number(e.target.value) })}
        >
          {WILAYAS.map((w) => (
            <option key={w.code} value={w.code}>
              {lang === "ar" ? w.ar : w.fr}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t.commune}>
        <input
          value={form.commune}
          onChange={(e) => setForm({ ...form, commune: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label={t.whatsapp} hint={t.whatsappHint}>
        <input
          required
          type="tel"
          dir="ltr"
          inputMode="tel"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          className={`${inputClass} text-start`}
        />
      </Field>

      <Field label={t.shopAddress}>
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label={t.rcNumber}>
        <input
          dir="ltr"
          value={form.rcNumber}
          onChange={(e) => setForm({ ...form, rcNumber: e.target.value })}
          className={`${inputClass} text-start`}
        />
      </Field>

      <Field label={t.avgPrepTime}>
        <input
          type="number"
          min={0}
          max={30}
          value={form.avgPrepDays}
          onChange={(e) => setForm({ ...form, avgPrepDays: Number(e.target.value) })}
          className={inputClass}
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-neutral-700">
          {t.categoriesSold}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORIES.map((category) => (
            <label key={category.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={categories.includes(category.key)}
                onChange={() => toggle(categories, setCategories, category.key)}
              />
              {lang === "ar" ? category.ar : category.fr}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-neutral-700">
          {t.deliveryOptions}
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DELIVERY_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={delivery.includes(option.key)}
                onChange={() => toggle(delivery, setDelivery, option.key)}
              />
              {lang === "ar" ? option.ar : option.fr}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <ErrorNote>{error}</ErrorNote>}

      <PrimaryButton busy={busy}>{t.save}</PrimaryButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Retailer onboarding
// ---------------------------------------------------------------------------

function RetailerForm({ onDone }: { onDone: () => void }) {
  const { t, lang } = useLang();
  const complete = useMutation(api.wholesaler.completeRetailerOnboarding);

  const [form, setForm] = useState({
    name: "",
    wilaya: WILAYAS[15].code,
    whatsapp: "",
    storeType: "facebook",
    storeLink: "",
  });
  const [niches, setNiches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await complete({
        name: form.name,
        wilaya: form.wilaya,
        whatsapp: form.whatsapp,
        storeType: form.storeType,
        storeLink: form.storeLink || undefined,
        niches,
      });
      toast.success(lang === "ar" ? "أهلاً بيك!" : "Bienvenue !");
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "errInvalidPhone") setError(t.errInvalidPhone);
      else if (message === "errRequired") setError(t.errRequired);
      else setError(t.errGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-base font-bold text-black">{t.roleRetailer}</h2>

      <Field label={lang === "ar" ? "الاسم" : "Nom"}>
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label={t.filterWilaya}>
        <select
          className={inputClass}
          value={form.wilaya}
          onChange={(e) => setForm({ ...form, wilaya: Number(e.target.value) })}
        >
          {WILAYAS.map((w) => (
            <option key={w.code} value={w.code}>
              {lang === "ar" ? w.ar : w.fr}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t.whatsapp} hint={t.whatsappHint}>
        <input
          required
          type="tel"
          dir="ltr"
          inputMode="tel"
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          className={`${inputClass} text-start`}
        />
      </Field>

      <Field label={t.storeType}>
        <select
          className={inputClass}
          value={form.storeType}
          onChange={(e) => setForm({ ...form, storeType: e.target.value })}
        >
          {STORE_TYPES.map((type) => (
            <option key={type.key} value={type.key}>
              {lang === "ar" ? type.ar : type.fr}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t.storeLink}>
        <input
          dir="ltr"
          value={form.storeLink}
          onChange={(e) => setForm({ ...form, storeLink: e.target.value })}
          className={`${inputClass} text-start`}
        />
      </Field>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-neutral-700">{t.niches}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORIES.map((category) => (
            <label key={category.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={niches.includes(category.key)}
                onChange={() =>
                  setNiches(
                    niches.includes(category.key)
                      ? niches.filter((v) => v !== category.key)
                      : [...niches, category.key],
                  )
                }
              />
              {lang === "ar" ? category.ar : category.fr}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <ErrorNote>{error}</ErrorNote>}

      <PrimaryButton busy={busy}>{t.save}</PrimaryButton>
    </form>
  );
}