import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../firebase";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

const AdminLoginPage = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Sign in with Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Fetch user role from Firestore
      const userDocRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userDocRef);

      if (!userSnap.exists()) {
        // Sign out immediately if user data not found
        await signOut(auth);
        throw new Error("User data not found.");
      }

      const userData = userSnap.data();
      if (userData.role !== "admin") {
        // Sign out non-admin users immediately
        await signOut(auth);
        throw new Error("You do not have admin access.");
      }

      navigate("/dashboard");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 font-poppins" style={{ background: "var(--rail)" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md card"
      >
        <div className="p-8 sm:p-10">
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-4">
              <ShieldCheck className="size-6 text-blue-600" />
            </div>
            <span className="badge badge-info badge-plain mb-3">Administrator</span>
            <h1 className="text-2xl font-bold text-slate-800">Admin sign in</h1>
            <p className="text-slate-500 mt-1 text-sm">Access your admin dashboard securely.</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="field-label">Admin email</label>
              <input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" required className="input" />
            </div>

            <div>
              <label className="field-label">Password</label>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required className="input" style={{ paddingRight: "2.75rem" }} />
                <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-600" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
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
            Need user access?{" "}
            <Link to="/login" className="font-medium text-blue-600 hover:underline">Go to staff login</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminLoginPage;
