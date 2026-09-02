import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { BedDouble, Brush, CheckCircle2, Wrench } from "lucide-react";
import { COLLECTIONS, type BookingStatus, type RoomStatus } from "../../lib/collections";
import { hotelCollection } from "../../lib/hotelScope";
import {
  roomBookingState,
  toPMSDate,
  type PMSBookingLike,
  type RoomBookingState,
} from "../../lib/pms";
import { useAuth } from "../../auth/AuthProvider";

type Room = { id: string; number: string; type?: string; status: RoomStatus; price?: number };
type Booking = {
  id: string;
  roomNumber?: string;
  guestName?: string;
  status?: BookingStatus;
  checkIn?: PMSBookingLike["checkIn"];
  checkOut?: PMSBookingLike["checkOut"];
};

const statusMeta: Record<RoomStatus, { label: string; icon: typeof BedDouble }> = {
  Available: { label: "Ready", icon: CheckCircle2 },
  Occupied: { label: "Occupied", icon: BedDouble },
  Cleaning: { label: "Cleaning", icon: Brush },
  Maintenance: { label: "Maintenance", icon: Wrench },
  "Out of Service": { label: "Out of service", icon: Wrench },
};

export default function RoomBoard() {
  const { hotelId } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hotelId) return;
    const roomUnsub = onSnapshot(hotelCollection(hotelId, COLLECTIONS.ROOMS), (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Room, "id">) }));
      next.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
      setRooms(next);
      setLoading(false);
    });
    const bookingUnsub = onSnapshot(hotelCollection(hotelId, COLLECTIONS.RESERVATIONS), (snap) => {
      setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Booking, "id">) })));
    });
    return () => { roomUnsub(); bookingUnsub(); };
  }, [hotelId]);

  /**
   * What the reservations say about each room, kept separate from the room
   * document's own status. A room is Ready/Cleaning/Maintenance as a physical
   * fact; a reservation over it is a commercial one. Deriving this here means
   * a booking made anywhere — this PMS, the Accommodation page, or a WebMCP
   * agent — shows on the board immediately, without any screen writing a
   * fake "Occupied" onto the room record.
   */
  const stateByRoom = useMemo(() => {
    const map = new Map<string, RoomBookingState>();
    for (const room of rooms) map.set(room.number, roomBookingState(room.number, bookings));
    return map;
  }, [rooms, bookings]);
  const counts = useMemo(() => rooms.reduce<Record<string, number>>((acc, room) => { acc[room.status] = (acc[room.status] || 0) + 1; return acc; }, {}), [rooms]);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="page-title">Room Board</h1><p className="page-subtitle">Live room status and in-house guests.</p></div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">{Object.entries(statusMeta).map(([key, meta]) => <span key={key} className="rounded-full border border-slate-200 bg-white px-3 py-1.5">{meta.label}: {counts[key] || 0}</span>)}</div>
      </header>
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-slate-500">Loading rooms…</div> : rooms.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><BedDouble className="mx-auto mb-3 text-slate-400" /><p className="font-semibold text-slate-800">No rooms configured</p><p className="text-sm text-slate-500">Add rooms from Accommodation to populate the board.</p></div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rooms.map((room) => { const meta = statusMeta[room.status]; const Icon = meta.icon; const state = stateByRoom.get(room.number) ?? {}; const guest = state.inHouse; return <article key={room.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Room</p><p className="text-2xl font-bold text-slate-900">{room.number}</p><p className="text-sm text-slate-500">{room.type || "Room"}</p></div><span className="rounded-xl bg-slate-50 p-2 text-slate-600"><Icon size={20} /></span></div><div className="mt-4"><span className="inline-flex rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">{meta.label}</span>{state.inHouse ? <span className="ml-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">In-house</span> : state.arrivingToday ? <span className="ml-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Arrives today</span> : state.nextReservation ? <span className="ml-2 inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">Reserved {toPMSDate(state.nextReservation.checkIn)?.toLocaleDateString() ?? ""}</span> : null}{guest && <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-800">{guest.guestName || "In-house guest"}</p><p className="text-xs text-slate-500">Checked in · room {room.number}</p></div>}{!guest && state.arrivingToday && <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-800">{state.arrivingToday.guestName || "Expected guest"}</p><p className="text-xs text-slate-500">Due in today · not yet checked in</p></div>}</div></article>; })}</div>}
    </section>
  );
}
