import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile, signOut } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../firebase";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { Hotel } from "lucide-react";

const SignUpPage = () => {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: fullName });
      // New accounts start as "pending" and get no data access until an
      // administrator approves them (enforced by Firestore security rules).
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: fullName,
        email,
        role: "pending",
        createdAt: serverTimestamp(),
      });

      // createUserWithEmailAndPassword signs the new user in; sign out so
      // an unapproved account isn't left with an active session.
      await signOut(auth);
      navigate("/login", {
        state: {
          notice:
            "Account created. An administrator must approve it before you can sign in.",
        },
      });
    } catch (err: any) {
      console.error("Signup error:", err);
      setError(err.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 font-poppins" style={{ background: "var(--app-bg)" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md card"
      >
        <div className="p-8 sm:p-10">
          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <Hotel className="size-5 text-blue-500" />
            </div>
            <span className="text-lg font-semibold text-slate-800">Hotel Management</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 mb-1">Create your account</h2>
          <p className="text-slate-500 text-sm mb-8">Start managing your hotel efficiently today.</p>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="field-label">Full name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" required className="input" />
            </div>

            <div>
              <label className="field-label">Email address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required className="input" />
            </div>

            <div>
              <label className="field-label">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="input" style={{ paddingRight: "2.75rem" }} />
                <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </button>
              </div>
            </div>

            <div>
              <label className="field-label">Confirm password</label>
              <div className="relative">
                <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" required className="input" style={{ paddingRight: "2.75rem" }} />
                <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                  {showConfirmPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm rounded-md px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-6">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-blue-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default SignUpPage;
