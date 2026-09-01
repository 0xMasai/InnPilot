/**
 * Minimal ambient types for the WebMCP browser API.
 *
 * WebMCP is an experimental W3C Web Machine Learning CG proposal and ships
 * no TypeScript definitions, so this file declares only the slice InnPilot
 * actually calls. It is deliberately not a full transcription of the spec:
 * anything we don't use is left undeclared rather than guessed at.
 *
 * Namespace note: the imperative API now lives on `document.modelContext`.
 * `navigator.modelContext` was the original location and is deprecated in
 * Chromium 150+, so both are declared as optional and resolved in that
 * order by src/webmcp/registry.ts.
 *
 * Both members are optional (`?:`) on purpose — that is what forces every
 * call site through a feature check instead of assuming the API exists.
 */

/** A single block of tool output. Only text blocks are used by InnPilot. */
interface WebMCPTextContent {
  type: "text";
  text: string;
}

/** What a tool's `execute` hands back to the calling agent. */
interface WebMCPToolResult {
  content: WebMCPTextContent[];
  /** Marks the call as failed without throwing, so the agent can recover. */
  isError?: boolean;
}

/** JSON Schema describing a tool's arguments. Always an object schema. */
interface WebMCPInputSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** The tool descriptor passed to `registerTool`. */
interface WebMCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: WebMCPInputSchema;
  execute(input: Record<string, unknown>): Promise<WebMCPToolResult> | WebMCPToolResult;
}

interface WebMCPRegisterToolOptions {
  /** Aborting this signal unregisters the tool — the spec's only teardown path. */
  signal?: AbortSignal;
}

interface WebMCPModelContext {
  registerTool(
    tool: WebMCPToolDescriptor,
    options?: WebMCPRegisterToolOptions
  ): Promise<void> | void;
}

interface Document {
  /** Present only in browsers that implement WebMCP, on a secure context. */
  readonly modelContext?: WebMCPModelContext;
}

interface Navigator {
  /** Deprecated pre-Chromium-150 location of the same API. */
  readonly modelContext?: WebMCPModelContext;
}
