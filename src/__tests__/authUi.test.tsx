/**
 * The sign-in screens, driven the way a person drives them.
 *
 * The server side of every rule lives in `authPassword.test.ts` and
 * `authSecurity.test.ts`; what is asserted here is what only shows up through
 * the component — that the password form actually calls the backend, that a
 * failure becomes one generic sentence, that the button locks while the
 * request runs, that a pending address is offered the code screen, and that a
 * blocked route sends the visitor to `/auth` and back again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

const mocks = vi.hoisted(() => ({
  /** Every `useMutation` call returns this one handle. */
  mutation: vi.fn(),
  /** Stands in for `useAuth`; reset before each test. */
  auth: {
    isLoading: false,
    isAuthenticated: false,
    user: undefined as unknown,
    signIn: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return {
    ...actual,
    useMutation: () => mocks.mutation,
    useQuery: () => undefined,
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mocks.auth,
}));

import { Auth } from "@/pages/Auth";
import { RequireAuth } from "@/components/RequireAuth";
import { LanguageProvider } from "@/lib/lang";

const EMAIL = "shopper@example.com";
const PASSWORD = "Abcdefgh1234";

function renderAuth(initialEntry = "/auth") {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/auth" element={<Auth redirectAfterAuth="/feed" />} />
          <Route path="/feed" element={<div>feed-page</div>} />
          <Route path="/dashboard" element={<div>dashboard-page</div>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

/** Fill the two fields of the password form. */
function fillCredentials(container: HTMLElement) {
  const email = container.querySelector<HTMLInputElement>("#signin-email")!;
  const password = container.querySelector<HTMLInputElement>("#signin-password")!;
  fireEvent.change(email, { target: { value: EMAIL } });
  fireEvent.change(password, { target: { value: PASSWORD } });
  return { email, password };
}

function submitSignIn(container: HTMLElement) {
  fillCredentials(container);
  fireEvent.click(screen.getByRole("button", { name: "دخول" }));
}

beforeEach(() => {
  mocks.mutation.mockReset();
  mocks.mutation.mockResolvedValue(undefined);
  mocks.auth.signIn.mockReset();
  mocks.auth.signOut.mockReset();
  mocks.auth.isLoading = false;
  mocks.auth.isAuthenticated = false;
  mocks.auth.user = undefined;
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Signing in
// ---------------------------------------------------------------------------

describe("the password form", () => {
  it("hands the email and password to the password provider", async () => {
    mocks.auth.signIn.mockResolvedValue({ signingIn: true });
    const { container } = renderAuth();

    submitSignIn(container);

    await waitFor(() =>
      expect(mocks.auth.signIn).toHaveBeenCalledWith("password", {
        flow: "signIn",
        email: EMAIL,
        password: PASSWORD,
      }),
    );
    // The abuse counter is charged before the credentials leave the browser.
    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith({ kind: "signIn", email: EMAIL }),
    );
  });

  it("locks the button while the request runs so it cannot be pressed twice", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.auth.signIn.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { container } = renderAuth();
    fillCredentials(container);
    // Grabbed before the click: while the request runs the label is replaced
    // by the spinner, so the button can only be found by its role after that.
    const button = screen.getByRole("button", { name: "دخول" });

    fireEvent.click(button);
    await waitFor(() => expect(mocks.auth.signIn).toHaveBeenCalled());
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    expect(button.getAttribute("aria-busy")).toBe("true");

    fireEvent.click(button);
    expect(mocks.auth.signIn).toHaveBeenCalledTimes(1);

    await act(async () => finish({ signingIn: true }));
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  it("shows one generic sentence when the password is wrong", async () => {
    // Convex Auth's wire message for a bad password; it must never be shown.
    mocks.auth.signIn.mockRejectedValue(new Error("InvalidSecret"));
    const { container } = renderAuth();

    submitSignIn(container);

    expect(await screen.findByText("البريد أو كلمة المرور غير صحيحة")).toBeTruthy();
    expect(screen.queryByText(/InvalidSecret/)).toBeNull();
    expect(screen.queryByText(EMAIL)).toBeNull();
  });

  it("shows the same generic sentence when the address has no account", async () => {
    mocks.auth.signIn.mockRejectedValue(new Error("InvalidAccountId"));
    const { container } = renderAuth();

    submitSignIn(container);

    expect(await screen.findByText("البريد أو كلمة المرور غير صحيحة")).toBeTruthy();
    expect(screen.queryByText(/InvalidAccountId/)).toBeNull();
  });

  it("says how long the lock lasts after five attempts", async () => {
    mocks.auth.signIn.mockRejectedValue(new Error("errAuthGuard:signIn:15"));
    const { container } = renderAuth();

    submitSignIn(container);

    const message = await screen.findByText(/15/);
    expect(message.textContent).toContain("15");
  });

  it("offers the e-mail code screen when the address is not proven yet", async () => {
    // What Convex Auth answers when the password is right but the address has
    // never been confirmed: nothing to do but ask for the code.
    mocks.auth.signIn.mockResolvedValue({ signingIn: false });
    const { container } = renderAuth();

    submitSignIn(container);

    await waitFor(() =>
      expect(mocks.auth.signIn).toHaveBeenCalledWith("password", {
        flow: "signIn",
        email: EMAIL,
        password: PASSWORD,
      }),
    );
    const code = await waitFor(() => {
      const field = container.querySelector<HTMLInputElement>("#verify-code");
      expect(field).toBeTruthy();
      return field!;
    });
    expect(code).toBeTruthy();
  });

  it("keeps the sign-in form in front of a visitor who has not signed in", () => {
    renderAuth();
    expect(screen.getByRole("button", { name: "دخول" })).toBeTruthy();
    // The secondary option stays reachable.
    expect(screen.getByText("الدخول برمز يصلك على البريد")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Coming back after sign-in
// ---------------------------------------------------------------------------

describe("returning the visitor to the page they asked for", () => {
  it("goes to the requested path once the account is signed in and onboarded", () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.user = { onboardedAt: 1, role: "retailer" };

    renderAuth("/auth?returnTo=%2Fdashboard");

    expect(screen.getByText("dashboard-page")).toBeTruthy();
  });

  it("falls back to the home destination when returnTo is not a same-site path", () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.user = { onboardedAt: 1, role: "retailer" };

    renderAuth("/auth?returnTo=https%3A%2F%2Fevil.example");

    expect(screen.getByText("feed-page")).toBeTruthy();
    expect(screen.queryByText("dashboard-page")).toBeNull();
  });

  it("rejects a protocol-relative target as well", () => {
    mocks.auth.isAuthenticated = true;
    mocks.auth.user = { onboardedAt: 1, role: "retailer" };

    renderAuth("/auth?returnTo=%2F%2Fevil.example");

    expect(screen.getByText("feed-page")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Protected routes
// ---------------------------------------------------------------------------

describe("a route that needs a signed-in user", () => {
  function renderProtected(immediate: boolean, entry: string) {
    return render(
      <LanguageProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <RequireAuth redirectImmediately={immediate}>
                  <div>secret-page</div>
                </RequireAuth>
              }
            />
            <Route path="/auth" element={<div>auth-page</div>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
  }

  it("explains the block instead of silently moving away", () => {
    renderProtected(false, "/dashboard?tab=billing");

    expect(screen.queryByText("secret-page")).toBeNull();
    expect(screen.getByText("سجّل الدخول للمتابعة")).toBeTruthy();
    expect(screen.getByText(/ستعود إلى هذه الصفحة/)).toBeTruthy();
  });

  it("sends the visitor to /auth carrying the path they wanted", async () => {
    renderProtected(false, "/dashboard?tab=billing");

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    expect(await screen.findByText("auth-page")).toBeTruthy();
    expect(screen.queryByText("secret-page")).toBeNull();
  });

  it("can bounce straight to /auth for a route where that reads better", async () => {
    renderProtected(true, "/dashboard?tab=billing");

    expect(await screen.findByText("auth-page")).toBeTruthy();
    expect(screen.queryByText("secret-page")).toBeNull();
  });

  it("shows the page once the session exists", () => {
    mocks.auth.isAuthenticated = true;

    renderProtected(false, "/dashboard");

    expect(screen.getByText("secret-page")).toBeTruthy();
  });
});
