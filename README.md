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

### Registering tools

Tools go in `INNPILOT_WEBMCP_TOOLS` (`src/webmcp/tools.ts`) and nowhere
else; `registry.ts` picks them up automatically. Each one inherits:

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

**The toolset is intentionally empty today** — Phase 1 landed the
foundation only. See `docs/webmcp/PHASE_1_FOUNDATION.md` for the audit of
which existing services each future tool must reuse, and what Phase 2 adds.
