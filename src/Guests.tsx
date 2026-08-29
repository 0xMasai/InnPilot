"use client";
// Guest profiles derived from booking history.
// There is no separate "guests" collection: profiles are grouped from
// bookings (by phone number, falling back to name), so this page needs no
// data migration and can never drift out of sync with bookings.
import { useEffect, useMemo, useState } from "react";
import { onSnapshot, Timestamp } from "firebase/firestore";
import { hotelCollection } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Users, BedDouble, Phone } from "lucide-react";
import { COLLECTIONS, type BookingStatus } from "./lib/collections";
import { bookingStatusOf, isRevenueBooking, toDateSafe } from "./lib/metrics";

interface BookingDoc {
  id?: string;
  guestName?: string;
  guestPhoneNumber?: string;
  roomNumber?: unknown;
  roomType?: string;
  checkIn?: unknown;
  checkOut?: unknown;
  pricePaid?: number;
  paymentStatus?: string;
  status?: BookingStatus;
  isOccupied?: boolean;
  notes?: string;
}

interface GuestProfile {
  key: string;
  name: string;
  phone: string;
  stays: number;
  totalSpent: number;
  outstanding: number;
  lastStay: Date | null;
  inHouse: boolean;
  bookings: BookingDoc[];
}

const statusBadge: Record<BookingStatus, string> = {
  Confirmed: "badge-info",
  "Checked In": "badge-success",
  "Checked Out": "badge-neutral",
  Cancelled: "badge-danger",
  "No Show": "badge-warning",
};

