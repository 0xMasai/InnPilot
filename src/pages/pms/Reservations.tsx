import { useEffect, useMemo, useState } from "react";
import { getDocsFromServer, onSnapshot } from "firebase/firestore";
import { CalendarPlus, Search } from "lucide-react";
import { COLLECTIONS, ACTIVE_BOOKING_STATUSES, type BookingStatus } from "../../lib/collections";
import { hotelCollection } from "../../lib/hotelScope";
import { availableRoomsForStay, bookableRooms, toPMSDate, money } from "../../lib/pms";
import { useAuth } from "../../auth/AuthProvider";
import {
  createReservation as createReservationService,
  updateReservationStatus as updateReservationStatusService,
} from "../../lib/reservationService";

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

/** The page's Booking rows already satisfy the service's conflict-check shape. */
const toContextBooking = (b: Booking) => ({
  id: b.id ?? "",
  reservationId: b.reservationId,
  roomNumber: b.roomNumber,
  guestName: b.guestName,
  roomType: b.roomType,
  status: b.status,
  checkIn: b.checkIn,
  checkOut: b.checkOut,
});

export default function Reservations() {
  const { hotelId, user, role, loading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [legacyBookings, setLegacyBookings] = useState<Booking[]>([]);
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

    const reservationsPath = `hotels/${hotelId}/${COLLECTIONS.RESERVATIONS}`;
    const legacyPath = `hotels/${hotelId}/${COLLECTIONS.BOOKINGS}`;
    const roomsPath = `hotels/${hotelId}/${COLLECTIONS.ROOMS}`;

    console.info("[Firestore read:start]", {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      uid: user?.uid,
      role,
      hotelId,
      reservationsPath,
      legacyPath,
      roomsPath,
    });

    const reservationsUnsub = onSnapshot(
      hotelCollection(hotelId, COLLECTIONS.RESERVATIONS),
      { includeMetadataChanges: true },
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Booking, "id">) }));
        console.info("[Firestore read:reservations]", {
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          uid: user?.uid,
          role,
          hotelId,
          path: reservationsPath,
          source: snapshot.metadata.fromCache ? "cache" : "server",
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
          documentIds: docs.map((d) => d.id),
          count: docs.length,
        });
        setBookings(docs);
      },
      (err) => {
        console.error("Reservation listener failed", {
          code: err.code,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          uid: user?.uid,
          role,
          hotelId,
          path: reservationsPath,
        });
        setError("Reservations could not be loaded. Check your hotel access.");
      }
    );

    // Legacy booking records remain under accomodation. They are read only
    // for compatibility/conflict detection; new reservations never write there.
    const legacyUnsub = onSnapshot(
      hotelCollection(hotelId, COLLECTIONS.BOOKINGS),
      { includeMetadataChanges: true },
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Booking, "id">) }));
        console.info("[Firestore read:legacy-accommodation]", {
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          uid: user?.uid,
          role,
          hotelId,
          path: legacyPath,
          source: snapshot.metadata.fromCache ? "cache" : "server",
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
          documentIds: docs.map((d) => d.id),
          count: docs.length,
        });
        setLegacyBookings(docs);
      },
      (err) => {
        console.error("Legacy accommodation listener failed", {
          code: err.code,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          uid: user?.uid,
          role,
          hotelId,
          path: legacyPath,
        });
      }
    );

    const roomsUnsub = onSnapshot(
      hotelCollection(hotelId, COLLECTIONS.ROOMS),
      { includeMetadataChanges: true },
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Room, "id">) }));
        console.info("[Firestore read:rooms]", {
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          uid: user?.uid,
          role,
          hotelId,
          path: roomsPath,
          source: snapshot.metadata.fromCache ? "cache" : "server",
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
          documentIds: docs.map((d) => d.id),
          count: docs.length,
        });
        setRooms(docs);
      },
      (err) => {
        console.error("Room listener failed", {
          code: err.code,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          uid: user?.uid,
          role,
          hotelId,
          path: roomsPath,
        });
      }
    );

    // In development, make one explicit server read so we can distinguish
    // a real Firestore result from any client-side snapshot/cache behaviour.
    if (import.meta.env.DEV) {
      getDocsFromServer(hotelCollection(hotelId, COLLECTIONS.RESERVATIONS))
        .then((snapshot) => {
          console.info("[Firestore server verification]", {
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            uid: user?.uid,
            role,
            hotelId,
            path: reservationsPath,
            source: "server",
            documentIds: snapshot.docs.map((d) => d.id),
            count: snapshot.size,
          });
        })
        .catch((err) => {
          console.error("[Firestore server verification failed]", {
            code: err?.code,
            message: err?.message,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            uid: user?.uid,
            role,
            hotelId,
            path: reservationsPath,
          });
        });
    }

    return () => {
      reservationsUnsub();
      legacyUnsub();
      roomsUnsub();
    };
  }, [hotelId, role, user?.uid]);

  /**
   * Rooms offered for the dates in the form. Without both dates this is the
   * whole bookable inventory; once a stay is chosen, rooms already held for
   * any part of it — by a reservation or a legacy booking, made here, on the
   * Accommodation page or by an agent — drop out, so the picker matches the
   * rule createReservation() enforces on submit.
   */
  const availableRooms = useMemo(() => {
    const bookable = bookableRooms(rooms);
    const start = checkIn ? new Date(`${checkIn}T14:00:00`) : null;
    const end = checkOut ? new Date(`${checkOut}T11:00:00`) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return bookable;
    }
    return availableRoomsForStay(bookable, start, end, [...bookings, ...legacyBookings]);
  }, [rooms, bookings, legacyBookings, checkIn, checkOut]);

  const updateReservationStatus = async (booking: Booking, status: BookingStatus) => {
    if (!hotelId || !booking.id || (role !== "hotel_admin" && role !== "staff")) return;
    setError("");
    const result = await updateReservationStatusService(hotelId, booking.id, status);
    if (!result.ok) setError(result.error);
  };

  const createReservation = async () => {
    setError("");

    if (authLoading) return setError("Your hotel session is still loading. Please try again.");
    if (!user) return setError("You must be signed in to create a reservation.");
    if (role !== "hotel_admin" && role !== "staff") {
      return setError("Your account is not approved for hotel operations.");
    }
    if (!hotelId) return setError("Your account has no hotel assigned. Ask an administrator to assign your hotel.");

    setSaving(true);
    try {
      // The live snapshots above are the conflict source, so creating a
      // reservation from the UI still needs no extra reads.
      const result = await createReservationService({
        hotelId,
        uid: user.uid,
        guestName,
        roomNumber,
        checkIn,
        checkOut,
        bookingSource: source,
        context: {
          rooms: rooms.map((r) => ({
            id: r.id ?? "",
            number: r.number,
            type: r.type,
            price: r.price,
            status: r.status,
          })),
          reservations: bookings.map(toContextBooking),
          legacyBookings: legacyBookings.map(toContextBooking),
        },
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setGuestName("");
      setRoomNumber("");
      setCheckIn("");
      setCheckOut("");
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
        <div className="flex items-center justify-between border-b border-slate-100 p-4"><div><h2 className="font-semibold">Upcoming reservations</h2><p className="text-xs text-slate-500">Protected reservations currently blocking room inventory.</p></div><Search size={18} className="text-slate-400"/></div>
        <div className="divide-y divide-slate-100">
          {bookings.filter(b => ACTIVE_BOOKING_STATUSES.includes(b.status as BookingStatus)).slice(0, 25).map(b => (
            <div key={b.id} className="flex items-center justify-between gap-4 p-4">
              <div><p className="font-medium">{b.guestName || "Guest"}</p><p className="text-xs text-slate-500">Room {b.roomNumber || "—"} · {b.roomType || "—"}</p></div>
              <div className="flex items-center gap-3">
                <div className="text-right"><p className="text-sm font-medium">{toPMSDate(b.checkIn)?.toLocaleDateString() || "—"} → {toPMSDate(b.checkOut)?.toLocaleDateString() || "—"}</p><span className="text-xs text-slate-500">{b.status}</span></div>
                {b.status === "Confirmed" && <button className="btn btn-secondary btn-sm" onClick={() => updateReservationStatus(b, "Checked In")}>Check in</button>}
                {b.status === "Checked In" && <button className="btn btn-secondary btn-sm" onClick={() => updateReservationStatus(b, "Checked Out")}>Check out</button>}
                {(b.status === "Confirmed" || b.status === "Checked In") && <button className="btn btn-secondary btn-sm" onClick={() => updateReservationStatus(b, "Cancelled")}>Cancel</button>}
              </div>
            </div>
          ))}
          {bookings.length === 0 && <p className="p-8 text-sm text-slate-500">No reservations yet.</p>}
        </div>
      </div>
    </div>
  </section>;
}
