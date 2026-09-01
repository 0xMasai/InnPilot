/**
 * WebMCP integration foundation.
 *
 * This module is the single place InnPilot talks to the browser's WebMCP
 * API. It is framework-agnostic on purpose — React only drives it through
 * WebMCPProvider.tsx, so the registration lifecycle is not tangled up with
 * the render lifecycle.
 *
 * Design rules this file exists to enforce:
 *
 * 1. Feature detection first. WebMCP is experimental and absent in most
 *    browsers; every entry point degrades to a no-op rather than throwing.
 * 2. One registration per signed-in session. `syncWebMCP` is idempotent —
 *    calling it on every React render re-registers nothing, because it
 *    compares an identity key (uid + role + hotel) before acting.
 * 3. Tools never see an unauthenticated or cross-tenant call. Every tool
 *    is wrapped in a guard that re-checks role and hotel membership at
 *    invoke time, against live auth state rather than whatever was true
 *    at registration time.
 *
 * The toolset itself lives in ./tools; the contract is in ./types.
 */
import type { Role } from "../types/models";
import { INNPILOT_WEBMCP_TOOLS } from "./tools";
import {
  ToolInputError,
  type InnPilotWebMCPTool,
  type WebMCPAuthContext,
} from "./types";

export type { WebMCPAuthContext };

export type WebMCPUnsupportedReason =
  /** Not running in a browser at all (Node, SSR, a test runner). */
  | "no-document"
  /** Browser has no WebMCP implementation. */
  | "api-unavailable"
  /** WebMCP requires HTTPS; this page is not a secure context. */
  | "insecure-context";

export type WebMCPStatus =
  | { supported: false; reason: WebMCPUnsupportedReason }
  | {
      supported: true;
      /** Which namespace the implementation was found on. */
      namespace: "document" | "navigator";
      /** Tools currently registered for the active session. */
      registeredTools: string[];
      /** Whether a signed-in InnPilot session is bound. */
      hasSession: boolean;
    };

/**
 * Roles allowed to invoke a tool when it doesn't say otherwise. Mirrors
 * ProtectedRoute's default (`["hotel_admin", "staff"]`) so an agent can
 * never reach an operation the same user couldn't reach in the UI.
 */
const DEFAULT_ALLOWED_ROLES: Role[] = ["hotel_admin", "staff"];

/**
 * Live auth context. Tools read this at invoke time, not registration
 * time, so a role change or sign-out takes effect on the very next call
 * without needing to tear the toolset down.
 */
let currentContext: WebMCPAuthContext | null = null;

/** Identity of the session the current registration belongs to. */
let activeKey: string | null = null;

/** Aborting this unregisters everything registered for `activeKey`. */
let activeController: AbortController | null = null;

/** Names registered under the active controller, for diagnostics. */
let registeredNames: string[] = [];

/** Resolves the WebMCP entry point, or null when unsupported. */
function resolveModelContext(): { api: WebMCPModelContext; namespace: "document" | "navigator" } | null {
  if (typeof document === "undefined") return null;

  // `document.modelContext` is current; `navigator.modelContext` is the
  // deprecated pre-Chromium-150 location, checked only as a fallback.
  const fromDocument = document.modelContext;
  if (fromDocument && typeof fromDocument.registerTool === "function") {
    return { api: fromDocument, namespace: "document" };
  }

  const fromNavigator = typeof navigator === "undefined" ? undefined : navigator.modelContext;
  if (fromNavigator && typeof fromNavigator.registerTool === "function") {
    return { api: fromNavigator, namespace: "navigator" };
  }

  return null;
}

