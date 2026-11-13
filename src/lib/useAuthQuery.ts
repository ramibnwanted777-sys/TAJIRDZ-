/**
 * Auth-aware wrapper around Convex `useQuery`.
 *
 * Convex's `useQuery` rejects when the query throws, and an authenticated query
 * throws `errNotSignedIn` for a signed-out caller. Because the provider tree is
 * shared, that rejection took down the whole page — including the landing page,
 * whose header renders an unread-count badge.
 *
 * Every read of signed-in data must go through this hook instead of `useQuery`
 * directly. It resolves to `undefined` (the "loading" value) until there is a
 * session, so the caller renders its skeleton or empty state rather than
 * crashing. Mutations are unaffected: they still throw, which is correct.
 */

import { useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference } from "convex/server";

import { useAuth } from "@/hooks/use-auth";

/**
 * `useQuery` for data that only exists for a signed-in user.
 *
 * Returns `undefined` while auth is loading, when signed out, or while the
 * query itself is still loading — so the usual
 * `if (data === undefined) return <Skeleton />` guard covers all three cases.
 *
 * `useQuery` is called exactly once per render on both branches. Conditionally
 * calling it would break the rules of hooks, because `useQuery` is a
 * subscription and the hook order has to be stable across renders; the
 * difference between the two paths is only which value is handed to it.
 */
export function useAuthQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): Query["_returnType"] | undefined {
  const { isLoading, isAuthenticated } = useAuth();

  // Suspense the request entirely until we know who the caller is, so a
  // signed-out visitor never fires an authenticated query.
  const shouldSkip = isLoading || !isAuthenticated;

  return useQuery(
    query,
    // The tuple/array distinction is preserved by spreading on the live branch;
    // the cast only applies to the inert "skip" branch.
    ...(shouldSkip
      ? (["skip"] as unknown as OptionalRestArgsOrSkip<Query>)
      : args),
  );
}
