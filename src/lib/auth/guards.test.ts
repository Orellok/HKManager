import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  fetchIsAllowedUser: vi.fn(),
  fetchIsAdmin: vi.fn(),
}));

// next/navigation's redirect() and notFound() throw to stop rendering; mirror that.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("./roles", () => ({
  fetchIsAllowedUser: mocks.fetchIsAllowedUser,
  fetchIsAdmin: mocks.fetchIsAdmin,
}));

const { notFound, redirect } = await import("next/navigation");
const { getUserAccess, requireAdmin, requireAllowedUser } = await import("./guards");

const USER = { id: "user-1", email: "person@hkmanager.test" };

function signedIn() {
  mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
}

function signedOut() {
  mocks.getUser.mockResolvedValue({
    data: { user: null },
    error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAllowedUser", () => {
  it("AUTH-3: without a verified session it redirects to /login", async () => {
    signedOut();

    await expect(requireAllowedUser()).rejects.toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(mocks.fetchIsAllowedUser).not.toHaveBeenCalled();
  });

  it("AUTH-3: an auth error with a user payload still counts as signed out", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: USER },
      error: { name: "AuthApiError", message: "invalid JWT" },
    });

    await expect(requireAllowedUser()).rejects.toThrow("redirect:/login");
  });

  it("AUTH-2: an account outside the allowlist is redirected to /unauthorized", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(false);

    await expect(requireAllowedUser()).rejects.toThrow("redirect:/unauthorized");
    expect(redirect).toHaveBeenCalledWith("/unauthorized");
  });

  it("AUTH-2: an allowlisted account gets its user back", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(true);

    await expect(requireAllowedUser()).resolves.toEqual(USER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("AUTH-2: a failing allowlist check propagates instead of allowing", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockRejectedValue(new Error("Could not check is_allowed_user"));

    await expect(requireAllowedUser()).rejects.toThrow("Could not check is_allowed_user");
  });
});

describe("requireAdmin", () => {
  it("AUTH-5: an owner (allowlisted, not admin) gets notFound()", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(true);
    mocks.fetchIsAdmin.mockResolvedValue(false);

    await expect(requireAdmin()).rejects.toThrow("notFound");
    expect(notFound).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("AUTH-5: an admin gets its user back", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(true);
    mocks.fetchIsAdmin.mockResolvedValue(true);

    await expect(requireAdmin()).resolves.toEqual(USER);
    expect(notFound).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("AUTH-5: without a verified session it redirects to /login", async () => {
    signedOut();

    await expect(requireAdmin()).rejects.toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("AUTH-5: an account outside the allowlist is redirected to /unauthorized, not 404", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(false);
    mocks.fetchIsAdmin.mockResolvedValue(false);

    await expect(requireAdmin()).rejects.toThrow("redirect:/unauthorized");
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("getUserAccess", () => {
  it("AUTH-3: no verified session decides login, without asking the allowlist", async () => {
    signedOut();

    await expect(getUserAccess()).resolves.toEqual({ user: null, decision: "login" });
    expect(mocks.fetchIsAllowedUser).not.toHaveBeenCalled();
  });

  it("AUTH-2: a session outside the allowlist decides unauthorized", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(false);

    await expect(getUserAccess()).resolves.toEqual({ user: USER, decision: "unauthorized" });
  });

  it("AUTH-2: an allowlisted session decides allow, and never redirects by itself", async () => {
    signedIn();
    mocks.fetchIsAllowedUser.mockResolvedValue(true);

    await expect(getUserAccess()).resolves.toEqual({ user: USER, decision: "allow" });
    expect(redirect).not.toHaveBeenCalled();
  });
});
