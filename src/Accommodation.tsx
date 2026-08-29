"use client";
import { useMemo, useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  addDoc,
  onSnapshot,
  Timestamp,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth } from "../firebase";
import { hotelCollection, hotelDoc } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import {
  Plus,
  X,
  BedDouble,
  DoorClosed,
  DoorOpen,
  Printer,
  SlidersHorizontal,
  Search,
  Brush,
  LogIn,
  LogOut,
  Ban,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  COLLECTIONS,
  ACTIVE_BOOKING_STATUSES,
  ROOM_STATUSES,
  type BookingStatus,
  type RoomStatus,
} from "./lib/collections";
import { bookingStatusOf, getRange, inRange } from "./lib/metrics";
import { logAction } from "./lib/audit";

interface Booking {
  id?: string;
  roomNumber?: string;
  guestName: string;
  guestPhoneNumber?: string;
  roomType: string;
  numberOfGuests?: number;
  checkIn?: Date | Timestamp;
  checkOut?: Date | Timestamp;
  pricePaid?: number;
  paymentStatus: "Paid" | "Pending";
  notes?: string;
  status?: BookingStatus;
  /** Legacy flag kept in sync for older screens. */
  isOccupied?: boolean;
  userId?: string;
}

interface Room {
  id?: string;
  number: string;
  type: string;
  price?: number;
  status: RoomStatus;
}

const roomTypes = ["Single", "Double", "Suite"];

/** Shared derivation (lib/metrics) keeps this page consistent with dashboards. */
const bookingStatus = (b: Booking): BookingStatus => bookingStatusOf(b);

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

const statusBadge: Record<BookingStatus, string> = {
  Confirmed: "badge-info",
  "Checked In": "badge-success",
  "Checked Out": "badge-neutral",
  Cancelled: "badge-danger",
  "No Show": "badge-warning",
};

const roomBadge: Record<RoomStatus, string> = {
  Available: "badge-success",
  Occupied: "badge-info",
  Cleaning: "badge-warning",
  Maintenance: "badge-warning",
  "Out of Service": "badge-danger",
};

