import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  BedDouble,
  Utensils,
  Briefcase,
  PieChart,
  Users,
  FileText,
  ClipboardList,
  Building2,
  LayoutDashboard,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

import innpilotLogoLight from "../assets/brand/innpilot-logo-full-light.png";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const painPoints = [
  "Reservations, dining, conferences and finances scattered across disconnected tools",
  "Manual, spreadsheet-driven reservation management prone to double bookings",
  "Little visibility into what's actually happening across departments",
  "Reporting that takes hours to assemble instead of minutes",
  "Staff coordination that breaks down between front desk, kitchen and housekeeping",
  "Enterprise PMS software that's too complicated, or too expensive, for an independent property",
];

const capabilities: { icon: React.ReactNode; title: string; description: string }[] = [
  { icon: <LayoutDashboard size={20} />, title: "Front desk & room board", description: "A live view of every room's status, ready for fast check-in and check-out." },
  { icon: <ClipboardList size={20} />, title: "Reservations", description: "Track bookings from request to check-out without double-booking a room." },
  { icon: <BedDouble size={20} />, title: "Rooms & accommodation", description: "Manage room types, availability and rates in one place." },
  { icon: <Users size={20} />, title: "Guest management", description: "Guest profiles, stay history and balances, always up to date." },
  { icon: <Utensils size={20} />, title: "Restaurant", description: "Take and track dining orders alongside the rest of your operation." },
  { icon: <Briefcase size={20} />, title: "Conference & events", description: "Book meeting spaces and events without a separate calendar." },
  { icon: <PieChart size={20} />, title: "Expenses", description: "Log operational spending by department as it happens." },
  { icon: <FileText size={20} />, title: "Reports", description: "Management reports you can review, print and export." },
  { icon: <Building2 size={20} />, title: "Multi-property management", description: "Run more than one hotel from a single, role-based platform." },
];

const audiences = [
  "Boutique hotels",
  "Lodges",
  "Guest houses",
  "Small hotel groups",
  "Independent hospitality businesses",
];

const PreviewMock = () => (
  <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[#0b1220] w-full max-w-2xl mx-auto">
    <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10">
      <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
      <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
      <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
    </div>
    <div className="flex">
      <div className="w-40 sm:w-48 border-r border-white/10 py-4 px-3 space-y-1 hidden sm:block">
        {[
          { label: "Overview", active: true },
          { label: "Accommodation" },
          { label: "Guests" },
          { label: "Restaurant" },
          { label: "Conference" },
          { label: "Expenses" },
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
      <div className="flex-1 p-5 space-y-3 bg-[#f5f7fa]">
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

const LandingPage = () => {
  return (
    <div className="min-h-screen w-full font-poppins text-slate-800" style={{ background: "var(--app-bg)" }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <img src={innpilotLogoLight} alt="InnPilot" className="h-8 w-auto object-contain"  />
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
            >
              Sign In
            </Link>
            <Link to="/login" className="btn btn-primary text-sm px-4 py-2">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: "var(--rail)" }}>
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <span className="inline-block text-xs font-semibold tracking-wide uppercase text-[var(--brand-cyan)] mb-4">
              The operating system for independent hotels
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-5">
              Run your hotel. Smarter.
            </h1>
            <p className="text-[var(--rail-text)] text-base sm:text-lg leading-relaxed mb-8 max-w-xl">
              InnPilot brings reservations, rooms, guests, payments, restaurant operations,
              housekeeping and reporting into one simple platform built for independent hotels.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/login" className="btn btn-primary px-6 py-3 text-sm inline-flex items-center gap-2">
                Get Started <ArrowRight size={16} />
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
            <PreviewMock />
          </motion.div>
        </div>
      </section>

      {/* Why InnPilot */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Why InnPilot</h2>
          <p className="text-slate-500">
            Independent hotels shouldn't have to run on the same disconnected tools that make daily operations harder than they need to be.
          </p>
        </motion.div>
        <div className="grid sm:grid-cols-2 gap-4">
          {painPoints.map((point, i) => (
            <motion.div
              key={i}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-3 card p-4"
            >
              <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--primary-soft)" }}>
                <CheckCircle2 size={14} style={{ color: "var(--primary)" }} />
              </span>
              <p className="text-sm text-slate-600">{point}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Core capabilities */}
      <section className="py-20" style={{ background: "var(--surface-muted)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Everything your hotel needs, in one place</h2>
            <p className="text-slate-500">Built around the day-to-day of running an independent property.</p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {capabilities.map((c, i) => (
              <motion.div
                key={c.title}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                variants={fadeUp}
                transition={{ delay: (i % 3) * 0.05 }}
                className="card p-5"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                  {c.icon}
                </div>
                <h3 className="font-semibold text-slate-800 mb-1">{c.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{c.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Built for independent hotels */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Built for independent hotels</h2>
          <p className="text-slate-500">Not a scaled-down enterprise suite — a platform sized and priced for properties like yours.</p>
        </motion.div>
        <div className="flex flex-wrap justify-center gap-3">
          {audiences.map((a) => (
            <span key={a} className="px-4 py-2 rounded-full text-sm font-medium card" style={{ color: "var(--text-secondary)" }}>
              {a}
            </span>
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
            <Link to="/login" className="btn btn-primary px-8 py-3 text-sm inline-flex items-center gap-2">
              Get Started <ArrowRight size={16} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src={innpilotLogoLight} alt="InnPilot" className="h-6 w-auto object-contain opacity-70" />
          </div>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} InnPilot · Built by Masai Labs</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
