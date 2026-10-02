import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AUTH_LIMIT, peekRateLimit, rateLimit, resetRateLimits } from "@/server/rate-limit";
import {
  changePasswordAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
} from "./auth";

/**
 * Auth rate-limiting contract.
 *
 * A real user hit "Too many attempts" and could not create an account. The
 * lesson these tests pin down is that three different limiters can produce
 * that feeling, and only one of them is ours:
 *
 *   A. BidBlitz's own failure-only budget (`authFailureKey`), 5 per minute,
 *   B. Supabase Auth / GoTrue — send quotas, burst limits, HTTP 429,
 *   C. duplicate submissions from a button that stayed enabled.
 *
 * Each test asserts one rule that keeps those from compounding:
 * success never spends budget, a provider throttle never spends our budget,
 * our own block says so in its own words, and the window really does clear.
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    const err = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    err.digest = "NEXT_REDIRECT;307;/";
    throw err;
  }),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.9" })),
}));

const IP = "203.0.113.9";
const EMAIL = "New.User@Example.com";

/** The exact key `authFailureKey` derives for EMAIL — IP then email, lowercased. */
const KEY = `auth:${IP}:${EMAIL.toLowerCase()}`;

type ProviderError = { message: string; status?: number } | null;

let signInError: ProviderError = null;
let signUpError: ProviderError = null;
/** GoTrue's signup payload: auto-confirm off ⇒ session null, user present. */
let signUpData: { session: unknown; user: unknown } = { session: null, user: { id: "u-1" } };
let sessionUser: { id: string } | null = { id: "u-1" };
let updateUserError: ProviderError = null;
let resendError: ProviderError = null;

