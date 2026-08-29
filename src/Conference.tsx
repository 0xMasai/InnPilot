"use client";
import { useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { addDoc, onSnapshot, Timestamp, serverTimestamp } from "firebase/firestore";
import { auth } from "../firebase";
import { COLLECTIONS } from "./lib/collections";
import { hotelCollection } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import { logAction } from "./lib/audit";
import { Plus, X, Printer, Search, Briefcase, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Booking {
  id?: string;
  organizerName: string;
  email?: string;
  phoneNumber?: string;
  room: string;
  attendees: number | string;
  startTime: string; // ISO string from createdAt
  durationHours: number | string;
  price: number | string;
  notes?: string;
  userId: string;
}

interface ConferenceRoom {
  id?: string;
  name: string;
  capacity?: number;
  hourlyRate?: number;
}

/** Fallback until the hotel registers its own rooms. */
const DEFAULT_ROOMS = ["Room A", "Room B", "Room C", "Room D"];

export default function ConferenceRoomDashboard() {
  const { hotelId } = useAuth();
  const [open, setOpen] = useState(false);
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [roomList, setRoomList] = useState<ConferenceRoom[]>([]);
  const [roomForm, setRoomForm] = useState<ConferenceRoom>({ name: "" });
  const [roomError, setRoomError] = useState("");
  const [formData, setFormData] = useState<Booking>({
    organizerName: "",
    email: "",
    phoneNumber: "",
    room: "",
    attendees: "",
    startTime: "",
    durationHours: "",
    price: "",
    notes: "",
    userId: auth.currentUser?.uid || "",
  });

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  /* 🔍 SEARCH & FILTER STATE */
  const [search, setSearch] = useState("");
  const [filterRoom, setFilterRoom] = useState("All");
  const [filterMinPrice, setFilterMinPrice] = useState<number | "">("");
  const [filterMaxPrice, setFilterMaxPrice] = useState<number | "">("");

  // Firestore listener — shared operational data: every staff member sees
  // all conference bookings (userId still recorded for accountability).
  useEffect(() => {
    if (!hotelId) return;
    const bookingsQuery = hotelCollection(hotelId, COLLECTIONS.CONFERENCE);

    const unsub = onSnapshot(bookingsQuery, (snapshot) => {
      const data = snapshot.docs.map((doc) => {
        const raw = doc.data() as Booking & { createdAt: Timestamp };
        return {
          id: doc.id,
          ...raw,
          startTime: raw.createdAt?.toDate()?.toISOString() || "", // always string
        };
      });

      setBookings(data);
      setLoading(false);
    });

    return () => unsub();
  }, [hotelId]);

  // Conference room inventory (falls back to defaults until rooms are added).
  useEffect(() => {
    if (!hotelId) return;
    const unsub = onSnapshot(hotelCollection(hotelId, COLLECTIONS.CONFERENCE_SPACES), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ConferenceRoom) }));
      data.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      setRoomList(data);
    });
    return () => unsub();
  }, [hotelId]);

  const rooms = roomList.length ? roomList.map((r) => r.name) : DEFAULT_ROOMS;

  // Add a conference room to the inventory
  const handleRoomSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setRoomError("");
    const name = roomForm.name.trim();
    if (!name) return setRoomError("Enter a room name.");
    if (roomList.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      return setRoomError(`"${name}" already exists.`);
    }
    if (!hotelId) return setRoomError("No hotel context — please sign in again.");
    try {
      const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.CONFERENCE_SPACES), {
        name,
        capacity: Number(roomForm.capacity) || 0,
        hourlyRate: Number(roomForm.hourlyRate) || 0,
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || "unknown",
      });
      logAction(hotelId, "Conference room added", "room", ref.id, name);
      setRoomModalOpen(false);
      setRoomForm({ name: "" });
    } catch (err) {
      console.error(err);
      setRoomError("Failed to add room. Please try again.");
    }
  };

  // FILTER LOGIC
  const filteredBookings = bookings.filter((b) => {
    const matchesSearch =
      b.organizerName.toLowerCase().includes(search.toLowerCase()) ||
      b.room.toLowerCase().includes(search.toLowerCase());
    const matchesRoom = filterRoom === "All" || b.room === filterRoom;
    const matchesMin = filterMinPrice === "" || Number(b.price) >= filterMinPrice;
    const matchesMax = filterMaxPrice === "" || Number(b.price) <= filterMaxPrice;
    return matchesSearch && matchesRoom && matchesMin && matchesMax;
  });

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return alert("You must be logged in to book a room.");
    if (!formData.organizerName || !formData.room || !formData.durationHours)
      return alert("Please fill all required fields.");

    if (!hotelId) return alert("No hotel context — please sign in again.");

    try {
      const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.CONFERENCE), {
        organizerName: formData.organizerName,
        email: formData.email,
        phoneNumber: formData.phoneNumber ?? "",
        room: formData.room,
        attendees: Number(formData.attendees),
        durationHours: Number(formData.durationHours),
        price: Number(formData.price),
        notes: formData.notes,
        userId: user.uid,
        createdAt: Timestamp.now(),
      });
      logAction(hotelId, "Event booked", "event", ref.id, `${formData.organizerName} · ${formData.room} · UGX ${Number(formData.price).toLocaleString()}`);

      setOpen(false);
      setFormData({
        organizerName: "",
        email: "",
        room: "",
        attendees: "",
        startTime: "",
        durationHours: "",
        price: "",
        notes: "",
        userId: user.uid,
      });
    } catch (err) {
      console.error(err);
      alert("Failed to book room.");
    }
  };

  const printBooking = (b: Booking) => {
    const win = window.open("", "PRINT", "height=600,width=400");
    if (!win) return;
    const start = new Date(b.startTime);
    const end = new Date(start.getTime() + Number(b.durationHours) * 60 * 60 * 1000);
    win.document.write(`<html><head><title>Booking Confirmation</title></head><body>`);
    win.document.write(`<h2 style="font-family:sans-serif;">Welcome to Our Hotel</h2>`);
    win.document.write(`<h3 style="font-family:sans-serif;">Conference Room Booking</h3>`);
    win.document.write(`<p><strong>Organizer:</strong> ${b.organizerName}</p>`);
    win.document.write(`<p><strong>Room:</strong> ${b.room}</p>`);
    win.document.write(`<p><strong>Date & Time:</strong> ${start.toLocaleString()} – ${end.toLocaleTimeString()}</p>`);
    win.document.write(`<p><strong>Duration:</strong> ${b.durationHours} hour(s)</p>`);
    win.document.write(`<p><strong>Price:</strong> ${Number(b.price).toLocaleString()} UGX</p>`);
    win.document.write(`<p><strong>Notes:</strong> ${b.notes || "-"}</p>`);
    win.document.write(`</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Conference</h2>
          <p className="page-subtitle">Organize meeting spaces and event bookings.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setRoomModalOpen(true)} className="btn btn-secondary">
            <Plus className="w-4 h-4" /> Add Room
          </button>
          <button onClick={() => setOpen(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" /> New Booking
          </button>
        </div>
      </div>

      {/* ADD ROOM MODAL */}
      <AnimatePresence>
        {roomModalOpen && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setRoomModalOpen(false)}
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
              aria-label="Add conference room"
            >
              <div className="modal-header">
                <h2 className="modal-title">Add Conference Room</h2>
                <button className="icon-btn" onClick={() => setRoomModalOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-5" onSubmit={handleRoomSubmit}>
                <div>
                  <label className="field-label">Room name<span className="req">*</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Boardroom, Main Hall"
                    value={roomForm.name}
                    onChange={(e) => setRoomForm((p) => ({ ...p, name: e.target.value }))}
                    required
                    className="input"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="field-label">Capacity (people)</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="e.g. 40"
                      value={roomForm.capacity ?? ""}
                      onChange={(e) => setRoomForm((p) => ({ ...p, capacity: e.target.value === "" ? undefined : Number(e.target.value) }))}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="field-label">Rate (UGX/hr)</label>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={roomForm.hourlyRate ?? ""}
                      onChange={(e) => setRoomForm((p) => ({ ...p, hourlyRate: e.target.value === "" ? undefined : Number(e.target.value) }))}
                      className="input"
                    />
                  </div>
                </div>

                {roomError && <p className="text-sm text-rose-600">{roomError}</p>}

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" className="btn btn-secondary" onClick={() => setRoomModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Add Room</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="modal-panel max-w-2xl"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="New conference booking"
            >
              <div className="modal-header">
                <h2 className="modal-title">New Conference Booking</h2>
                <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-5" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="field-label">Organizer name<span className="req">*</span></label>
                    <input type="text" name="organizerName" placeholder="Organizer name" value={formData.organizerName} onChange={handleChange} required className="input" />
                  </div>
                  <div>
                    <label className="field-label">Email</label>
                    <input type="email" name="email" placeholder="Optional" value={formData.email} onChange={handleChange} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Phone number</label>
                    <input type="tel" name="phoneNumber" placeholder="+256 7xx xxx xxx" value={formData.phoneNumber} onChange={handleChange} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Room<span className="req">*</span></label>
                    <select name="room" value={formData.room} onChange={handleChange} required className="select">
                      <option value="" disabled>Select room</option>
                      {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Duration (hrs)<span className="req">*</span></label>
                    <input type="number" name="durationHours" placeholder="e.g. 3" value={formData.durationHours} onChange={handleChange} className="input" />
                  </div>
                  <div>
                    <label className="field-label">Price (UGX)</label>
                    <input type="number" name="price" placeholder="0" value={formData.price} onChange={handleChange} className="input" />
                  </div>
                </div>

                <div>
                  <label className="field-label">Notes</label>
                  <textarea name="notes" placeholder="Additional details" value={formData.notes} onChange={handleChange} className="textarea" />
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Booking</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ROOM INVENTORY */}
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Conference Rooms</h2>
          {!roomList.length && (
            <span className="text-sm muted">
              No rooms registered yet — using default room names until you add your own.
            </span>
          )}
        </div>
        {roomList.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {roomList.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{r.name}</span>
                  <Briefcase size={15} className="text-slate-400" />
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <Users size={12} />
                  {r.capacity ? `${r.capacity} people` : "Capacity not set"}
                  {r.hourlyRate ? ` · ${Number(r.hourlyRate).toLocaleString()} UGX/hr` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SEARCH & FILTER */}
      <div className="filter-bar">
        <h3 className="section-title mb-3">Search &amp; filter</h3>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Search bookings" placeholder="Search organizer or room…" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
          </div>
          <select value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)} className="select" aria-label="Room">
            <option value="All">All rooms</option>
            {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input type="number" placeholder="Min price" value={filterMinPrice} onChange={(e) => setFilterMinPrice(e.target.value === "" ? "" : Number(e.target.value))} className="input" aria-label="Minimum price" />
          <input type="number" placeholder="Max price" value={filterMaxPrice} onChange={(e) => setFilterMaxPrice(e.target.value === "" ? "" : Number(e.target.value))} className="input" aria-label="Maximum price" />
        </div>
        <p className="mt-3 text-sm muted">
          Showing <strong className="text-slate-700">{filteredBookings.length}</strong> of <strong className="text-slate-700">{bookings.length}</strong> bookings
        </p>
      </div>

      {/* TABLE */}
      <div className="card card-pad">
        <h2 className="section-title mb-4">Recent Bookings</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Organizer</th>
                <th>Phone</th>
                <th>Room</th>
                <th>Time</th>
                <th>Duration</th>
                <th>Price</th>
                <th className="text-center">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: 80 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredBookings.length ? (
                filteredBookings.map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium text-slate-800">{b.organizerName}</td>
                    <td className="text-slate-500">{b.phoneNumber || "-"}</td>
                    <td><span className="badge badge-info badge-plain">{b.room}</span></td>
                    <td className="text-slate-500 whitespace-nowrap">{new Date(b.startTime).toLocaleString()}</td>
                    <td>{b.durationHours} hr(s)</td>
                    <td className="font-medium">{Number(b.price).toLocaleString()} UGX</td>
                    <td className="text-center">
                      <button onClick={() => printBooking(b)} className="btn btn-secondary btn-sm">
                        <Printer size={15} /> Print
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-icon"><Briefcase size={24} /></div>
                      <p className="empty-title">No bookings found</p>
                      <p className="empty-desc">
                        {bookings.length ? "No bookings match your current filters." : "Book your first conference room and it will appear here."}
                      </p>
                      {!bookings.length && (
                        <button className="btn btn-primary btn-sm mt-2" onClick={() => setOpen(true)}>
                          <Plus size={15} /> New Booking
                        </button>
                      )}
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
