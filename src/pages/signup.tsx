import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../firebase";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import VisibilityIcon from "@mui/icons-material/Visibility";

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
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        name: fullName,
        email,
        createdAt: serverTimestamp(),
      });

      localStorage.setItem("user", JSON.stringify({ uid: user.uid, email: user.email, name: fullName }));
      navigate("/login");
    } catch (err: any) {
      console.error("Signup error:", err);
      setError(err.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-linear-to-br from-indigo-100 via-purple-50 to-pink-50 font-poppins overflow-hidden relative">
      {/* Soft floating blobs */}
      <motion.div
        animate={{ x: [0, 60, 0], y: [0, 20, 0], opacity: [0.2, 0.5, 0.2] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-10 left-10 w-72 h-72 bg-purple-300/30 rounded-full blur-3xl"
      />
      <motion.div
        animate={{ x: [0, -50, 0], y: [0, -30, 0], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-0 right-20 w-96 h-96 bg-pink-300/30 rounded-full blur-3xl"
      />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="z-10 w-full max-w-md mx-auto bg-white/80 backdrop-blur-xl border border-white/30 rounded-3xl p-10 shadow-xl flex flex-col"
      >
        <div className="text-center mb-8">
          <h2 className="text-3xl font-extrabold text-indigo-700 mb-1">Create Account</h2>
          <p className="text-gray-500 text-sm">Start managing your hotel efficiently today</p>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit}>
  {/* Full Name */}
  <div className="relative">
    <input
      type="text"
      value={fullName}
      onChange={(e) => setFullName(e.target.value)}
      placeholder="Full Name"
      required
      className="w-full px-4 py-3 rounded-xl border border-transparent bg-gray-100 text-gray-900 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-indigo-400 transition shadow-sm"
    />
  </div>

  {/* Email */}
  <div className="relative">
    <input
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      placeholder="Email Address"
      required
      className="w-full px-4 py-3 rounded-xl border border-transparent bg-gray-100 text-gray-900 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-indigo-400 transition shadow-sm"
    />
  </div>

  {/* Password */}
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
      {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
    </div>
  </div>

  {/* Confirm Password */}
  <div className="relative">
    <input
      type={showConfirmPassword ? "text" : "password"}
      value={confirmPassword}
      onChange={(e) => setConfirmPassword(e.target.value)}
      placeholder="Confirm Password"
      required
      className="w-full px-4 py-3 pr-12 rounded-xl border border-transparent bg-gray-100 text-gray-900 placeholder-gray-400 focus:bg-white focus:ring-2 focus:ring-indigo-400 transition shadow-sm"
    />
    <div
      className="absolute top-1/2 right-3 -translate-y-1/2 text-gray-500 hover:text-indigo-700 cursor-pointer"
      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
    >
      {showConfirmPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
    </div>
  </div>

  {/* Error */}
  {error && <p className="text-red-500 text-sm text-center">{error}</p>}

  {/* Submit */}
  <button
    type="submit"
    disabled={loading}
    className={`w-full py-3 rounded-xl font-semibold text-white shadow-md transition-all ${
      loading
        ? "bg-indigo-300 cursor-not-allowed"
        : "bg-linear-to-r from-indigo-600 to-purple-500 hover:from-indigo-700 hover:to-purple-600"
    }`}
  >
    {loading ? "Creating account..." : "Sign Up"}
  </button>
</form>


        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-indigo-700 font-medium hover:underline">
            Log In
          </Link>
        </p>
      </motion.div>
    </div>
  );
};

export default SignUpPage;
