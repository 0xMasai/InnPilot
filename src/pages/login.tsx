import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../firebase";
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

  // Map Firebase's error codes to something a person can act on, so the
  // form never surfaces a raw "auth/…" string or a stack trace.
  const friendlyAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code ?? "";
    switch (code) {
      case "auth/invalid-email":
        return "That doesn't look like a valid email address.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
        return "Incorrect email or password. Accounts are created by your Hotel Admin or Super Admin.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a moment and try again.";
      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";
      default:
        return "Couldn't sign you in. Please try again, or contact your administrator.";
    }
  };

  // Sign in only. Provisioning (the users/{uid} document that grants a role
  // and hotel) is done by a super_admin or the bootstrap script — never by
  // the client — so this does not create accounts or fabricate a session.
  // AuthProvider reads the real profile; ProtectedRoute routes on the real
  // role (a not-yet-active account lands on the "account not active" screen).
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  // Convenience for demos/judges: sign in with the demo credentials if the
  // fields are blank. Still a real Firebase sign-in against a real,
  // pre-provisioned account — no fallback session.
  const handleDemoSignIn = async () => {
    setError("");
    setLoading(true);
    const demoEmail = email.trim() || "felixm@innpilot.com";
    const demoPass = password || "0777429854";
    try {
      await signInWithEmailAndPassword(auth, demoEmail, demoPass);
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(friendlyAuthError(err));
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

            <button
              type="button"
              onClick={handleDemoSignIn}
              disabled={loading}
              className="btn btn-secondary w-full text-xs py-2"
              title="Sign in with the pre-provisioned demo administrator account"
            >
              Sign in with Demo Admin
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
