import { useEffect, useMemo, useState } from "react";
import { addDoc, getDoc, onSnapshot, serverTimestamp, Timestamp } from "firebase/firestore";
import { CalendarPlus, Search } from "lucide-react";
import { COLLECTIONS, ACTIVE_BOOKING_STATUSES, type BookingStatus } from "../../lib/collections";
import { hotelCollection, hotelDocRef } from "../../lib/hotelScope";
import { bookingOverlaps, bookingDays, toPMSDate, money } from "../../lib/pms";
import { useAuth } from "../../auth/AuthProvider";

interface Booking {
  id?: string;
  reservationId?: string;
  roomNumber?: string;
  guestName?: string;
  roomType?: string;
  checkIn?: any;
  checkOut?: any;
  status?: BookingStatus;
}

interface Room {
  id?: string;
  number: string;
  type?: string;
  price?: number;
  status: string;
}

const makeReservationId = () => {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()
    : Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RSV-${stamp}-${suffix}`;
};

export default function Reservations() {
  const { hotelId, user, role, loading: authLoading } = useAuth();
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

    const reservationsUnsub = onSnapshot(
      hotelCollection(hotelId, COLLECTIONS.RESERVATIONS),
      (snapshot) => {
        setBookings(
          snapshot.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Booking, "id">),
          }))
        );
      },
      (err) => {
        console.error("Reservation listener failed", {
          code: err.code,
          path: `hotels/${hotelId}/${COLLECTIONS.RESERVATIONS}`,
        });
        setError("Reservations could not be loaded. Check your hotel access.");
      }
    );

    const roomsUnsub = onSnapshot(
      hotelCollection(hotelId, COLLECTIONS.ROOMS),
      (snapshot) => {
        setRooms(
          snapshot.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Room, "id">),
          }))
        );
      },
      (err) => {
        console.error("Room listener failed", {
          code: err.code,
          path: `hotels/${hotelId}/${COLLECTIONS.ROOMS}`,
        });
      }
    );

    return () => {
      reservationsUnsub();
      roomsUnsub();
    };
  }, [hotelId]);

  const availableRooms = useMemo(
    () => rooms.filter((r) => r.status !== "Maintenance" && r.status !== "Out of Service"),
    [rooms]
  );

  const createReservation = async () => {
    setError("");

    if (authLoading) return setError("Your hotel session is still loading. Please try again.");
    if (!user) return setError("You must be signed in to create a reservation.");
    if (role !== "hotel_admin" && role !== "staff") {
      return setError("Your account is not approved for hotel operations.");
    }
    if (!hotelId) return setError("Your account has no hotel assigned. Ask an administrator to assign your hotel.");
    if (!guestName.trim() || !roomNumber || !checkIn || !checkOut) {
      return setError("Guest, room, check-in and check-out are required.");
    }

    const start = new Date(`${checkIn}T14:00:00`);
    const end = new Date(`${checkOut}T11:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return setError("Check-out must be after check-in.");
    }

    const room = rooms.find((r) => r.number === roomNumber);
    if (!room) return setError("Select a valid room from this hotel's inventory.");
    if (room.status === "Maintenance" || room.status === "Out of Service") {
      return setError(`Room ${room.number} is unavailable for reservations.`);
    }

    const conflict = bookingOverlaps(roomNumber, start, end, bookings);
    if (conflict) {
      return setError(`Room ${roomNumber} is already reserved for ${conflict.guestName || "another guest"}.`);
    }

    setSaving(true);
    try {
      // Fail clearly when the authenticated profile points at a missing hotel.
      const hotelSnap = await getDoc(hotelDocRef(hotelId));
      if (!hotelSnap.exists()) {
        throw new Error(`Hotel ${hotelId} does not exist.`);
      }

      const reservationId = makeReservationId();
      const payload = {
        reservationId,
        guestName: guestName.trim(),
        roomNumber,
        roomType: room.type || "Room",
        numberOfGuests: 1,
        checkIn: Timestamp.fromDate(start),
        checkOut: Timestamp.fromDate(end),
        status: "Confirmed" as BookingStatus,
        paymentStatus: "Pending" as const,
        pricePaid: 0,
        bookingSource: source,
        ratePerNight: Number(room.price || 0),
        totalAmount: Number(room.price || 0) * bookingDays(start, end),
        hotelId,
        userId: user.uid,
        createdAt: serverTimestamp(),
      };

      const path = `hotels/${hotelId}/${COLLECTIONS.RESERVATIONS}`;
      const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.RESERVATIONS), payload);

      console.info("Reservation created", {
        uid: user.uid,
        role,
        hotelId,
        path: `${path}/${ref.id}`,
        payloadKeys: Object.keys(payload),
        status: payload.status,
      });

      setGuestName("");
      setRoomNumber("");
      setCheckIn("");
      setCheckOut("");
    } catch (e: any) {
      const code = e?.code || "unknown";
      console.error("Reservation creation failed", {
        code,
        message: e?.message || String(e),
        uid: user.uid,
        role,
        hotelId,
        path: `hotels/${hotelId}/${COLLECTIONS.RESERVATIONS}`,
        status: "Confirmed",
      });

      if (code === "permission-denied") {
        setError("Firestore denied this reservation. Confirm your account has the correct hotelId and role.");
      } else if (code === "failed-precondition") {
        setError("Firestore rejected the reservation because a required database precondition is not met.");
      } else if (code === "unavailable") {
        setError("Firestore is temporarily unavailable. Check your connection and try again.");
      } else {
        setError(e?.message || "Reservation could not be saved.");
      }
    } finally {
      setSaving(false);
    }
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
        <button className="btn btn-primary w-full" disabled={saving || authLoading} onClick={createReservation}>{saving ? "Saving…" : "Confirm reservation"}</button>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Upcoming reservations</h2><p className="text-xs text-slate-500">Confirmed bookings currently blocking room inventory.</p></div><Search size={18} className="text-slate-400"/></div>
        <div className="divide-y divide-slate-100">{bookings.filter(b => ACTIVE_BOOKING_STATUSES.includes(b.status as BookingStatus)).slice(0, 25).map(b => <div key={b.id} className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium">{b.guestName || "Guest"}</p><p className="text-xs text-slate-500">Room {b.roomNumber || "—"} · {b.roomType || "—"}</p></div><div className="text-right"><p className="text-sm font-medium">{toPMSDate(b.checkIn)?.toLocaleDateString() || "—"} → {toPMSDate(b.checkOut)?.toLocaleDateString() || "—"}</p><span className="text-xs text-slate-500">{b.status}</span></div></div>)}{bookings.length === 0 && <p className="p-8 text-sm text-slate-500">No reservations yet.</p>}</div>
      </div>
    </div>
  </section>;
}
