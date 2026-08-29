import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../../firebase";
import { Hotel, CheckCircle2, Clock, Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { HotelDoc } from "../../types/models";
import { toDateSafe } from "../../lib/metrics";

interface HotelRow extends HotelDoc {
  id: string;
}

export default function SuperAdminOverview() {
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "hotels"), (snap) => {
      setHotels(snap.docs.map((d) => ({ id: d.id, ...(d.data() as HotelDoc) })));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const stats = useMemo(() => {
    const active = hotels.filter((h) => h.subscription?.status === "active").length;
    const trial = hotels.filter((h) => h.subscription?.plan === "trial").length;
    const pastDue = hotels.filter((h) =>
      h.subscription?.status === "past_due" || h.subscription?.status === "suspended"
    ).length;
    return { total: hotels.length, active, trial, pastDue };
  }, [hotels]);

  const recent = useMemo(
    () =>
      [...hotels]
        .sort((a, b) => (toDateSafe(b.createdAt)?.getTime() ?? 0) - (toDateSafe(a.createdAt)?.getTime() ?? 0))
        .slice(0, 6),
    [hotels]
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h2 className="page-title">Platform Overview</h2>
          <p className="page-subtitle">Every hotel on HotelMS, at a glance.</p>
        </div>
        <Link to="/super-admin/hotels" className="btn btn-primary btn-sm">
          <Hotel size={15} /> Manage Hotels
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Hotels</span>
            <span className="stat-icon"><Building2 size={19} /></span>
          </div>
          <div className="stat-value">{loading ? "—" : stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Active Subscriptions</span>
            <span className="stat-icon is-success"><CheckCircle2 size={19} /></span>
          </div>
          <div className="stat-value">{loading ? "—" : stats.active}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">On Trial</span>
            <span className="stat-icon is-warning"><Clock size={19} /></span>
          </div>
          <div className="stat-value">{loading ? "—" : stats.trial}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Past Due / Suspended</span>
            <span className="stat-icon is-warning"><Clock size={19} /></span>
          </div>
          <div className="stat-value">{loading ? "—" : stats.pastDue}</div>
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="section-title mb-3">Recently added hotels</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Hotel</th>
                <th>Location</th>
                <th>Plan</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: 100 }} /></td>
                    ))}
                  </tr>
                ))
              ) : recent.length ? (
                recent.map((h) => (
                  <tr key={h.id}>
                    <td className="font-medium text-slate-800">
                      <Link to={`/super-admin/hotels/${h.id}`} className="hover:underline">{h.name}</Link>
                    </td>
                    <td className="text-slate-500">{h.location}</td>
                    <td className="capitalize">{h.subscription?.plan ?? "—"}</td>
                    <td>
                      <span className={`badge ${h.subscription?.status === "active" ? "badge-success" : "badge-warning"}`}>
                        {h.subscription?.status ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <div className="empty-icon"><Hotel size={24} /></div>
                      <p className="empty-title">No hotels yet</p>
                      <p className="empty-desc">Create your first hotel to get started.</p>
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
