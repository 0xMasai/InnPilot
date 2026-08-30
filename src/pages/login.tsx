import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { Eye, EyeOff, ShieldCheck, BedDouble, Utensils } from "lucide-react";
import innpilotLogoDark from "../assets/brand/innpilot-logo-full-dark.png";
import innpilotLogoLight from "../assets/brand/innpilot-logo-full-light.png";

const LoginPage = () => {
  const navigate = useNavigate();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        // Legacy account with no profile doc: create it as "pending" so an
        // administrator must approve it (enforced by Firestore rules).
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          role: "pending",
          hotelId: null,
          createdAt: serverTimestamp(),
        });
      }

      localStorage.setItem("user", JSON.stringify({ uid: user.uid, email: user.email }));
      navigate("/dashboard");
    } catch (err: any) {
      console.error(err);
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 font-poppins" style={{ background: "var(--app-bg)" }}>
      {/* Brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 text-white overflow-hidden" style={{ background: "var(--rail)" }}>
        <img src={innpilotLogoDark} alt="InnPilot" className="h-10 w-auto object-contain" />

        <div className="max-w-sm">
          <h1 className="text-3xl font-bold leading-tight mb-3">Run your hotel. Smarter.</h1>
          <p className="text-[var(--rail-text)] text-sm leading-relaxed">
            Everything you need to run your hotel, in one place — reservations, dining, conferences and finances, organized and real-time.
          </p>
          <div className="mt-8 space-y-3">
            {[
              { icon: <BedDouble size={16} />, label: "Live room availability & bookings" },
              { icon: <Utensils size={16} />, label: "Restaurant and conference orders" },
              { icon: <ShieldCheck size={16} />, label: "Secure, role-based access" },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-[var(--rail-text)]">
                <span className="w-8 h-8 rounded-md bg-white/5 flex items-center justify-center text-[var(--brand-cyan)]">{f.icon}</span>
                {f.label}
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-[var(--rail-text-muted)]">© {new Date().getFullYear()} InnPilot · Built by Masai Labs</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden flex items-center mb-8">
            <img src={innpilotLogoLight} alt="InnPilot" className="h-9 w-auto object-contain" />
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-1">Welcome to InnPilot</h2>
          <p className="text-slate-500 text-sm mb-8">Everything you need to run your hotel, in one place.</p>

          {notice && (
            <div
              className="text-sm rounded-md px-3 py-2 mb-4"
              style={{ background: "var(--info-soft, #eff6ff)", color: "#1d4ed8", border: "1px solid #bfdbfe" }}
            >
              {notice}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="field-label">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="input"
              />
            </div>

            <div>
              <label className="field-label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input"
                  style={{ paddingRight: "2.75rem" }}
                />
                <button
                  type="button"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm rounded-md px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-6">
            Accounts are created by your Hotel Admin or Super Admin —
            contact them if you need access.
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
