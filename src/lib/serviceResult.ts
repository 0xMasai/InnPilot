/**
 * Result type shared by InnPilot's service layer.
 *
 * Services are called from two very different places — React handlers,
 * which render `error` into the UI, and WebMCP tools, which hand `error`
 * back to a calling agent. Returning failures instead of throwing keeps
 * both callers on one path, and keeps user-facing wording in one place
 * rather than duplicated per caller.
 */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): ServiceResult<T> {
  return { ok: false, error };
}

/** Firestore error code, when the thrown value carries one. */
export function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * Maps a Firestore failure to the wording the reservation UI has always
 * shown. Kept verbatim so extracting the service changed no user-visible
 * text.
 */
export function describeWriteFailure(error: unknown, fallback: string): string {
  switch (errorCode(error)) {
    case "permission-denied":
      return "Firestore denied this reservation. Confirm your account has the correct hotelId and role.";
    case "failed-precondition":
      return "Firestore rejected the reservation because a required database precondition is not met.";
    case "unavailable":
      return "Firestore is temporarily unavailable. Check your connection and try again.";
    default:
      return errorMessage(error) || fallback;
  }
}