/** Reports what WebMCP support looks like right now. Safe to call anywhere. */
export function getWebMCPStatus(): WebMCPStatus {
  if (typeof document === "undefined") return { supported: false, reason: "no-document" };

  const resolved = resolveModelContext();
  if (!resolved) {
    // A non-secure context is the most common reason the API is missing
    // during development, so report it distinctly from "browser can't".
    const secure = typeof window !== "undefined" && window.isSecureContext;
    return { supported: false, reason: secure ? "api-unavailable" : "insecure-context" };
  }

  return {
    supported: true,
    namespace: resolved.namespace,
    registeredTools: [...registeredNames],
    hasSession: currentContext !== null,
  };
}

function textResult(text: string, isError = false): WebMCPToolResult {
  return { content: [{ type: "text", text }], isError };
}

/**
 * Wraps a tool so that authentication, role and tenant are re-checked on
 * every invocation. Failures are returned as error results rather than
 * thrown, so a calling agent gets an explanation it can act on instead of
 * an opaque exception.
 */
function guardedExecute(
  tool: InnPilotWebMCPTool,
  input: Record<string, unknown>
): Promise<WebMCPToolResult> | WebMCPToolResult {
  const auth = currentContext;
  if (!auth) {
    return textResult("No InnPilot user is signed in. Sign in before using this tool.", true);
  }

  const allowed = tool.allowedRoles ?? DEFAULT_ALLOWED_ROLES;
  if (!allowed.includes(auth.role)) {
    return textResult(
      `The signed-in InnPilot account (role "${auth.role}") is not permitted to use "${tool.name}".`,
      true
    );
  }

  // Every InnPilot business tool is tenant-scoped: without a hotel there
  // is no Firestore path to act on. Narrowing to a local const is what
  // lets the tool receive a non-null hotelId.
  const hotelId = auth.hotelId;
  if (!hotelId) {
    return textResult(
      "The signed-in InnPilot account has no hotel assigned, so this tool has no tenant to act on.",
      true
    );
  }

  return tool.execute(input, { auth, hotelId });
}

function toDescriptor(tool: InnPilotWebMCPTool): WebMCPToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: async (input) => {
      try {
        return await guardedExecute(tool, input);
      } catch (error) {
        // Bad arguments are the agent's to fix, so its own wording goes
        // back unwrapped. Anything else is an InnPilot-side failure.
        if (error instanceof ToolInputError) return textResult(error.message, true);
        // A thrown tool must not surface as an unhandled rejection inside
        // the browser's agent plumbing.
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`InnPilot tool "${tool.name}" failed: ${message}`, true);
      }
    },
  };
}

/** Registers the toolset for one session. Errors are logged, never thrown. */
async function registerAll(api: WebMCPModelContext, signal: AbortSignal): Promise<void> {
  for (const tool of INNPILOT_WEBMCP_TOOLS) {
    if (signal.aborted) return;
    try {
      await api.registerTool(toDescriptor(tool), { signal });
      if (!signal.aborted) registeredNames = [...registeredNames, tool.name];
    } catch (error) {
      console.error(`[WebMCP] Failed to register tool "${tool.name}"`, error);
    }
  }
}

/**
 * Binds the WebMCP toolset to the given InnPilot session.
 *
 * Safe to call on every render: the identity key short-circuits repeat
 * calls, so React re-renders cause no re-registration. Pass null when the
 * user signs out or their account is not approved for hotel operations.
 */
export function syncWebMCP(context: WebMCPAuthContext | null): void {
  // Refresh the live context first, unconditionally — guarded tool calls
  // read this, so it must track the newest auth state even when the
  // identity key is unchanged (e.g. an email change).
  currentContext = context;

  const key = context ? `${context.uid}|${context.role}|${context.hotelId ?? "-"}` : null;
  if (key === activeKey) return;

  stopWebMCP();
  activeKey = key;
  if (!context) return;

  const resolved = resolveModelContext();
  if (!resolved) return;

  const controller = new AbortController();
  activeController = controller;
  void registerAll(resolved.api, controller.signal);
}

/** Unregisters everything and clears the bound session. */
export function stopWebMCP(): void {
  activeController?.abort();
  activeController = null;
  activeKey = null;
  registeredNames = [];
}
