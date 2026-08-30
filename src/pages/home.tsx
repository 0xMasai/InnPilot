import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from "recharts";
import {
  Building2,
  CalendarCheck,
  Sparkles,
  Receipt,
  ShieldCheck,
  BarChart3,
  ArrowRight,
  ChevronDown,
  Mail,
  MapPin,
  Zap,
  Layers,
  GraduationCap,
  Wallet,
  CheckCircle2,
} from "lucide-react";

import innpilotLogoLight from "../assets/brand/innpilot-logo-full-light.png";

const CONTACT_EMAIL = "hello@innpilot.app";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

/* ------------------------------------------------------------
   Feature grid
   ------------------------------------------------------------ */
const features: { icon: React.ReactNode; title: string; description: string }[] = [
  { icon: <Building2 size={20} />, title: "Multi-property management", description: "Run every hotel in your portfolio from one role-based platform, no juggling separate logins." },
  { icon: <CalendarCheck size={20} />, title: "Smart reservations", description: "Track bookings from request to check-out with live availability, so no room is ever double-booked." },
  { icon: <Sparkles size={20} />, title: "Housekeeping", description: "A live room board keeps front desk and housekeeping in sync on status, turnovers and readiness." },
  { icon: <Receipt size={20} />, title: "Guest billing & invoicing", description: "Fold room, restaurant and event charges into one clean folio, then invoice guests in a click." },
  { icon: <ShieldCheck size={20} />, title: "Staff & role management", description: "Give every team member exactly the access they need, from front desk agent to hotel admin." },
  { icon: <BarChart3 size={20} />, title: "Real-time reporting", description: "Occupancy, revenue and department performance, always current and ready to export." },
];

/* ------------------------------------------------------------
   Why independent hotels choose InnPilot
   ------------------------------------------------------------ */
const valueProps: { icon: React.ReactNode; title: string; description: string }[] = [
  { icon: <Zap size={20} />, title: "Built for how you actually run a hotel", description: "Not a scaled-down enterprise suite. InnPilot is sized, priced and designed for independent properties." },
  { icon: <Layers size={20} />, title: "One platform instead of five", description: "Reservations, housekeeping, billing, restaurant and reporting live in a single system your whole team shares." },
  { icon: <GraduationCap size={20} />, title: "Your team is productive on day one", description: "A clean, focused interface means front desk and housekeeping staff need minutes, not weeks, to get comfortable." },
  { icon: <Wallet size={20} />, title: "Priced for independent operations", description: "No enterprise contracts or per-module upsells. Straightforward pricing that scales with your property." },
];

/* ------------------------------------------------------------
   FAQ
   ------------------------------------------------------------ */
const faqs: { q: string; a: string }[] = [
  { q: "Can InnPilot manage more than one hotel?", a: "Yes. InnPilot is built for multi-property operators from the ground up. Super admins get a portfolio-wide view, while each property's staff only sees their own hotel." },
  { q: "Can I control what each staff member can see or do?", a: "Yes. Role-based access lets you decide exactly what front desk agents, housekeeping, restaurant staff and hotel admins can view or edit." },
  { q: "Do you publish pricing?", a: "Pricing depends on the number of properties and rooms you manage, so we scope it with you directly. Book a demo and our team will send a straightforward quote." },
  { q: "How long does onboarding take?", a: "Most independent hotels are fully set up within a few days, including data migration, room configuration and staff training." },
  { q: "Does InnPilot work if my internet connection is unreliable?", a: "InnPilot is a cloud-based platform designed to stay fast and responsive on the connectivity typical of independent hotels." },
];

/* ------------------------------------------------------------
   Product showcase mocks
   ------------------------------------------------------------ */
const occupancyTrend = [
  { day: "Mon", value: 58 },
  { day: "Tue", value: 62 },
  { day: "Wed", value: 71 },
  { day: "Thu", value: 68 },
  { day: "Fri", value: 82 },
  { day: "Sat", value: 91 },
  { day: "Sun", value: 87 },
];

