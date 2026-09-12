/**
 * Client hook that resolves the current ADMIN session server-side (separate
 * from useSession's customer/owner path). Role + email come from the server
 * (getAdminSession resolves the opaque token against arvo.admins in Postgres),
 * never from localStorage alone. A stale/invalid admin token degrades to
 * "guest" and is cleared.
 */
import { useEffect, useState } from "react";
import type { AdminRole } from "~/db/admin";
import { getAdminSession } from "~/db/admin";
import { clearAdminToken, getAdminToken } from "~/lib/adminSession";

export type AdminSessionState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "admin"; role: AdminRole; email: string };

export function useAdminSession(): AdminSessionState {
  const [state, setState] = useState<AdminSessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      const token = getAdminToken();
      if (!token) {
        if (active) setState({ status: "guest" });
        return;
      }
      const admin = await getAdminSession({ data: token });
      if (!active) return;
      if (!admin) {
        clearAdminToken();
        setState({ status: "guest" });
        return;
      }
      setState({ status: "admin", role: admin.role, email: admin.email });
    })();
    return () => {
      active = false;
    };
  }, []);

  return state;
}