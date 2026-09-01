/**
 * Binds InnPilot's auth/hotel context to the WebMCP registry.
 *
 * Renders nothing and adds no DOM — it exists purely to drive the
 * registration lifecycle from React without letting render churn reach
 * the browser API. The effect depends on primitives (uid, email, role,
 * hotelId) rather than the Firebase user object, and syncWebMCP is
 * itself idempotent, so a re-render never re-registers a tool.
 *
 * Must be rendered inside AuthProvider. Mounting it on public routes is
 * harmless: signed-out visitors sync a null session, which registers
 * nothing.
 */
import { useEffect, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { getWebMCPStatus, stopWebMCP, syncWebMCP } from "./registry";

export default function WebMCPProvider({ children }: { children: ReactNode }) {
  const { user, role, hotelId, loading } = useAuth();
  const uid = user?.uid ?? null;
  const email = user?.email ?? null;

  useEffect(() => {
    // Wait for the real answer rather than briefly binding a null session.
    if (loading) return;

    // "pending" accounts aren't approved for hotel operations, so they get
    // no tools — the same call ProtectedRoute makes for the UI.
    if (!uid || !role || role === "pending") {
      syncWebMCP(null);
      return;
    }

    syncWebMCP({ uid, email, role, hotelId });
  }, [loading, uid, email, role, hotelId]);

  // Teardown is unmount-only: doing it in the effect above would
  // unregister and re-register on every auth change.
  useEffect(() => stopWebMCP, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const status = getWebMCPStatus();
    console.info(
      "[WebMCP]",
      status.supported
        ? { supported: true, namespace: status.namespace, tools: status.registeredTools.length }
        : { supported: false, reason: status.reason }
    );
  }, [loading, uid]);

  return <>{children}</>;
}
