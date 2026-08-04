"use client";
// Admin-only user management: approve pending accounts and assign roles.
// Role enforcement happens in Firestore security rules; this page is the UI.
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Search, Users as UsersIcon, ShieldCheck, Clock, CheckCircle2 } from "lucide-react";
import { COLLECTIONS } from "./lib/collections";
import { toDateSafe } from "./lib/metrics";
import { logAction } from "./lib/audit";
import { useAuth, type Role } from "./auth/AuthProvider";

interface UserRow {
  id: string;
  name?: string;
  email?: string;
  role?: Role;
  createdAt?: unknown;
}

const roleBadge: Record<Role, string> = {
  admin: "badge-info",
  staff: "badge-success",
  pending: "badge-warning",
};

export default function UsersDashboard() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, COLLECTIONS.USERS), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserRow, "id">) }));
      // Pending first, then admins, then staff; newest first within groups.
      const rank: Record<string, number> = { pending: 0, admin: 1, staff: 2 };
      data.sort((a, b) => {
        const r = (rank[a.role ?? "pending"] ?? 3) - (rank[b.role ?? "pending"] ?? 3);
        if (r !== 0) return r;
        return (toDateSafe(b.createdAt)?.getTime() ?? 0) - (toDateSafe(a.createdAt)?.getTime() ?? 0);
      });
      setUsers(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const setRole = async (u: UserRow, role: Role) => {
    const current = u.role ?? "pending";
    if (current === role || busy) return;
    setBusy(u.id);
    try {
      await updateDoc(doc(db, COLLECTIONS.USERS, u.id), { role });
      logAction("Role changed", "user", u.id, `${u.email ?? u.id}: ${current} → ${role}`);
    } catch (err) {
      console.error("Failed to change role:", err);
      alert("Failed to change role. Check your permissions and try again.");
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
      pending: users.filter((u) => (u.role ?? "pending") === "pending").length,
      admins: users.filter((u) => u.role === "admin").length,
    }),
    [users]
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Staff &amp; Users</h2>
          <p className="page-subtitle">Approve new accounts and manage roles.</p>
        </div>
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
            <span className="stat-label">Awaiting Approval</span>
            <span className="stat-icon is-warning"><Clock size={19} /></span>
          </div>
          <div className="stat-value">{counts.pending}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Administrators</span>
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
                  const role: Role = u.role ?? "pending";
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
                          {role === "pending" && (
                            <button
                              onClick={() => setRole(u, "staff")}
                              disabled={busy === u.id}
                              className="btn btn-success btn-sm"
                              title="Approve as staff"
                            >
                              <CheckCircle2 size={14} /> Approve
                            </button>
                          )}
                          {/* Admins cannot change their own role — prevents
                              accidentally locking yourself out. */}
                          {!isSelf && (
                            <select
                              value={role}
                              onChange={(e) => setRole(u, e.target.value as Role)}
                              disabled={busy === u.id}
                              className="select"
                              style={{ height: 32, fontSize: 12, width: 110 }}
                              aria-label={`Role for ${u.email ?? u.id}`}
                            >
                              <option value="pending">pending</option>
                              <option value="staff">staff</option>
                              <option value="admin">admin</option>
                            </select>
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
                        {users.length ? "No users match your search." : "Accounts appear here after signup."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
