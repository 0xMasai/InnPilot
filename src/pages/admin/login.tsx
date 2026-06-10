import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../../firebase";
import { Eye, EyeOff } from "lucide-react";

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

      console.log("Admin logged in:", user.email);
      navigate("/admin/dashboard");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-linear-to-br from-indigo-100 via-purple-50 to-pink-50 font-poppins overflow-hidden relative">
      {/* Soft floating blobs */}
      <motion.div
        animate={{ x: [0, 50, 0], y: [0, 20, 0], opacity: [0.2, 0.5, 0.2] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-10 left-10 w-72 h-72 bg-purple-300/30 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ x: [0, -50, 0], y: [0, -30, 0], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-0 right-20 w-96 h-96 bg-pink-300/30 rounded-full blur-3xl"
      />

      {/* Glassy card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="z-10 w-full max-w-md mx-auto bg-white/80 backdrop-blur-xl border border-white/30 rounded-3xl p-10 shadow-xl flex flex-col"
      >
        <div className="text-center mb-8">
          <div className="inline-block bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full mb-3 uppercase tracking-wide">
            Admin
          </div>
          <h1 className="text-3xl font-extrabold text-indigo-700 tracking-tight">Login</h1>
          <p className="text-gray-500 mt-2 text-sm">Access your admin dashboard securely</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="relative">
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Admin Email"
              required
              className="peer w-full px-4 py-3 rounded-xl border border-transparent bg-gray-100 text-gray-900 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-indigo-400 transition shadow-sm"
            />
           
          </div>

          {/** Password **/}
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-4 py-3 pr-12 rounded-xl border border-transparent bg-gray-100 text-gray-900 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-indigo-400 transition shadow-sm"
            />
            <div
              className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-500 hover:text-indigo-700 cursor-pointer"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            {/* <label className="flex items-center">
              <input
                type="checkbox"
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-gray-600">Remember me</span>
            </label> */}
            {/* <Link to="/forgot" className="text-indigo-600 hover:underline">
              Forgot password?
            </Link> */}
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl font-semibold text-white shadow-md transition-all ${
              loading
                ? "bg-indigo-300 cursor-not-allowed"
                : "bg-linear-to-r from-indigo-600 to-purple-500 hover:from-indigo-700 hover:to-purple-600"
            }`}
          >
            {loading ? "Logging in..." : "Log In"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Need user access?{" "}
          <Link to="/login" className="text-indigo-700 font-medium hover:underline">
            Go to User Login
          </Link>
        </p>
      </motion.div>
    </div>
  );
};

export default AdminLoginPage;
