import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { ArrowLeft, ShieldCheck, UserPlus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { HotelDoc, SubscriptionPlan, SubscriptionStatus, UserDoc } from "../../types/models";
import { useAuth } from "../../auth/AuthProvider";
import { createManagedAccount } from "../../lib/accountCreation";

export default function SuperAdminHotelDetail() {
  const { hotelId } = useParams<{ hotelId: string }>();
  const { user: me } = useAuth();

  const [hotel, setHotel] = useState<(HotelDoc & { id: string }) | null>(null);
  const [admins, setAdmins] = useState<(UserDoc & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hotelId) return;
    const unsubHotel = onSnapshot(doc(db, "hotels", hotelId), (snap) => {
      setHotel(snap.exists() ? ({ id: snap.id, ...(snap.data() as HotelDoc) }) : null);
      setLoading(false);
    });
    const unsubAdmins = onSnapshot(
      query(collection(db, "users"), where("hotelId", "==", hotelId), where("role", "==", "hotel_admin")),
      (snap) => setAdmins(snap.docs.map((d) => ({ id: d.id, ...(d.data() as UserDoc) })))
    );
    return () => {
      unsubHotel();
      unsubAdmins();
    };
  }, [hotelId]);

  const handleCreateAdmin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!me || !hotelId) return setError("No session — please sign in again.");
    if (!name.trim() || !email.trim() || password.length < 6) {
      return setError("Name, email, and a password of at least 6 characters are required.");
    }
    setBusy(true);
    try {
      await createManagedAccount({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "hotel_admin",
        hotelId,
        createdBy: me.uid,
      });
      setOpen(false);
      setName("");
      setEmail("");
      setPassword("");
    } catch (err: unknown) {
      console.error("Failed to create hotel admin:", err);
      const code = typeof err === "object" && err && "code" in err ? (err as { code?: string }).code : undefined;
      setError(
        code === "auth/email-already-in-use"
          ? "That email is already registered."
          : "Failed to create account. Please try again."
      );
    } finally {
      setBusy(false);
    }
  };

  const updateSubscription = async (patch: Partial<{ plan: SubscriptionPlan; status: SubscriptionStatus }>) => {
    if (!hotelId || !hotel) return;
    await updateDoc(doc(db, "hotels", hotelId), {
      subscription: { ...hotel.subscription, ...patch },
    });
  };

  if (loading) {
    return <div className="skeleton" style={{ height: 200 }} />;
  }

  if (!hotel) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><ShieldCheck size={24} /></div>
        <p className="empty-title">Hotel not found</p>
        <Link to="/super-admin/hotels" className="btn btn-secondary btn-sm mt-3">
          <ArrowLeft size={14} /> Back to hotels
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <Link to="/super-admin/hotels" className="text-xs text-slate-400 hover:underline flex items-center gap-1 mb-1">
            <ArrowLeft size={12} /> Hotels
          </Link>
          <h2 className="page-title">{hotel.name}</h2>
          <p className="page-subtitle">{hotel.location}</p>
        </div>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
          <UserPlus size={15} /> Create Hotel Admin
        </button>
      </div>

      <div className="card card-pad space-y-4">
        <h3 className="section-title">Subscription</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
          <div>
            <label className="field-label">Plan</label>
            <select
              value={hotel.subscription?.plan ?? "trial"}
              onChange={(e) => updateSubscription({ plan: e.target.value as SubscriptionPlan })}
              className="select"
            >
              <option value="trial">Trial</option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <select
              value={hotel.subscription?.status ?? "active"}
              onChange={(e) => updateSubscription({ status: e.target.value as SubscriptionStatus })}
              className="select"
            >
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="section-title mb-3">Hotel Admins</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {admins.length ? (
                admins.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium text-slate-800">{a.name || "-"}</td>
                    <td className="text-slate-500">{a.email || "-"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>
                    <div className="empty-state">
                      <div className="empty-icon"><UserPlus size={24} /></div>
                      <p className="empty-title">No hotel admin yet</p>
                      <p className="empty-desc">Create one to give this hotel access to its console.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !busy && setOpen(false)}
          >
            <motion.div
              className="modal-panel max-w-md"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Create hotel admin"
            >
              <div className="modal-header">
                <h2 className="modal-title">Create Hotel Admin</h2>
                <button className="icon-btn" onClick={() => !busy && setOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-4" onSubmit={handleCreateAdmin}>
                <div>
                  <label className="field-label">Full name<span className="req">*</span></label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="input" />
                </div>
                <div>
                  <label className="field-label">Email<span className="req">*</span></label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input" />
                </div>
                <div>
                  <label className="field-label">Temporary password<span className="req">*</span></label>
                  <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required className="input" />
                  <p className="text-xs text-slate-400 mt-1">Share this with them directly; they can change it after logging in.</p>
                </div>

                {error && (
                  <div className="text-sm rounded-md px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}>
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-ghost btn-sm">Cancel</button>
                  <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
                    {busy ? "Creating…" : "Create account"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
