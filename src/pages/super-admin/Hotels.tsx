import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { Hotel as HotelIcon, Plus, Search, X, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import type { HotelDoc, SubscriptionPlan } from "../../types/models";
import { useAuth } from "../../auth/AuthProvider";

interface HotelRow extends HotelDoc {
  id: string;
}

export default function SuperAdminHotels() {
  const { user } = useAuth();
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [plan, setPlan] = useState<SubscriptionPlan>("trial");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "hotels"), (snap) => {
      setHotels(snap.docs.map((d) => ({ id: d.id, ...(d.data() as HotelDoc) })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hotels;
    return hotels.filter(
      (h) => h.name.toLowerCase().includes(q) || h.location.toLowerCase().includes(q)
    );
  }, [hotels, search]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!user) return setError("No session — please sign in again.");
    if (!name.trim() || !location.trim()) return setError("Name and location are required.");

    setBusy(true);
    try {
      await addDoc(collection(db, "hotels"), {
        name: name.trim(),
        location: location.trim(),
        subscription: { plan, status: "active" },
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      });
      setOpen(false);
      setName("");
      setLocation("");
      setPlan("trial");
    } catch (err) {
      console.error("Failed to create hotel:", err);
      setError("Failed to create hotel. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Hotels</h2>
          <p className="page-subtitle">All tenants on the platform.</p>
        </div>
        <button onClick={() => setOpen(true)} className="btn btn-primary btn-sm">
          <Plus size={15} /> Add Hotel
        </button>
      </div>

      <div className="filter-bar">
        <div className="search-wrap">
          <Search size={16} />
          <input
            type="text"
            aria-label="Search hotels"
            placeholder="Search by name or location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hotel</th>
                <th>Location</th>
                <th>Plan</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: 100 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length ? (
                filtered.map((h) => (
                  <tr key={h.id}>
                    <td className="font-medium text-slate-800">{h.name}</td>
                    <td className="text-slate-500">{h.location}</td>
                    <td className="capitalize">{h.subscription?.plan ?? "—"}</td>
                    <td>
                      <span className={`badge ${h.subscription?.status === "active" ? "badge-success" : "badge-warning"}`}>
                        {h.subscription?.status ?? "—"}
                      </span>
                    </td>
                    <td>
                      <Link to={`/super-admin/hotels/${h.id}`} className="btn btn-secondary btn-sm">
                        Manage <ChevronRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <div className="empty-icon"><HotelIcon size={24} /></div>
                      <p className="empty-title">No hotels found</p>
                      <p className="empty-desc">
                        {hotels.length ? "No hotels match your search." : "Add your first hotel to get started."}
                      </p>
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
              aria-label="Add hotel"
            >
              <div className="modal-header">
                <h2 className="modal-title">Add Hotel</h2>
                <button className="icon-btn" onClick={() => !busy && setOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-4" onSubmit={handleCreate}>
                <div>
                  <label className="field-label">Hotel name<span className="req">*</span></label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className="input" />
                </div>
                <div>
                  <label className="field-label">Location<span className="req">*</span></label>
                  <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} required className="input" placeholder="e.g. Kampala, Uganda" />
                </div>
                <div>
                  <label className="field-label">Starting plan</label>
                  <select value={plan} onChange={(e) => setPlan(e.target.value as SubscriptionPlan)} className="select">
                    <option value="trial">Trial</option>
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>

                {error && (
                  <div className="text-sm rounded-md px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}>
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-ghost btn-sm">Cancel</button>
                  <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
                    {busy ? "Creating…" : "Create hotel"}
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
