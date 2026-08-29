/**
 * Client hook that resolves the current session server-side and exposes the
 * result to components that must be role-aware (the header, and the owner
 * login/register pages which redirect an already-authenticated owner away from
 * the form).
 *
 * Security: the role + shop slug come from the server (getSessionUser /
 * getOwnerShop resolve the opaque token in Postgres), never from localStorage
 * alone. A stale/invalid token degrades to "guest".
 */
import { useEffect, useState } from "react";
import { getSessionUser } from "~/db/auth";
import { getOwnerShop } from "~/db/server";
import { clearSessionToken, getSessionToken } from "~/lib/session";

export type SessionState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "customer"; email: string; name: string | null }
  | {
      status: "owner";
      name: string | null;
      /** shop id (may be null if the owner somehow has no shop yet) */
      shopId: number | null;
      /** verified shop slug — null when the owner has no shop (edge) */
      slug: string | null;
    };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      const token = getSessionToken();
      if (!token) {
        if (active) setState({ status: "guest" });
        return;
      }
      const user = await getSessionUser({ data: token });
      if (!active) return;
      if (!user) {
        clearSessionToken();
        setState({ status: "guest" });
        return;
      }
      if (user.role === "owner") {
        // Owner — resolve their real shop slug (server-verified). Returns null
        // for an owner that somehow has no shop yet (rare edge).
        const shop = await getOwnerShop({ data: token });
        if (!active) return;
        setState({
          status: "owner",
          name: user.name,
          shopId: user.shopId ?? null,
          slug: shop ? shop.slug : null,
        });
        return;
      }
      setState({ status: "customer", email: user.email, name: user.name });
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