function mockSupabase() {
  vi.mocked(createClient).mockResolvedValue({
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: signInError ? {} : { user: { id: "u-1" }, session: { access_token: "t" } },
        error: signInError,
      })),
      signUp: vi.fn(async () => ({ data: signUpData, error: signUpError })),
      getUser: vi.fn(async () => ({ data: { user: sessionUser }, error: null })),
      updateUser: vi.fn(async () => ({
        data: updateUserError ? {} : { user: sessionUser },
        error: updateUserError,
      })),
      resend: vi.fn(async () => ({
        data: resendError ? {} : { user: { id: "u-1" }, session: null },
        error: resendError,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

function budget() {
  return peekRateLimit(KEY, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
}

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
  signInError = null;
  signUpError = null;
  signUpData = { session: null, user: { id: "u-1" } };
  sessionUser = { id: "u-1" };
  updateUserError = null;
  resendError = null;

  mockSupabase();
});

afterEach(() => {
  resetRateLimits();
});

describe("signUpAction", () => {
  it("a fresh signup succeeds and spends none of the failure budget", async () => {
    const result = await signUpAction({
      email: EMAIL,
      password: "longenough",
      displayName: "New User",
    });

    expect(result).toEqual({ ok: true });
    // Full budget after success: nothing failed, so nothing was recorded.
    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
  });

  it("reports a provider rate limit in its own words and never spends our budget", async () => {
    signUpError = { message: "Over email send rate limit", status: 429 };

    // Far past AUTH_LIMIT: if a GoTrue throttle also counted as a BidBlitz
    // failure, the sixth attempt here would already be blocked by us.
    for (let i = 0; i < AUTH_LIMIT.limit * 3; i += 1) {
      const result = await signUpAction({
        email: EMAIL,
        password: "longenough",
        displayName: "New User",
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.rejection.code).toBe("rate_limited");
      expect(result.rejection.message).toMatch(/rate-limiting requests/i);
      // Ours, not theirs: the local block must never be mislabelled as this.
      expect(result.rejection.message).not.toMatch(/from this device/i);
    }

    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
  });

  it("keeps 'already registered' distinct from a rate limit", async () => {
    signUpError = { message: "User already registered" };

    const result = await signUpAction({
      email: EMAIL,
      password: "longenough",
      displayName: "New User",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_state");
    expect(result.rejection.message).toMatch(/already registered/i);
    expect(result.rejection.message).not.toMatch(/too many|rate.?limit/i);
    // A genuine rejection still spends budget — that is what caps enumeration.
    expect(budget().remaining).toBe(AUTH_LIMIT.limit - 1);
  });

  it("never says 'Sign in failed' for a signup failure", async () => {
    // The provider's send failure is the live case: Resend in testing mode
    // makes signUp() fail with a generic 500 here. Whatever the provider
    // says, the signup form must speak signup.
    signUpError = { message: "Error sending confirmation email", status: 500 };

    const result = await signUpAction({
      email: EMAIL,
      password: "longenough",
      displayName: "New User",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("unknown");
    expect(result.rejection.message).toBe("Account creation failed. Please try again.");
    expect(result.rejection.message).not.toMatch(/sign in failed/i);
  });

  it("rejects an invalid email address with an address error, not a signup error", async () => {
    signUpError = { message: "Email address foo@bar.test is invalid" };

    const result = await signUpAction({
      email: EMAIL,
      password: "longenough",
      displayName: "New User",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.message).toBe("Enter a valid email address.");
    expect(result.rejection.message).not.toMatch(/sign in failed/i);
  });

  it("gives invalid password feedback without contacting the provider", async () => {
    signUpError = { message: "Password should be at least 6 characters" };

    const result = await signUpAction({
      email: EMAIL,
      password: "short",
      displayName: "New User",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.message).toBe("Password must be at least 8 characters.");
    expect(budget().remaining).toBe(AUTH_LIMIT.limit - 1);
  });

  it("speaks in its own words once OUR budget is gone, and does not call the provider", async () => {
    for (let i = 0; i < AUTH_LIMIT.limit; i += 1) {
      rateLimit(KEY, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
    }
    vi.mocked(createClient).mockClear();

    const result = await signUpAction({
      email: EMAIL,
      password: "longenough",
      displayName: "New User",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("rate_limited");
    expect(result.rejection.message).toMatch(/too many attempts from this device/i);
    expect(result.rejection.message).not.toMatch(/rate-limiting requests/i);
    // Blocked before the network: no pointless request, no extra provider quota.
    expect(createClient).not.toHaveBeenCalled();
  });

  it("account creation works again once the rate window has cleared", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < AUTH_LIMIT.limit; i += 1) {
        rateLimit(KEY, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
      }
      expect((await signUpAction({ email: EMAIL, password: "longenough", displayName: "N" })).ok).toBe(
        false
      );

      vi.advanceTimersByTime(AUTH_LIMIT.windowMs + 1_000);

      const after = await signUpAction({
        email: EMAIL,
        password: "longenough",
        displayName: "New User",
      });
      expect(after).toEqual({ ok: true });
      expect(budget().remaining).toBe(AUTH_LIMIT.limit);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("signInAction", () => {
  it("never throttles ordinary successful sign-ins", async () => {
    for (let i = 0; i < AUTH_LIMIT.limit * 3; i += 1) {
      // Success ends in `redirect()`, which the mock throws.
      await expect(
        signInAction({ email: EMAIL, password: "longenough", redirectTo: "/dashboard" })
      ).rejects.toThrow("NEXT_REDIRECT");
    }

    expect(vi.mocked(redirect)).toHaveBeenCalledTimes(AUTH_LIMIT.limit * 3);
    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
  });

  it("throttles repeated failures and says so with the local message", async () => {
    signInError = { message: "Invalid login credentials" };

    for (let i = 0; i < AUTH_LIMIT.limit; i += 1) {
      const result = await signInAction({ email: EMAIL, password: "wrong-wrong" });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.rejection.message).toBe("Email or password is incorrect.");
    }

    vi.mocked(createClient).mockClear();
    const blocked = await signInAction({ email: EMAIL, password: "wrong-wrong" });

    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.rejection.message).toMatch(/too many attempts from this device/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does not recursively spend our budget on a provider rate limit", async () => {
    signInError = { message: "Too many requests", status: 429 };

    for (let i = 0; i < AUTH_LIMIT.limit * 4; i += 1) {
      const result = await signInAction({ email: EMAIL, password: "whatever" });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.rejection.code).toBe("rate_limited");
      expect(result.rejection.message).toMatch(/rate-limiting requests/i);
    }

    // The provider's cooldown must not have silently become ours: once GoTrue
    // calms down, the very next sign-in goes through.
    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
    signInError = null;
    await expect(
      signInAction({ email: EMAIL, password: "longenough", redirectTo: "/" })
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  it("reports bad credentials without spending a whole window on one typo", async () => {
    signInError = { message: "Invalid login credentials" };

    const result = await signInAction({ email: EMAIL, password: "oops" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.message).toBe("Email or password is incorrect.");
    expect(budget().remaining).toBe(AUTH_LIMIT.limit - 1);
  });
});

describe("resendConfirmationAction", () => {
  it("answers the same generic success for a known address", async () => {
    const result = await resendConfirmationAction({ email: EMAIL });
    expect(result).toEqual({ ok: true });
    // A resend is not a failed attempt: our own budget stays untouched.
    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
  });

  it("answers the identical success when the provider send fails (enumeration safety)", async () => {
    // Unknown address, already-confirmed address, Resend testing-mode 500 —
    // every provider answer must be observationally identical to success.
    resendError = { message: "Error sending confirmation email", status: 500 };

    const failed = await resendConfirmationAction({ email: EMAIL });
    expect(failed).toEqual({ ok: true });

    resendError = null;
    const succeeded = await resendConfirmationAction({ email: EMAIL });
    expect(succeeded).toEqual(failed);
    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
  });

  it("still reports our own budget honestly without contacting the provider", async () => {
    for (let i = 0; i < AUTH_LIMIT.limit; i += 1) {
      rateLimit(KEY, AUTH_LIMIT.limit, AUTH_LIMIT.windowMs);
    }
    vi.mocked(createClient).mockClear();

    const result = await resendConfirmationAction({ email: EMAIL });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("rate_limited");
    expect(result.rejection.message).toMatch(/too many attempts from this device/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("treats a provider throttle as a delayed email, not a failure or a budget hit", async () => {
    resendError = { message: "For security purposes, please try again later", status: 429 };

    const result = await resendConfirmationAction({ email: EMAIL });

    expect(result).toEqual({ ok: true });
    expect(budget().remaining).toBe(AUTH_LIMIT.limit);
  });

  it("refuses an empty address before contacting the provider", async () => {
    const result = await resendConfirmationAction({ email: "   " });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("invalid_input");
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("updatePasswordAction (recovery)", () => {
  it("refuses a short password before contacting the provider", async () => {
    const result = await updatePasswordAction({ password: "short" });
    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "invalid_input",
        message: "Password must be at least 8 characters.",
      },
    });
  });

  it("refuses without a session and names the dead link, not a typo", async () => {
    sessionUser = null;
    mockSupabase();

    const result = await updatePasswordAction({ password: "a-brand-new-password" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("reset_link_invalid");
  });

  it("updates the password for the recovery session's own user", async () => {
    const result = await updatePasswordAction({ password: "a-brand-new-password" });
    expect(result).toEqual({ ok: true });
  });
});

describe("changePasswordAction (authenticated)", () => {
  it("refuses a short password before contacting the provider", async () => {
    const result = await changePasswordAction({ password: "short" });
    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "invalid_input",
        message: "Password must be at least 8 characters.",
      },
    });
  });

  it("asks for a sign-in when there is no session — never a reset link", async () => {
    sessionUser = null;
    mockSupabase();

    const result = await changePasswordAction({ password: "a-brand-new-password" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.code).toBe("not_authenticated");
    expect(result.rejection.message).toMatch(/sign in again/i);
  });

  it("changes the password for the signed-in user", async () => {
    const result = await changePasswordAction({ password: "a-brand-new-password" });
    expect(result).toEqual({ ok: true });
  });
});
