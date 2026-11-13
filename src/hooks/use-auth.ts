import { useEffect, useState, useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  SUPER_ADMIN_EMAILS,
  getExtraAdmins,
  saveExtraAdmin,
  removeExtraAdmin,
  isPlatformAdmin,
  localGetSessionUser,
  localSignInWithProvider,
  localSignOut,
} from "@/lib/localConvexClient";

export {
  SUPER_ADMIN_EMAILS,
  getExtraAdmins,
  saveExtraAdmin,
  removeExtraAdmin,
  isPlatformAdmin,
};

export interface AppAuthUser {
  _id?: string;
  _creationTime?: number;
  email?: string;
  name?: string;
  role?: "admin" | "wholesaler" | "retailer" | string;
  onboardedAt?: number;
  emailVerificationTime?: number;
  wilaya?: number;
  commune?: string;
  whatsappE164?: string;
  storeType?: string;
  /** Trade name shown beside the account icon on the wholesaler dashboard. */
  ownerName?: string;
  /** Niche keys a retailer picked at sign-up, mirrored from the users row. */
  niches?: string[];
  isVerified?: boolean;
}

const isRemoteConvex = Boolean(
  (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim(),
);

function useRemoteAuth() {
  const { isLoading: isConvexLoading, isAuthenticated: isConvexAuthenticated } =
    useConvexAuth();
  const convexUser = useQuery(api.users.currentUser);
  const authActions = useAuthActions();

  let activeUser = (convexUser as AppAuthUser | undefined) ?? null;
  if (activeUser && isPlatformAdmin(activeUser.email) && activeUser.role !== "admin") {
    activeUser = { ...activeUser, role: "admin" };
  }

  const rawSignIn = authActions?.signIn;
  const rawSignOut = authActions?.signOut;

  const signIn = useCallback(
    async (provider: string, params: Record<string, unknown>) => {
      if (!rawSignIn) {
        throw new Error("errNotAuthorized");
      }
      return await rawSignIn(
        provider,
        params as Parameters<NonNullable<typeof authActions>["signIn"]>[1],
      );
    },
    [rawSignIn],
  );

  const signOut = useCallback(async () => {
    await rawSignOut?.();
  }, [rawSignOut]);

  return {
    isLoading: isConvexLoading,
    isAuthenticated: isConvexAuthenticated,
    user: activeUser,
    signIn,
    signOut,
    isSuperAdmin: SUPER_ADMIN_EMAILS.includes(
      (activeUser?.email || "").toLowerCase().trim(),
    ),
  };
}

function useLocalAuth() {
  const convexUser = useQuery(api.users.currentUser);

  const [localUser, setLocalUser] = useState<AppAuthUser | null>(() =>
    localGetSessionUser() as AppAuthUser | null,
  );

  useEffect(() => {
    const syncLocalUser = () => {
      setLocalUser(localGetSessionUser() as AppAuthUser | null);
    };
    window.addEventListener("storage", syncLocalUser);
    window.addEventListener("tajirdz:auth-change", syncLocalUser);
    return () => {
      window.removeEventListener("storage", syncLocalUser);
      window.removeEventListener("tajirdz:auth-change", syncLocalUser);
    };
  }, []);

  let activeUser = (convexUser as AppAuthUser | undefined) ?? localUser;
  if (activeUser && isPlatformAdmin(activeUser.email) && activeUser.role !== "admin") {
    activeUser = { ...activeUser, role: "admin" };
  }

  const signIn = useCallback(
    async (provider: string, params: Record<string, unknown>) => {
      const res = await localSignInWithProvider(provider, params);
      setLocalUser(localGetSessionUser() as AppAuthUser | null);
      if (res.demoCode) {
        toast.info(`رمز التحقق / Code: ${res.demoCode}`);
      }
      return { signingIn: res.signingIn };
    },
    [],
  );

  const signOut = useCallback(async () => {
    localSignOut();
    setLocalUser(null);
  }, []);

  return {
    isLoading: false,
    isAuthenticated: Boolean(localUser),
    user: activeUser,
    signIn,
    signOut,
    isSuperAdmin: SUPER_ADMIN_EMAILS.includes(
      (activeUser?.email || "").toLowerCase().trim(),
    ),
  };
}

export const useAuth = isRemoteConvex ? useRemoteAuth : useLocalAuth;
