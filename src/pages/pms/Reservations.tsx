import { useEffect, useMemo, useState } from "react";
import { addDoc, onSnapshot, serverTimestamp, Timestamp } from "firebase/firestore";
import { CalendarPlus, Search } from "lucide-react";
import { COLLECTIONS, ACTIVE_BOOKING_STATUSES, type BookingStatus } from "../../lib/collections";
import { hotelCollection } from "../../lib/hotelScope";
import { bookingOverlaps, bookingDays, toPMSDate, money } from "../../lib/pms";
import { useAuth } from "../../auth/AuthProvider";

interface Booking { id?: string; roomNumber?: string; guestName?: string; roomType?: string; checkIn?: any; checkOut?: any; status?: BookingStatus; }
interface Room { id?: string; number: string; type?: string; price?: number; status: string; }

export default function Reservations() {
  const { hotelId, user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guestName, setGuestName] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [source, setSource] = useState("Direct");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hotelId) return;
    const a = onSnapshot(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), s => setBookings(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Booking, "id">) }))));
    const b = onSnapshot(hotelCollection(hotelId, COLLECTIONS.ROOMS), s => setRooms(s.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Room, "id">) }))));
    return () => { a(); b(); };
  }, [hotelId]);

  const availableRooms = useMemo(() => rooms.filter(r => r.status !== "Maintenance" && r.status !== "Out of Service"), [rooms]);

  const createReservation = async () => {
    setError("");
    if (!hotelId || !user) return setError("Your hotel session is not ready.");
    if (!guestName.trim() || !roomNumber || !checkIn || !checkOut) return setError("Guest, room, check-in and check-out are required.");
    const start = new Date(`${checkIn}T14:00:00`);
    const end = new Date(`${checkOut}T11:00:00`);
    if (end <= start) return setError("Check-out must be after check-in.");
    const conflict = bookingOverlaps(roomNumber, start, end, bookings);
    if (conflict) return setError(`Room ${roomNumber} is already reserved for ${conflict.guestName || "another guest"}.`);
    const room = rooms.find(r => r.number === roomNumber);
    if (!room) return setError("Select a valid room.");
    setSaving(true);
    try {
      await addDoc(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), {
        guestName: guestName.trim(), roomNumber, roomType: room.type || "Room", numberOfGuests: 1,
        checkIn: Timestamp.fromDate(start), checkOut: Timestamp.fromDate(end), status: "Confirmed" as BookingStatus,
        paymentStatus: "Pending", pricePaid: 0, bookingSource: source, ratePerNight: Number(room.price || 0),
        totalAmount: Number(room.price || 0) * bookingDays(start, end), userId: user.uid, createdAt: serverTimestamp()
      });
      setGuestName(""); setRoomNumber(""); setCheckIn(""); setCheckOut("");
    } catch (e) { console.error(e); setError("Reservation could not be saved."); }
    finally { setSaving(false); }
  };

  return <section className="space-y-6">
    <header><h1 className="page-title">Reservations</h1><p className="page-subtitle">Create protected reservations and prevent double-booking.</p></header>
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 font-semibold"><CalendarPlus size={18}/> New reservation</div>
        <input className="input" placeholder="Guest name" value={guestName} onChange={e => setGuestName(e.target.value)} />
        <select className="input" value={roomNumber} onChange={e => setRoomNumber(e.target.value)}><option value="">Select room</option>{availableRooms.map(r => <option key={r.id} value={r.number}>{r.number} · {r.type || "Room"} · {money(r.price)}</option>)}</select>
        <label className="block text-xs font-medium text-slate-500">Check-in<input className="input mt-1" type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></label>
        <label className="block text-xs font-medium text-slate-500">Check-out<input className="input mt-1" type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} /></label>
        <select className="input" value={source} onChange={e => setSource(e.target.value)}><option>Direct</option><option>Walk-in</option><option>Phone</option><option>Website</option><option>Booking.com</option><option>Expedia</option><option>Travel Agent</option></select>
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <button className="btn btn-primary w-full" disabled={saving} onClick={createReservation}>{saving ? "Saving…" : "Confirm reservation"}</button>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Upcoming reservations</h2><p className="text-xs text-slate-500">Confirmed bookings currently blocking room inventory.</p></div><Search size={18} className="text-slate-400"/></div>
        <div className="divide-y divide-slate-100">{bookings.filter(b => ACTIVE_BOOKING_STATUSES.includes(b.status as BookingStatus)).slice(0, 25).map(b => <div key={b.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium">{b.guestName || "Guest"}</p><p className="text-xs text-slate-500">Room {b.roomNumber || "—"} · {b.roomType || "—"}</p></div><div className="text-right"><p className="text-sm font-medium">{toPMSDate(b.checkIn)?.toLocaleDateString() || "—"} → {toPMSDate(b.checkOut)?.toLocaleDateString() || "—"}</p><span className="text-xs text-slate-500">{b.status}</span></div></div>)}{bookings.length === 0 && <p className="p-8 text-sm text-slate-500">No reservations yet.</p>}</div>
      </div>
    </div>
  </section>;
}