const DashboardPreview = () => (
  <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#0b1220] w-full">
    <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10">
      <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
      <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
      <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
      <span className="ml-3 text-[11px] text-[#8b97ad]">innpilot.app/dashboard</span>
    </div>
    <div className="flex">
      <div className="w-40 border-r border-white/10 py-4 px-3 space-y-1 hidden sm:block">
        {[
          { label: "Overview", active: true },
          { label: "Front desk" },
          { label: "Room board" },
          { label: "Reservations" },
          { label: "Guests" },
          { label: "Reports" },
        ].map((item) => (
          <div
            key={item.label}
            className={`text-[12px] px-3 py-2 rounded-lg ${
              item.active ? "bg-[rgba(45,212,200,0.16)] text-white font-medium" : "text-[#8b97ad]"
            }`}
          >
            {item.label}
          </div>
        ))}
      </div>
      <div className="flex-1 p-4 sm:p-5 space-y-3 bg-[#f5f7fa]">
        <div className="text-slate-800 font-semibold text-sm mb-1">Overview</div>
        <div className="grid grid-cols-3 gap-2">
          {["Occupancy", "Arrivals today", "Open orders"].map((label) => (
            <div key={label} className="bg-white rounded-lg p-3 border border-slate-200">
              <div className="text-[10px] text-slate-400 mb-1">{label}</div>
              <div className="h-2 w-10 rounded bg-[#0e93a3]/30" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-lg p-3 border border-slate-200">
          <div className="text-[10px] text-slate-400 mb-2">Room board</div>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: 18 }).map((_, i) => (
              <div
                key={i}
                className={`h-4 rounded ${i % 5 === 0 ? "bg-[#0e93a3]/40" : "bg-slate-100"}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const ReservationCalendarMock = () => {
  const rooms = ["101", "102", "103", "104"];
  const days = 7;
  // deterministic-looking "reservation bars" per room
  const bars: Record<string, [number, number]> = {
    "101": [0, 3],
    "102": [2, 5],
    "103": [1, 2],
    "104": [4, 7],
  };
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800 text-sm">Reservation calendar</h3>
        <span className="text-[11px] text-slate-400">This week</span>
      </div>
      <div className="space-y-2">
        {rooms.map((room) => {
          const [start, end] = bars[room];
          return (
            <div key={room} className="flex items-center gap-2">
              <span className="w-9 text-[11px] text-slate-400 shrink-0">{room}</span>
              <div className="relative flex-1 h-5 rounded bg-slate-100 grid" style={{ gridTemplateColumns: `repeat(${days}, 1fr)` }}>
                {Array.from({ length: days }).map((_, i) => (
                  <div key={i} className={i > 0 ? "border-l border-slate-200" : ""} />
                ))}
                <div
                  className="absolute top-0.5 bottom-0.5 rounded"
                  style={{
                    left: `${(start / days) * 100}%`,
                    width: `${((end - start) / days) * 100}%`,
                    background: "var(--primary)",
                    opacity: 0.75,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const OccupancyAnalyticsCards = () => (
  <div className="grid grid-cols-2 gap-3">
    <div className="card p-4 sm:p-5">
      <div className="text-[11px] text-slate-400 mb-1">Occupancy this week</div>
      <div className="text-2xl font-bold text-slate-800 mb-2">78%</div>
      <div className="h-14 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={occupancyTrend} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id="occGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0e93a3" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#0e93a3" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="value" stroke="#0e93a3" strokeWidth={2} fill="url(#occGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
    <div className="card p-4 sm:p-5 flex flex-col justify-between">
      <div>
        <div className="text-[11px] text-slate-400 mb-1">Revenue today</div>
        <div className="text-2xl font-bold text-slate-800">UGX 4.2M</div>
      </div>
      <div className="mt-3 space-y-1.5">
        {[
          { label: "Rooms", pct: 62 },
          { label: "Restaurant", pct: 24 },
          { label: "Events", pct: 14 },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="w-16 shrink-0">{row.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: "var(--brand-cyan)" }} />
            </div>
            <span className="w-8 text-right">{row.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------
   FAQ accordion
   ------------------------------------------------------------ */
const FaqItem = ({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 p-4 sm:p-5 text-left"
      >
        <span className="font-medium text-slate-800 text-sm sm:text-base">{q}</span>
        <ChevronDown
          size={18}
          className="shrink-0 text-slate-400 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="px-4 sm:px-5 pb-4 sm:pb-5 text-sm text-slate-500 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ------------------------------------------------------------
   Page
   ------------------------------------------------------------ */
const LandingPage = () => {
  return (
    <div className="min-h-screen w-full font-poppins text-slate-800" style={{ background: "var(--app-bg)" }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <img src={innpilotLogoLight} alt="InnPilot" className="h-8 w-auto object-contain" />
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
            <a href="#features" className="hover:text-slate-900 transition">Features</a>
            <a href="#product" className="hover:text-slate-900 transition">Product</a>
            <a href="#pricing" className="hover:text-slate-900 transition">Pricing</a>
            <a href="#faq" className="hover:text-slate-900 transition">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition">
              Sign In
            </Link>
            <Link to="/book-demo" className="btn btn-primary text-sm px-4 py-2">
              Book a Demo
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: "var(--rail)" }}>
        <div
          className="pointer-events-none absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(45,212,200,0.22) 0%, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 w-[420px] h-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(14,147,163,0.18) 0%, transparent 70%)" }}
        />
        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <span className="inline-block text-xs font-semibold tracking-wide uppercase text-[var(--brand-cyan)] mb-4">
              The operating system for independent hotels
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-5">
              Run Every Hotel From One Dashboard
            </h1>
            <p className="text-[var(--rail-text)] text-base sm:text-lg leading-relaxed mb-8 max-w-xl">
              InnPilot brings reservations, housekeeping, guest billing and multi-property
              management into a single, role-based platform, built for independent hotels
              and small hotel groups rather than enterprise chains.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/book-demo" className="btn btn-primary px-6 py-3 text-sm inline-flex items-center gap-2">
                Book a Demo <ArrowRight size={16} />
              </Link>
              <Link
                to="/login"
                className="px-6 py-3 text-sm font-semibold rounded-lg border border-white/15 text-white hover:bg-white/5 transition"
              >
                Sign In
              </Link>
            </div>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, delay: 0.1 }}>
            <DashboardPreview />
          </motion.div>
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Everything your hotel needs, in one place</h2>
          <p className="text-slate-500">Built around the day-to-day of running an independent property.</p>
        </motion.div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: (i % 3) * 0.05 }}
              className="card p-5"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                {f.icon}
              </div>
              <h3 className="font-semibold text-slate-800 mb-1">{f.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Product showcase */}
      <section id="product" className="py-20" style={{ background: "var(--surface-muted)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">See InnPilot in action</h2>
            <p className="text-slate-500">A live look at the dashboard, reservation calendar and analytics your team works from every day.</p>
          </motion.div>
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp}>
              <DashboardPreview />
            </motion.div>
            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} transition={{ delay: 0.1 }} className="space-y-4">
              <ReservationCalendarMock />
              <OccupancyAnalyticsCards />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Why independent hotels choose InnPilot */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Why independent hotels choose InnPilot</h2>
          <p className="text-slate-500">Not a scaled-down enterprise suite, a platform sized and priced for properties like yours.</p>
        </motion.div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {valueProps.map((v, i) => (
            <motion.div
              key={v.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: i * 0.05 }}
              className="card p-5"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: "rgba(45,212,200,0.14)", color: "var(--primary)" }}>
                {v.icon}
              </div>
              <h3 className="font-semibold text-slate-800 mb-1">{v.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{v.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section id="pricing" className="py-20" style={{ background: "var(--rail)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="text-center max-w-xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Simple, honest pricing</h2>
            <p className="text-[var(--rail-text)]">
              Every hotel is different, so we scope pricing to your property rather than publish a one-size-fits-all number.
            </p>
          </motion.div>
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            variants={fadeUp}
            className="max-w-md mx-auto rounded-2xl p-[1px]"
            style={{ background: "linear-gradient(135deg, var(--brand-cyan), transparent 60%)" }}
          >
            <div className="rounded-2xl p-8 text-center" style={{ background: "var(--rail-2)" }}>
              <span className="inline-block text-xs font-semibold tracking-wide uppercase text-[var(--brand-cyan)] mb-2">
                InnPilot for hotels
              </span>
              <h3 className="text-xl font-bold text-white mb-1">Custom plan</h3>
              <p className="text-[var(--rail-text-muted)] text-sm mb-6">Priced by property count and room count.</p>
              <ul className="text-left space-y-2.5 mb-8">
                {[
                  "Unlimited reservations & rooms",
                  "Multi-property & role-based access",
                  "Guest billing, restaurant & events",
                  "Real-time reporting & analytics",
                  "Onboarding & staff training included",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-[var(--rail-text)]">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--brand-cyan)]" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2.5">
                <Link
                  to="/book-demo"
                  className="btn btn-primary w-full py-3 text-sm inline-flex items-center justify-center gap-2"
                >
                  Book a Demo <ArrowRight size={16} />
                </Link>
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Contact sales — InnPilot")}`}
                  className="w-full py-3 text-sm font-semibold rounded-lg border border-white/15 text-white hover:bg-white/5 transition"
                >
                  Contact Sales
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Frequently asked questions</h2>
          <p className="text-slate-500">Everything you need to know before booking a demo.</p>
        </motion.div>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <motion.div key={f.q} initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} transition={{ delay: i * 0.04 }}>
              <FaqItem q={f.q} a={f.a} defaultOpen={i === 0} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden" style={{ background: "var(--rail)" }}>
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp}>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Your hotel deserves better tools.</h2>
            <p className="text-[var(--rail-text)] mb-8 max-w-xl mx-auto">
              Start running your property with InnPilot.
            </p>
            <Link to="/book-demo" className="btn btn-primary px-8 py-3 text-sm inline-flex items-center gap-2">
              Book a Demo <ArrowRight size={16} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 pt-12 pb-8" style={{ background: "var(--surface)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            <div>
              <img src={innpilotLogoLight} alt="InnPilot" className="h-8 w-auto object-contain mb-3" />
              <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                The operating system for independent hotels and small hotel groups.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#features" className="hover:text-slate-900 transition">Features</a></li>
                <li><a href="#product" className="hover:text-slate-900 transition">Product</a></li>
                <li><a href="#pricing" className="hover:text-slate-900 transition">Pricing</a></li>
                <li><a href="#faq" className="hover:text-slate-900 transition">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Account</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link to="/login" className="hover:text-slate-900 transition">Sign In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Contact</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li className="flex items-center gap-2">
                  <Mail size={14} className="shrink-0" />
                  <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-900 transition">{CONTACT_EMAIL}</a>
                </li>
                <li className="flex items-center gap-2">
                  <MapPin size={14} className="shrink-0" />
                  Kampala, Uganda
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-400">© {new Date().getFullYear()} InnPilot · Built by Masai Labs</p>
            <p className="text-xs text-slate-400">Independent hotel management, simplified.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
