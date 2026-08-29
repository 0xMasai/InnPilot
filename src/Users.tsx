"use client";
// Hotel Admin only: view staff for this hotel and create new staff
// accounts directly. Public self-signup has been removed — accounts are
// always admin-initiated (see src/lib/accountCreation.ts for why that's
// safe without a backend). Role enforcement happens in Firestore
// security rules; this page is the UI on top of that.
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { deleteDoc, doc, onSnapshot, query, collection, where } from "firebase/firestore";
import { db } from "../firebase";
import { Search, Users as UsersIcon, ShieldCheck, UserPlus, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toDateSafe } from "./lib/metrics";
import { logAction } from "./lib/audit";
import { useAuth, type Role } from "./auth/AuthProvider";
import { createManagedAccount } from "./lib/accountCreation";

interface UserRow {
  id: string;
  name?: string;
  email?: string;
  role?: Role;
  createdAt?: unknown;
}

const roleBadge: Record<Role, string> = {
  super_admin: "badge-info",
  hotel_admin: "badge-info",
  staff: "badge-success",
  pending: "badge-warning",
};

export default function UsersDashboard() {
  const { user: me, hotelId } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    if (!hotelId) return;
    const q = query(collection(db, "users"), where("hotelId", "==", hotelId));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserRow, "id">) }));
      // Hotel admin(s) first, then staff; newest first within groups.
      const rank: Record<string, number> = { hotel_admin: 0, staff: 1, pending: 2 };
      data.sort((a, b) => {
        const r = (rank[a.role ?? "staff"] ?? 3) - (rank[b.role ?? "staff"] ?? 3);
        if (r !== 0) return r;
        return (toDateSafe(b.createdAt)?.getTime() ?? 0) - (toDateSafe(a.createdAt)?.getTime() ?? 0);
      });
      setUsers(data);
      setLoading(false);
    });
    return () => unsub();
  }, [hotelId]);

  const handleAddStaff = async (e: FormEvent) => {
    e.preventDefault();
    setAddError("");
    if (!me || !hotelId) return setAddError("No hotel context — please sign in again.");
    if (!addName.trim() || !addEmail.trim() || addPassword.length < 6) {
      return setAddError("Name, email, and a password of at least 6 characters are required.");
    }
    setAddBusy(true);
    try {
      const { uid } = await createManagedAccount({
        name: addName.trim(),
        email: addEmail.trim(),
        password: addPassword,
        role: "staff",
        hotelId,
        createdBy: me.uid,
      });
      logAction(hotelId, "Staff account created", "user", uid, `${addEmail.trim()}`);
      setAddOpen(false);
      setAddName("");
      setAddEmail("");
      setAddPassword("");
    } catch (err: unknown) {
      console.error("Failed to create staff account:", err);
      const code = typeof err === "object" && err && "code" in err ? (err as { code?: string }).code : undefined;
      setAddError(
        code === "auth/email-already-in-use"
          ? "That email is already registered."
          : "Failed to create account. Please try again."
      );
    } finally {
      setAddBusy(false);
    }
  };

  const removeStaff = async (u: UserRow) => {
    if (busy || u.id === me?.uid) return;
    if (!confirm(`Remove ${u.email ?? u.name ?? "this account"}? They will immediately lose access.`)) return;
    setBusy(u.id);
    try {
      // Removes the profile doc, which revokes app access (AuthProvider
      // treats a missing profile as no access). The underlying Firebase
      // Auth account isn't deleted — that requires the Admin SDK, which
      // this project doesn't run; flagged as a follow-up.
      await deleteDoc(doc(db, "users", u.id));
      logAction(hotelId, "Staff account removed", "user", u.id, `${u.email ?? u.id}`);
    } catch (err) {
      console.error("Failed to remove account:", err);
      alert("Failed to remove account. Check your permissions and try again.");
    } finally {
      setBusy(null);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const counts = useMemo(
    () => ({
      total: users.length,
      staff: users.filter((u) => u.role === "staff").length,
      admins: users.filter((u) => u.role === "hotel_admin").length,
    }),
    [users]
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Staff &amp; Users</h2>
          <p className="page-subtitle">Manage accounts for your hotel.</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm">
          <UserPlus size={15} /> Add Staff
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Accounts</span>
            <span className="stat-icon"><UsersIcon size={19} /></span>
          </div>
          <div className="stat-value">{counts.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Staff</span>
            <span className="stat-icon is-success"><UsersIcon size={19} /></span>
          </div>
          <div className="stat-value">{counts.staff}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Hotel Admins</span>
            <span className="stat-icon is-success"><ShieldCheck size={19} /></span>
          </div>
          <div className="stat-value">{counts.admins}</div>
        </div>
      </div>

      <div className="filter-bar">
        <div className="search-wrap">
          <Search size={16} />
          <input
            type="text"
            aria-label="Search users"
            placeholder="Search by name or email…"
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
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 1 ? 160 : 80 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length ? (
                filtered.map((u) => {
                  const role: Role = u.role ?? "staff";
                  const isSelf = u.id === me?.uid;
                  const joined = toDateSafe(u.createdAt);
                  return (
                    <tr key={u.id}>
                      <td className="font-medium text-slate-800">
                        {u.name || "-"}
                        {isSelf && <span className="text-xs text-slate-400 ml-1">(you)</span>}
                      </td>
                      <td className="text-slate-500">{u.email || "-"}</td>
                      <td>
                        <span className={`badge ${roleBadge[role]}`}>{role}</span>
                      </td>
                      <td className="text-slate-500 whitespace-nowrap">
                        {joined ? joined.toLocaleDateString() : "-"}
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                          {/* Only staff accounts can be removed here — hotel
                              admins are managed at the platform level. */}
                          {!isSelf && role === "staff" && (
                            <button
                              onClick={() => removeStaff(u)}
                              disabled={busy === u.id}
                              className="btn btn-danger btn-sm"
                              title="Remove staff account"
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <div className="empty-icon"><UsersIcon size={24} /></div>
                      <p className="empty-title">No users found</p>
                      <p className="empty-desc">
                        {users.length ? "No users match your search." : "Add your first staff account to get started."}
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
        {addOpen && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !addBusy && setAddOpen(false)}
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
              aria-label="Add staff"
            >
              <div className="modal-header">
                <h2 className="modal-title">Add Staff Account</h2>
                <button className="icon-btn" onClick={() => !addBusy && setAddOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-4" onSubmit={handleAddStaff}>
                <div>
                  <label className="field-label">Full name<span className="req">*</span></label>
                  <input
                    type="text"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    required
                    className="input"
                  />
                </div>
                <div>
                  <label className="field-label">Email<span className="req">*</span></label>
                  <input
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    required
                    className="input"
                  />
                </div>
                <div>
                  <label className="field-label">Temporary password<span className="req">*</span></label>
                  <input
                    type="text"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    required
                    className="input"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Share this with the staff member directly; they can change it after logging in.
                  </p>
                </div>

                {addError && (
                  <div
                    className="text-sm rounded-md px-3 py-2"
                    style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}
                  >
                    {addError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setAddOpen(false)} disabled={addBusy} className="btn btn-ghost btn-sm">
                    Cancel
                  </button>
                  <button type="submit" disabled={addBusy} className="btn btn-primary btn-sm">
                    {addBusy ? "Creating…" : "Create account"}
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
