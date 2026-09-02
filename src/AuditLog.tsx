"use client";
// Admin-only, read-only view of the append-only audit trail.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { hotelCollection } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import { Search, ShieldCheck, BedDouble, Utensils, Briefcase, Wallet, User, DoorOpen, Sparkles } from "lucide-react";
import { COLLECTIONS } from "./lib/collections";
import { toDateSafe } from "./lib/metrics";
import type { AuditEntity } from "./lib/audit";

interface AuditRow {
  id: string;
  action: string;
  entity: AuditEntity;
  entityId: string | null;
  details: string;
  userEmail: string;
  userId: string;
  at: unknown;
  /**
   * "ai" on entries the assistant wrote after a user confirmed the change
   * (server/ai/auditLogger.ts). Absent on everything the UI writes, which
   * is why the filter below reads it as "staff" rather than assuming.
   */
  source?: string;
}

type SourceFilter = "All" | "staff" | "ai";

const entityIcon: Record<AuditEntity, ReactNode> = {
  booking: <BedDouble size={15} />,
  room: <DoorOpen size={15} />,
  order: <Utensils size={15} />,
  event: <Briefcase size={15} />,
  expense: <Wallet size={15} />,
  user: <User size={15} />,
};

const entityBadge: Record<AuditEntity, string> = {
  booking: "badge-info",
  room: "badge-neutral",
  order: "badge-warning",
  event: "badge-success",
  expense: "badge-danger",
  user: "badge-plain badge-info",
};

const MAX_ENTRIES = 300;

export default function AuditLogDashboard() {
  const { hotelId } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterEntity, setFilterEntity] = useState<"All" | AuditEntity>("All");
  const [filterSource, setFilterSource] = useState<SourceFilter>("All");

  useEffect(() => {
    if (!hotelId) return;
    const q = query(
      hotelCollection(hotelId, COLLECTIONS.AUDIT),
      orderBy("at", "desc"),
      limit(MAX_ENTRIES)
    );
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditRow, "id">) })));
      setLoading(false);
    });
    return () => unsub();
  }, [hotelId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesEntity = filterEntity === "All" || r.entity === filterEntity;
      const matchesSource =
        filterSource === "All" ||
        (filterSource === "ai" ? r.source === "ai" : r.source !== "ai");
      const matchesSearch =
        !q ||
        r.action.toLowerCase().includes(q) ||
        r.details.toLowerCase().includes(q) ||
        (r.userEmail || "").toLowerCase().includes(q);
      return matchesEntity && matchesSource && matchesSearch;
    });
  }, [rows, search, filterEntity, filterSource]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Audit Log</h2>
          <p className="page-subtitle">
            Who did what, and when. Entries are append-only and cannot be edited or deleted.
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="search-wrap flex-1">
            <Search size={16} />
            <input
              type="text"
              aria-label="Search audit log"
              placeholder="Search action, details or user…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
            />
          </div>
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value as any)}
            className="select lg:w-56"
            aria-label="Entity type"
          >
            <option value="All">All entities</option>
            <option value="booking">Bookings</option>
            <option value="room">Rooms</option>
            <option value="order">Orders</option>
            <option value="event">Events</option>
            <option value="expense">Expenses</option>
            <option value="user">Users</option>
          </select>
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value as SourceFilter)}
            className="select lg:w-56"
            aria-label="Source"
          >
            <option value="All">All sources</option>
            <option value="staff">Done in InnPilot</option>
            <option value="ai">Done via Ask InnPilot</option>
          </select>
        </div>
        <p className="mt-3 text-sm muted">
          Showing <strong className="text-slate-700">{filtered.length}</strong> of the latest{" "}
          <strong className="text-slate-700">{rows.length}</strong> entries
        </p>
      </div>

      <div className="card card-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 4 ? 180 : 90 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length ? (
                filtered.map((r) => {
                  const at = toDateSafe(r.at);
                  return (
                    <tr key={r.id}>
                      <td className="text-slate-500 whitespace-nowrap">
                        {at ? at.toLocaleString() : "…"}
                      </td>
                      <td className="text-slate-700">
                        <div className="flex flex-col gap-1">
                          <span>{r.userEmail || r.userId}</span>
                          {r.source === "ai" && (
                            <span className="badge badge-plain badge-info w-fit">
                              <span className="inline-flex items-center gap-1">
                                <Sparkles size={12} />
                                Ask InnPilot
                              </span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="font-medium text-slate-800">{r.action}</td>
                      <td>
                        <span className={`badge ${entityBadge[r.entity] ?? "badge-neutral"}`}>
                          <span className="inline-flex items-center gap-1">
                            {entityIcon[r.entity]}
                            {r.entity}
                          </span>
                        </span>
                      </td>
                      <td className="text-slate-500 max-w-md truncate">{r.details || "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <div className="empty-icon"><ShieldCheck size={24} /></div>
                      <p className="empty-title">No audit entries</p>
                      <p className="empty-desc">
                        {rows.length ? "Nothing matches your filters." : "Actions across the platform will be recorded here."}
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
