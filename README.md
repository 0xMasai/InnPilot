# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## WebMCP integration

InnPilot exposes its capabilities to AI agents through **WebMCP**, the
browser API for offering agent-callable tools from the page itself. There
is no MCP server and no bundled chatbot: the browser hosts the tools, and
they run inside the app against the already-authenticated Firebase session.

```
agent → WebMCP → document.modelContext → InnPilot → services → Firebase
```

### Layout

| File | Purpose |
| --- | --- |
| `src/types/webmcp.d.ts` | Minimal local types for the API (it ships none). |
| `src/webmcp/registry.ts` | Detection, registration lifecycle, auth/tenant guard. |
| `src/webmcp/tools.ts` | The toolset and its contract. |
| `src/webmcp/WebMCPProvider.tsx` | Binds auth state to the registry; rendered inside `AuthProvider` in `App.tsx`. |

### Browser feature detection

WebMCP is experimental, requires **HTTPS**, and is missing from most
browsers. `registry.ts` resolves `document.modelContext` first, then the
deprecated `navigator.modelContext` (removed in favour of `document` in
Chromium 150+). Where neither exists every entry point is a silent no-op,
so unsupported browsers run InnPilot exactly as before. Call
`getWebMCPStatus()` to see what was detected — in dev the result is logged
once on sign-in.

### The toolset

Tools live in `src/webmcp/tools/` and are listed in `src/webmcp/tools/index.ts`.
They call InnPilot's existing services — they never re-implement business
rules or write to Firestore directly.

| Tool | Purpose |
| --- | --- |
| `innpilot_list_rooms` | Room inventory with type, rate and status. |
| `innpilot_list_reservations` | Current reservations, optionally filtered by status. |
| `innpilot_check_room_availability` | Rooms free for a stay, using the same conflict rule as booking. |
| `innpilot_get_occupancy` | Occupancy rate, occupied/available counts. |
| `innpilot_get_revenue` | Revenue by department, expenses, net operating result. |
| `innpilot_create_reservation` | Creates a confirmed reservation. |
| `innpilot_update_reservation_status` | Check in/out, cancel, mark no-show. |
| `innpilot_set_room_status` | Housekeeping / maintenance status. |

Every tool inherits from the registry:

- **RBAC** — defaults to `["hotel_admin", "staff"]`, the same default as
  `ProtectedRoute`, so an agent can't exceed the user's own UI permissions.
- **Tenant scoping** — `execute` receives a guaranteed non-null `hotelId`
  for use with `hotelCollection()` / `hotelDoc()`.
- **Live auth checks** — role and hotel are re-verified on every call, not
  at registration time.

Registration is idempotent: `syncWebMCP()` short-circuits unless the
session identity (`uid | role | hotelId`) actually changes, so React
re-renders never re-register anything, and teardown runs through an
`AbortController`.

### Adding a tool

Write it in `src/webmcp/tools/`, then list it in that directory's
`index.ts`. Nothing in `registry.ts` needs to change. Use the helpers in
`src/webmcp/toolInput.ts` to read arguments — they raise `ToolInputError`,
whose message goes back to the agent verbatim so it can retry.

Folio charges and payments have no tools: their Firestore rules and types
exist, but InnPilot has no service for either. See
`docs/webmcp/PHASE_2_TOOLS.md`.