export default function GuestsDashboard() {
  const { hotelId } = useAuth();
  const [bookings, setBookings] = useState<BookingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GuestProfile | null>(null);

  useEffect(() => {
    if (!hotelId) return;
    const unsub = onSnapshot(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), (snap) => {
      setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as BookingDoc) })));
      setLoading(false);
    });
    return () => unsub();
  }, [hotelId]);

  const guests = useMemo(() => {
    const map = new Map<string, GuestProfile>();

    for (const b of bookings) {
      const name = (b.guestName || "").trim();
      if (!name) continue;
      const phone = (b.guestPhoneNumber || "").trim();
      const key = phone || `name:${name.toLowerCase()}`;

      let g = map.get(key);
      if (!g) {
        g = {
          key,
          name,
          phone,
          stays: 0,
          totalSpent: 0,
          outstanding: 0,
          lastStay: null,
          inHouse: false,
          bookings: [],
        };
        map.set(key, g);
      }

      g.bookings.push(b);
      g.name = name; // keep the most recent spelling
      if (phone) g.phone = phone;

      const st = bookingStatusOf(b);
      if (isRevenueBooking(b)) {
        g.stays += 1;
        const amount = Number(b.pricePaid) || 0;
        g.totalSpent += amount;
        if ((b.paymentStatus || "").toLowerCase() === "pending") g.outstanding += amount;
      }
      if (st === "Checked In") g.inHouse = true;

      const d = toDateSafe(b.checkIn);
      if (d && (!g.lastStay || d > g.lastStay)) g.lastStay = d;
    }

    const list = [...map.values()];
    for (const g of list) {
      g.bookings.sort(
        (a, b) => (toDateSafe(b.checkIn)?.getTime() ?? 0) - (toDateSafe(a.checkIn)?.getTime() ?? 0)
      );
    }
    list.sort((a, b) => (b.lastStay?.getTime() ?? 0) - (a.lastStay?.getTime() ?? 0));
    return list;
  }, [bookings]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return guests;
    return guests.filter(
      (g) => g.name.toLowerCase().includes(q) || g.phone.toLowerCase().includes(q)
    );
  }, [guests, search]);

  const formatDate = (v: unknown) => {
    const d = v instanceof Date ? v : v instanceof Timestamp ? v.toDate() : toDateSafe(v);
    return d ? d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "-";
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Guests</h2>
          <p className="page-subtitle">Guest profiles, stay history and balances — built from bookings.</p>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Guests</span>
            <span className="stat-icon"><Users size={19} /></span>
          </div>
          <div className="stat-value">{guests.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">In-house Now</span>
            <span className="stat-icon is-success"><BedDouble size={19} /></span>
          </div>
          <div className="stat-value">{guests.filter((g) => g.inHouse).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Returning Guests</span>
            <span className="stat-icon is-purple"><Users size={19} /></span>
          </div>
          <div className="stat-value">{guests.filter((g) => g.stays > 1).length}</div>
        </div>
      </div>

      {/* SEARCH */}
      <div className="filter-bar">
        <div className="search-wrap">
          <Search size={16} />
          <input
            type="text"
            aria-label="Search guests"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>
        <p className="mt-3 text-sm muted">
          Showing <strong className="text-slate-700">{filtered.length}</strong> of <strong className="text-slate-700">{guests.length}</strong> guests
        </p>
      </div>

      {/* GUESTS TABLE */}
      <div className="card card-pad">
        <h2 className="section-title mb-4">All Guests</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Phone</th>
                <th>Stays</th>
                <th>Total Spent</th>
                <th>Outstanding</th>
                <th>Last Stay</th>
                <th>Status</th>
                <th className="text-center">Profile</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 0 ? 120 : 70 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length ? (
                filtered.map((g) => (
                  <tr key={g.key}>
                    <td className="font-medium text-slate-800">{g.name}</td>
                    <td className="text-slate-500">{g.phone || "-"}</td>
                    <td>{g.stays}</td>
                    <td className="font-medium">UGX {g.totalSpent.toLocaleString()}</td>
                    <td>
                      {g.outstanding > 0 ? (
                        <span className="badge badge-warning">UGX {g.outstanding.toLocaleString()}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-slate-500 whitespace-nowrap">{g.lastStay ? formatDate(g.lastStay) : "-"}</td>
                    <td>
                      {g.inHouse ? (
                        <span className="badge badge-success">In-house</span>
                      ) : (
                        <span className="badge badge-neutral">—</span>
                      )}
                    </td>
                    <td className="text-center">
                      <button onClick={() => setSelected(g)} className="btn btn-secondary btn-sm">
                        View
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-icon"><Users size={24} /></div>
                      <p className="empty-title">No guests found</p>
                      <p className="empty-desc">
                        {guests.length ? "No guests match your search." : "Guests appear here automatically once bookings are created."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* GUEST PROFILE MODAL */}
      <AnimatePresence>
        {selected && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelected(null)}
          >
            <motion.div
              className="modal-panel max-w-3xl"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={`Guest profile: ${selected.name}`}
            >
              <div className="modal-header">
                <div>
                  <h2 className="modal-title">{selected.name}</h2>
                  {selected.phone && (
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                      <Phone size={12} /> {selected.phone}
                    </p>
                  )}
                </div>
                <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="stat-card" style={{ padding: 14 }}>
                    <span className="stat-label">Stays</span>
                    <div className="stat-value" style={{ fontSize: 20 }}>{selected.stays}</div>
                  </div>
                  <div className="stat-card" style={{ padding: 14 }}>
                    <span className="stat-label">Total Spent</span>
                    <div className="stat-value" style={{ fontSize: 20 }}>UGX {selected.totalSpent.toLocaleString()}</div>
                  </div>
                  <div className="stat-card" style={{ padding: 14 }}>
                    <span className="stat-label">Outstanding</span>
                    <div className="stat-value" style={{ fontSize: 20 }}>UGX {selected.outstanding.toLocaleString()}</div>
                  </div>
                  <div className="stat-card" style={{ padding: 14 }}>
                    <span className="stat-label">Status</span>
                    <div style={{ marginTop: 6 }}>
                      {selected.inHouse ? (
                        <span className="badge badge-success">In-house</span>
                      ) : (
                        <span className="badge badge-neutral">Not in-house</span>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="section-title mb-3">Stay history</h3>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Room</th>
                          <th>Type</th>
                          <th>Check-in</th>
                          <th>Check-out</th>
                          <th>Amount</th>
                          <th>Payment</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.bookings.map((b, i) => {
                          const st = bookingStatusOf(b);
                          return (
                            <tr key={b.id ?? i}>
                              <td className="font-medium">{String(b.roomNumber ?? "-")}</td>
                              <td>{b.roomType ?? "-"}</td>
                              <td className="text-slate-500 whitespace-nowrap">{formatDate(b.checkIn)}</td>
                              <td className="text-slate-500 whitespace-nowrap">{formatDate(b.checkOut)}</td>
                              <td className="font-medium">
                                {b.pricePaid ? `UGX ${Number(b.pricePaid).toLocaleString()}` : "-"}
                              </td>
                              <td>
                                <span className={`badge ${(b.paymentStatus || "").toLowerCase() === "paid" ? "badge-success" : "badge-warning"}`}>
                                  {b.paymentStatus ?? "-"}
                                </span>
                              </td>
                              <td><span className={`badge ${statusBadge[st]}`}>{st}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