export default function AccommodationDashboard() {
  const { hotelId } = useAuth();
  const [open, setOpen] = useState(false);
  const [roomModalOpen, setRoomModalOpen] = useState(false);

  const [formData, setFormData] = useState<Booking>({
    guestName: "",
    guestPhoneNumber: "",
    roomType: "Single",
    paymentStatus: "Paid",
    notes: "",
  });
  const [formError, setFormError] = useState("");

  const [roomForm, setRoomForm] = useState<Room>({
    number: "",
    type: "Single",
    status: "Available",
  });
  const [roomError, setRoomError] = useState("");

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & filter states
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("All");
  const [filterPayment, setFilterPayment] = useState<"All" | "Paid" | "Pending">("All");
  const [filterStatus, setFilterStatus] = useState<string>("All");

  // Shared operational data: all staff at this hotel see all its bookings and rooms.
  useEffect(() => {
    if (!hotelId) return;
    const unsubBookings = onSnapshot(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), (snapshot) => {
      setBookings(
        snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Booking) }))
      );
      setLoading(false);
    });

    const unsubRooms = onSnapshot(hotelCollection(hotelId, COLLECTIONS.ROOMS), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Room) }));
      data.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
      setRooms(data);
    });

    return () => {
      unsubBookings();
      unsubRooms();
    };
  }, [hotelId]);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    const numericFields = ["numberOfGuests", "pricePaid"];
    setFormData((prev) => ({
      ...prev,
      [name]: numericFields.includes(name) ? Number(value) || undefined : value,
    }));
  };

  /** Bookings that block the given room for the given period. */
  const findConflict = (roomNumber: string, checkIn: Date, checkOut: Date) =>
    bookings.find((b) => {
      if (String(b.roomNumber ?? "") !== roomNumber) return false;
      if (!ACTIVE_BOOKING_STATUSES.includes(bookingStatus(b))) return false;
      const s = toDate(b.checkIn);
      const e = toDate(b.checkOut);
      if (!s || !e) return false;
      return overlaps(checkIn, checkOut, s, e);
    });

  // Submit booking
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formData.guestName.trim()) return setFormError("Enter the guest's name.");
    const checkIn = formData.checkIn instanceof Date ? formData.checkIn : null;
    const checkOut = formData.checkOut instanceof Date ? formData.checkOut : null;
    if (!checkIn || !checkOut) return setFormError("Select check-in and check-out dates.");
    if (checkOut <= checkIn) return setFormError("Check-out must be after check-in.");
    if (!formData.roomNumber) return setFormError("Select a room.");

    const room = rooms.find((r) => r.number === formData.roomNumber);
    if (room && (room.status === "Maintenance" || room.status === "Out of Service")) {
      return setFormError(`Room ${room.number} is under ${room.status.toLowerCase()} and cannot be booked.`);
    }

    const conflict = findConflict(String(formData.roomNumber), checkIn, checkOut);
    if (conflict) {
      return setFormError(
        `Room ${formData.roomNumber} is already booked for ${conflict.guestName} over those dates.`
      );
    }

    if (!hotelId) return setFormError("No hotel context — please sign in again.");
    try {
      const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), {
        ...formData,
        roomNumber: formData.roomNumber,
        roomType: room?.type ?? formData.roomType,
        numberOfGuests: formData.numberOfGuests || 1,
        pricePaid: formData.pricePaid || 0,
        checkIn: Timestamp.fromDate(checkIn),
        checkOut: Timestamp.fromDate(checkOut),
        status: "Confirmed" as BookingStatus,
        isOccupied: false,
        userId: auth.currentUser?.uid || "unknown",
        createdAt: serverTimestamp(),
      });
      logAction(hotelId, "Booking created", "booking", ref.id, `${formData.guestName} · room ${formData.roomNumber}`);

      setOpen(false);
      setFormData({
        guestName: "",
        guestPhoneNumber: "",
        roomType: "Single",
        paymentStatus: "Paid",
        notes: "",
      });
    } catch (err) {
      console.error(err);
      setFormError("Failed to save booking. Please try again.");
    }
  };

  // Add a room to the inventory
  const handleRoomSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setRoomError("");
    const number = roomForm.number.trim();
    if (!number) return setRoomError("Enter a room number.");
    if (rooms.some((r) => r.number === number)) {
      return setRoomError(`Room ${number} already exists.`);
    }
    if (!hotelId) return setRoomError("No hotel context — please sign in again.");
    try {
      const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.ROOMS), {
        number,
        type: roomForm.type,
        price: roomForm.price || 0,
        status: roomForm.status,
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || "unknown",
      });
      logAction(hotelId, "Room added", "room", ref.id, `${number} (${roomForm.type})`);
      setRoomModalOpen(false);
      setRoomForm({ number: "", type: "Single", status: "Available" });
    } catch (err) {
      console.error(err);
      setRoomError("Failed to add room. Please try again.");
    }
  };

  const setRoomStatus = async (room: Room, status: RoomStatus) => {
    if (!room.id || room.status === status || !hotelId) return;
    try {
      await updateDoc(hotelDoc(hotelId, COLLECTIONS.ROOMS, room.id), { status });
      logAction(hotelId, "Room status changed", "room", room.id, `${room.number}: ${room.status} → ${status}`);
    } catch (err) {
      console.error("Failed to update room status:", err);
    }
  };

  /** Booking lifecycle transitions; keeps the room's status in sync. */
  const transition = async (b: Booking, status: BookingStatus) => {
    if (!b.id || !hotelId) return;
    try {
      await updateDoc(hotelDoc(hotelId, COLLECTIONS.BOOKINGS, b.id), {
        status,
        isOccupied: status === "Checked In",
      });
      logAction(hotelId, `Booking ${status.toLowerCase()}`, "booking", b.id, `${b.guestName} · room ${b.roomNumber ?? "-"}`);
      const room = rooms.find((r) => r.number === String(b.roomNumber ?? ""));
      if (room?.id) {
        if (status === "Checked In") await setRoomStatus(room, "Occupied");
        if (status === "Checked Out") await setRoomStatus(room, "Cleaning");
        if ((status === "Cancelled" || status === "No Show") && room.status === "Occupied") {
          await setRoomStatus(room, "Available");
        }
      }
    } catch (err) {
      console.error("Failed to update booking:", err);
    }
  };

  const formatDate = (timestamp: any) => {
    const d = toDate(timestamp);
    return d ? d.toLocaleString() : "-";
  };

  // KPI counts — derived from the room inventory when it exists.
  const stats = useMemo(() => {
    if (rooms.length) {
      return {
        total: rooms.length,
        occupied: rooms.filter((r) => r.status === "Occupied").length,
        available: rooms.filter((r) => r.status === "Available").length,
        cleaning: rooms.filter((r) => r.status === "Cleaning").length,
      };
    }
    // Fallback before any rooms are registered: infer from bookings.
    const occupied = bookings.filter((b) => bookingStatus(b) === "Checked In").length;
    return { total: 0, occupied, available: 0, cleaning: 0 };
  }, [rooms, bookings]);

  // Front-desk focus: who arrives today, who is due to leave (or overdue).
  const frontDesk = useMemo(() => {
    const today = getRange("today");
    const arrivals = bookings
      .filter((b) => bookingStatus(b) === "Confirmed" && inRange(toDate(b.checkIn), today))
      .sort((a, b) => (toDate(a.checkIn)?.getTime() ?? 0) - (toDate(b.checkIn)?.getTime() ?? 0));
    const departures = bookings
      .filter((b) => {
        if (bookingStatus(b) !== "Checked In") return false;
        const out = toDate(b.checkOut);
        return !!out && out < today.end; // due out today, or overdue
      })
      .sort((a, b) => (toDate(a.checkOut)?.getTime() ?? 0) - (toDate(b.checkOut)?.getTime() ?? 0));
    return { arrivals, departures };
  }, [bookings]);

  // Filtered bookings
  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      const matchesSearch =
        q === "" ||
        b.guestName?.toLowerCase().includes(q) ||
        b.guestPhoneNumber?.toLowerCase().includes(q) ||
        String(b.roomNumber ?? "").toLowerCase().includes(q);
      const matchesType = filterType === "All" ? true : b.roomType === filterType;
      const matchesPayment = filterPayment === "All" ? true : b.paymentStatus === filterPayment;
      const matchesStatus = filterStatus === "All" ? true : bookingStatus(b) === filterStatus;
      return matchesSearch && matchesType && matchesPayment && matchesStatus;
    });
  }, [bookings, search, filterType, filterPayment, filterStatus]);

  const printBooking = (b: Booking) => {
    const win = window.open("", "PRINT", "height=600,width=400");
    if (!win) return;

    win.document.write(`<html><head><title>Booking Receipt</title></head><body>`);
    win.document.write(`<h2 style="font-family:sans-serif;">Welcome to Our Hotel</h2>`);
    win.document.write(`<h3 style="font-family:sans-serif;">Booking Receipt</h3>`);

    win.document.write(`<p><strong>Room:</strong> ${b.roomNumber ?? "-"}</p>`);
    win.document.write(`<p><strong>Guest:</strong> ${b.guestName}</p>`);
    win.document.write(`<p><strong>Type:</strong> ${b.roomType}</p>`);
    win.document.write(`<p><strong>Check-in:</strong> ${formatDate(b.checkIn)}</p>`);
    win.document.write(`<p><strong>Check-out:</strong> ${formatDate(b.checkOut)}</p>`);
    win.document.write(`<p><strong>Amount Paid:</strong> ${b.pricePaid ? b.pricePaid.toLocaleString() + " UGX" : "-"}</p>`);
    win.document.write(`<p><strong>Payment Status:</strong> ${b.paymentStatus}</p>`);
    win.document.write(`<p><strong>Booking Status:</strong> ${bookingStatus(b)}</p>`);

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
          <h2 className="page-title">Accommodation</h2>
          <p className="page-subtitle">Manage rooms, bookings, check-ins and check-outs.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => setRoomModalOpen(true)}>
            <Plus className="w-4 h-4" /> Add Room
          </button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" /> New Booking
          </button>
        </div>
      </div>

      {/* BOOKING MODAL */}
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
              aria-label="New accommodation booking"
            >
              <div className="modal-header">
                <h2 className="modal-title">New Accommodation Booking</h2>
                <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-6" onSubmit={handleSubmit}>
                {/* Guest & Room Info */}
                <div className="form-section">
                  <h3 className="form-section-title">Guest &amp; room information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="field-label">Room<span className="req">*</span></label>
                      {rooms.length ? (
                        <select
                          name="roomNumber"
                          value={formData.roomNumber ?? ""}
                          onChange={handleChange}
                          className="select"
                          required
                        >
                          <option value="" disabled>Select room…</option>
                          {rooms.map((r) => (
                            <option
                              key={r.id}
                              value={r.number}
                              disabled={r.status === "Maintenance" || r.status === "Out of Service"}
                            >
                              {r.number} · {r.type} ({r.status})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          name="roomNumber"
                          placeholder="e.g. A12"
                          value={formData.roomNumber ?? ""}
                          onChange={handleChange}
                          className="input"
                        />
                      )}
                    </div>
                    <div>
                      <label className="field-label">Guest full name<span className="req">*</span></label>
                      <input type="text" name="guestName" placeholder="Guest name" value={formData.guestName} onChange={handleChange} required className="input" />
                    </div>
                    <div>
                      <label className="field-label">Phone number</label>
                      <input type="tel" name="guestPhoneNumber" placeholder="+256 7xx xxx xxx" value={formData.guestPhoneNumber ?? ""} onChange={handleChange} className="input" />
                    </div>
                  </div>
                </div>

                {/* Room Details */}
                <div className="form-section">
                  <h3 className="form-section-title">Room details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="field-label">Room type</label>
                      <select name="roomType" value={formData.roomType} onChange={handleChange} className="select">
                        {roomTypes.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">Number of guests</label>
                      <input type="number" name="numberOfGuests" placeholder="1" value={formData.numberOfGuests ?? ""} onChange={handleChange} min={1} className="input" />
                    </div>
                  </div>
                </div>

                {/* Check-in / Check-out */}
                <div className="form-section">
                  <h3 className="form-section-title">Stay duration</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="field-label">Check-in<span className="req">*</span></label>
                      <Flatpickr
                        value={formData.checkIn instanceof Date ? formData.checkIn : undefined}
                        onChange={(dates) => setFormData((prev) => ({ ...prev, checkIn: dates[0] }))}
                        options={{ enableTime: true, dateFormat: "Y-m-d H:i", static: true }}
                        placeholder="Select date & time"
                        className="input cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="field-label">Check-out<span className="req">*</span></label>
                      <Flatpickr
                        value={formData.checkOut instanceof Date ? formData.checkOut : undefined}
                        onChange={(dates) => setFormData((prev) => ({ ...prev, checkOut: dates[0] }))}
                        options={{ enableTime: true, dateFormat: "Y-m-d H:i", static: true }}
                        placeholder="Select date & time"
                        className="input cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Payment */}
                <div className="form-section">
                  <h3 className="form-section-title">Payment information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="field-label">Amount paid (UGX)</label>
                      <input type="number" name="pricePaid" placeholder="0" value={formData.pricePaid ?? ""} onChange={handleChange} className="input" />
                    </div>
                    <div>
                      <label className="field-label">Payment status</label>
                      <select name="paymentStatus" value={formData.paymentStatus} onChange={handleChange} className="select">
                        <option value="Paid">Paid</option>
                        <option value="Pending">Pending</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes */}
                <div className="form-section">
                  <label className="field-label">Additional notes</label>
                  <textarea name="notes" placeholder="Any special requests or remarks" value={formData.notes ?? ""} onChange={handleChange} className="textarea" />
                </div>

                {formError && (
                  <div className="text-sm rounded-md px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}>
                    {formError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Booking</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              aria-label="Add room"
            >
              <div className="modal-header">
                <h2 className="modal-title">Add Room</h2>
                <button className="icon-btn" onClick={() => setRoomModalOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form className="p-6 space-y-4" onSubmit={handleRoomSubmit}>
                <div>
                  <label className="field-label">Room number<span className="req">*</span></label>
                  <input
                    type="text"
                    placeholder="e.g. A12"
                    value={roomForm.number}
                    onChange={(e) => setRoomForm((p) => ({ ...p, number: e.target.value }))}
                    required
                    className="input"
                  />
                </div>
                <div>
                  <label className="field-label">Room type</label>
                  <select
                    value={roomForm.type}
                    onChange={(e) => setRoomForm((p) => ({ ...p, type: e.target.value }))}
                    className="select"
                  >
                    {roomTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">Nightly rate (UGX)</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={roomForm.price ?? ""}
                    onChange={(e) => setRoomForm((p) => ({ ...p, price: Number(e.target.value) || undefined }))}
                    className="input"
                  />
                </div>

                {roomError && (
                  <div className="text-sm rounded-md px-3 py-2" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", border: "1px solid var(--danger-border)" }}>
                    {roomError}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" className="btn btn-secondary" onClick={() => setRoomModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Add Room</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AVAILABILITY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Rooms</span>
            <span className="stat-icon"><BedDouble size={19} /></span>
          </div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Occupied</span>
            <span className="stat-icon is-warning"><DoorClosed size={19} /></span>
          </div>
          <div className="stat-value">{stats.occupied}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Available</span>
            <span className="stat-icon is-success"><DoorOpen size={19} /></span>
          </div>
          <div className="stat-value">{stats.available}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Needs Cleaning</span>
            <span className="stat-icon is-orange"><Brush size={19} /></span>
          </div>
          <div className="stat-value">{stats.cleaning}</div>
        </div>
      </div>

      {/* TODAY AT THE FRONT DESK */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-3">
            <LogIn size={17} className="text-blue-600" />
            <h2 className="section-title">Arrivals Today</h2>
            <span className="badge badge-info ml-auto">{frontDesk.arrivals.length}</span>
          </div>
          {frontDesk.arrivals.length ? (
            <div className="space-y-2">
              {frontDesk.arrivals.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{b.guestName}</p>
                    <p className="text-xs text-slate-500">
                      Room {b.roomNumber ?? "-"} · {toDate(b.checkIn)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button onClick={() => transition(b, "Checked In")} className="btn btn-success btn-sm shrink-0">
                    <LogIn size={14} /> Check in
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm muted">No arrivals expected today.</p>
          )}
        </div>

        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-3">
            <LogOut size={17} className="text-orange-600" />
            <h2 className="section-title">Departures Due</h2>
            <span className="badge badge-warning ml-auto">{frontDesk.departures.length}</span>
          </div>
          {frontDesk.departures.length ? (
            <div className="space-y-2">
              {frontDesk.departures.map((b) => {
                const out = toDate(b.checkOut);
                const overdue = !!out && out < new Date();
                return (
                  <div key={b.id} className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{b.guestName}</p>
                      <p className="text-xs text-slate-500">
                        Room {b.roomNumber ?? "-"} · {out?.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        {overdue && <span className="text-rose-600 font-medium"> · overdue</span>}
                      </p>
                    </div>
                    <button onClick={() => transition(b, "Checked Out")} className="btn btn-secondary btn-sm shrink-0">
                      <LogOut size={14} /> Check out
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm muted">No departures due.</p>
          )}
        </div>
      </div>

      {/* ROOM STATUS GRID */}
      <div className="card card-pad">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title">Rooms</h2>
          {!rooms.length && (
            <span className="text-sm muted">No rooms registered yet — add your room inventory to track status and availability.</span>
          )}
        </div>
        {rooms.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {rooms.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{r.number}</span>
                  <span className={`badge ${roomBadge[r.status] ?? "badge-neutral"}`}>{r.status}</span>
                </div>
                <p className="text-xs text-slate-500">
                  {r.type}
                  {r.price ? ` · ${Number(r.price).toLocaleString()} UGX` : ""}
                </p>
                <select
                  value={r.status}
                  onChange={(e) => setRoomStatus(r, e.target.value as RoomStatus)}
                  className="select"
                  style={{ height: 32, fontSize: 12 }}
                  aria-label={`Status for room ${r.number}`}
                >
                  {ROOM_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SEARCH + FILTERS */}
      <div className="filter-bar">
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal size={16} className="text-slate-400" />
          <h3 className="section-title">Search &amp; filter</h3>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="search-wrap flex-1">
            <Search size={16} />
            <input type="text" aria-label="Search bookings" placeholder="Search by guest, phone or room…" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:w-2/3">
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="select" aria-label="Room type">
              <option value="All">All room types</option>
              {roomTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value as any)} className="select" aria-label="Payment status">
              <option value="All">All payments</option>
              <option value="Paid">Paid</option>
              <option value="Pending">Pending</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="select" aria-label="Booking status">
              <option value="All">All statuses</option>
              <option value="Confirmed">Confirmed</option>
              <option value="Checked In">Checked In</option>
              <option value="Checked Out">Checked Out</option>
              <option value="Cancelled">Cancelled</option>
              <option value="No Show">No Show</option>
            </select>
          </div>
        </div>
        <p className="mt-3 text-sm muted">
          Showing <strong className="text-slate-700">{filteredBookings.length}</strong> of <strong className="text-slate-700">{bookings.length}</strong> bookings
        </p>
      </div>

      {/* BOOKINGS TABLE */}
      <div className="card card-pad">
        <h2 className="section-title mb-4">Recent Bookings</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Guest</th>
                <th>Phone</th>
                <th>Type</th>
                <th>Check-in</th>
                <th>Check-out</th>
                <th>Amount</th>
                <th>Payment</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 1 ? 120 : 70 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredBookings.length ? (
                filteredBookings.map((b) => {
                  const st = bookingStatus(b);
                  return (
                    <tr key={b.id}>
                      <td className="font-medium">{b.roomNumber ?? "-"}</td>
                      <td className="font-medium text-slate-800">{b.guestName}</td>
                      <td className="text-slate-500">{b.guestPhoneNumber || "-"}</td>
                      <td>{b.roomType}</td>
                      <td className="text-slate-500 whitespace-nowrap">{formatDate(b.checkIn)}</td>
                      <td className="text-slate-500 whitespace-nowrap">{formatDate(b.checkOut)}</td>
                      <td className="font-medium">{b.pricePaid ? b.pricePaid.toLocaleString() + " UGX" : "-"}</td>
                      <td>
                        <span className={`badge ${b.paymentStatus === "Paid" ? "badge-success" : "badge-warning"}`}>
                          {b.paymentStatus}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${statusBadge[st]}`}>{st}</span>
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                          {st === "Confirmed" && (
                            <>
                              <button onClick={() => transition(b, "Checked In")} className="btn btn-success btn-sm" title="Check guest in">
                                <LogIn size={14} /> Check in
                              </button>
                              <button onClick={() => transition(b, "Cancelled")} className="btn btn-ghost btn-sm" title="Cancel booking">
                                <Ban size={14} />
                              </button>
                            </>
                          )}
                          {st === "Checked In" && (
                            <button onClick={() => transition(b, "Checked Out")} className="btn btn-secondary btn-sm" title="Check guest out">
                              <LogOut size={14} /> Check out
                            </button>
                          )}
                          <button onClick={() => printBooking(b)} className="btn btn-ghost btn-sm" title="Print receipt">
                            <Printer size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10}>
                    <div className="empty-state">
                      <div className="empty-icon"><BedDouble size={24} /></div>
                      <p className="empty-title">No bookings found</p>
                      <p className="empty-desc">
                        {bookings.length ? "No bookings match your current filters." : "Create your first booking and it will appear here."}
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
