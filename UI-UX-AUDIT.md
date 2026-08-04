# Hotel Management System — UI/UX Audit

**Property:** Hotel Management Platform · **Prepared by:** Senior Product Design + Frontend review · **Date:** 21 July 2026

This audit was completed by reading the full repository before any code was changed. It records the current architecture, the UX problems worth fixing, and the redesign priorities. No functionality was modified during the audit.

---

## 1. Technology & architecture

| Area | Finding |
| --- | --- |
| Framework | React 19 + TypeScript, built with Vite 7 |
| Packaging | Electron 39 desktop app (`electron/main.cjs`, `electron-builder`) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` + `@import "tailwindcss"`), plus a legacy `tailwind.config.js` |
| Routing | `react-router-dom` v7 using `HashRouter` |
| Data | Firebase Auth + Firestore (real-time `onSnapshot` listeners) |
| Charts | Recharts | 
| Animation | Framer Motion | 
| UI libraries | MUI, Radix (dialog/select/slot), lucide-react, react-icons, Tippy, Swiper, react-toastify (installed, largely unused) |
| Reporting | jsPDF + autotable (admin overview only); receipts via `window.open` + `document.write` |

### Routes (`src/App.tsx`)
`/` landing · `/login` staff login · `/signup` · `/admin/login` · `/admin/dashboard` · `/dashboard` · `/profile`.

### Two parallel applications
- **Staff app** — `src/dashboard.tsx` shell → `src/Overview.tsx`, `Accommodation.tsx`, `Restaurant.tsx`, `Conference.tsx`, `Expenses.tsx`. Data is scoped by `where("userId","==",uid)`.
- **Admin app** — `src/pages/admin/dashboard.tsx` shell → `src/pages/admin/*`. The admin Overview aggregates **all** users' data and adds revenue + PDF/CSV export.

The two shells and their modules are near-duplicates with drifting styling — a major source of inconsistency and maintenance cost.

### Navigation model
Both shells use **local `activeIndex` state to switch modules**, not routing. Consequences: no deep links, no browser back/forward, no breadcrumbs, no bookmarking, and the mobile hamburger button is wired to nothing.

### Firestore collections
`accomodation` (note the misspelling, used consistently), `restaurant`, `conferenceRooms`, `expenses`, `users`.

---

## 2. Highest-impact issues

1. **Global CSS is still Vite boilerplate** (`src/index.css`). It sets a dark `background-color:#242424`, `color: rgba(255,255,255,.87)`, `body { display:flex; place-items:center }`, and a global `button { background:#1a1a1a; border-color on hover }`. These fight the app's light Tailwind UI on every screen and every native button. This is the single biggest quick win.
2. **No design system / design tokens.** Colors are hardcoded ad hoc per module: Accommodation is blue, Restaurant's primary button is green, forms use `border-2 border-blue-500 bg-blue-50`, the dashboard uses `#0A122A`, auth uses indigo→purple→pink gradients. Nothing is centralized.
3. **"Template dashboard" aesthetics** — exactly what an enterprise product should avoid: gradient KPI cards, heavy `backdrop-blur` glassmorphism, `rounded-2xl/3xl`, large shadows, animated floating blobs on auth, `whileHover scale 1.05` on cards.
4. **No route guards.** `/dashboard` and `/admin/dashboard` render regardless of auth state; components only read `auth.currentUser` internally. Staff vs admin is not enforced.
5. **Validation via `alert()`** across every form; no inline field errors, no required-field affordance beyond the native attribute, no success feedback (modal just closes).

## 3. Tables & data screens
- No sorting, pagination, column controls, bulk actions, or row selection. Export exists only on the admin overview.
- Status is communicated by **plain text** ("Paid"/"Pending") or **emoji** ("✅ Yes"/"❌ No") — not accessible badges, and partly color/emoji-only.
- Each module re-declares `min-h-screen` and its own background gradient **inside** the shell's already-padded `<main>`, causing nested scroll regions and inconsistent gutters.
- Dead code left in place: a non-functional `<script>` block inside Accommodation's JSX, an `@apply` `<style>` block, and many commented-out filters/buttons.

## 4. Forms & workflows
- Label strategy is inconsistent — Restaurant uses real `<label>`s; Accommodation, Conference and Expenses rely on placeholders only (placeholders disappear on input and fail accessibility).
- Heavy `border-2 border-blue-500 bg-blue-50` inputs are visually noisy and low-contrast (`placeholder-blue-400` on `blue-50`).
- Complex flows (booking, check-in/out) are single long modals rather than logical grouped steps. There is no check-in/check-out workflow distinct from "add booking."

## 5. States
- **Loading:** none. No skeletons; username shows the literal string "Loading…".
- **Empty:** minimal ("No bookings match your filters") with no guidance or primary action.
- **Error / permission-denied / offline:** not handled anywhere in the UI.

## 6. Accessibility
- Icon-only buttons (bell, menu, close, search) have no `aria-label`.
- Search inputs have no associated labels.
- Modals lack dialog semantics, focus trapping, and Escape-to-close.
- Contrast failures in low-saturation placeholder/border combinations.
- `font-poppins` is referenced but Poppins is never loaded, so it silently falls back.

## 7. Responsive
- Sidebar is `hidden md:flex`; on small screens there is **no** working navigation (hamburger is inert). Tables overflow horizontally without responsive treatment. Auth/landing are acceptable.

---

## 8. Redesign priorities (execution order)

1. **Design system** — rewrite `index.css` with semantic tokens (color, surface, text, border, status, radius, shadow, spacing, motion), base resets, a real font, and reusable component classes (`card`, `btn`, `badge`, `input`, `table`…). Removes the boilerplate that fights the app.
2. **Application shell** — grouped, labelled navigation (Operations / Revenue / Services / Administration mapped to the real modules), refined dark rail, accessible header, working mobile drawer, consistent content width. Keep the tab-switch logic and notifications.
3. **Dashboard / Overview** — an executive control center: restrained KPI cards, readable labelled charts, clear sections. Preserve all Firestore aggregation.
4. **Operational modules** — Accommodation, Restaurant, Conference, Expenses: one consistent page header, stat row, filter bar, and a premium table with **accessible status badges** (icon + text + color), plus empty/loading states and cleaner grouped forms.
5. **Auth + landing** — calmer, professional, trustworthy; drop the floating blobs and glassmorphism.

**Guardrails:** preserve every Firestore call, handler, state shape, field name (including `accomodation`), and route. No schema or API changes. Restyle presentation and structure only.
