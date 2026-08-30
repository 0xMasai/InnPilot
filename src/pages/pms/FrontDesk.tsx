import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { CalendarCheck2, LogIn, LogOut } from "lucide-react";
import { COLLECTIONS } from "../../lib/collections";
import { hotelCollection } from "../../lib/hotelScope";
import { toPMSDate, isSameDay, money } from "../../lib/pms";
import { useAuth } from "../../auth/AuthProvider";

type Booking = { id: string; guestName?: string; roomNumber?: string; checkIn?: any; checkOut?: any; status?: string; pricePaid?: number; paymentStatus?: string };

export default function FrontDesk() {
  const { hotelId } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();

  useEffect(() => {
    if (!hotelId) return;
    return onSnapshot(
      hotelCollection(hotelId, COLLECTIONS.RESERVATIONS),
      (snap) => {
        setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Booking, "id">) })));
        setLoading(false);
      },
      (err) => {
        console.error("Front desk reservation listener failed", {
          code: err.code,
          path: `hotels/${hotelId}/${COLLECTIONS.RESERVATIONS}`,
        });
        setLoading(false);
      }
    );
  }, [hotelId]);

  const arrivals = useMemo(() => bookings.filter((b) => b.status === "Confirmed" && isSameDay(toPMSDate(b.checkIn), today)), [bookings]);
  const departures = useMemo(() => bookings.filter((b) => b.status === "Checked In" && isSameDay(toPMSDate(b.checkOut), today)), [bookings]);
  const inHouse = useMemo(() => bookings.filter((b) => b.status === "Checked In"), [bookings]);
  const outstanding = useMemo(() => bookings.filter((b) => b.status === "Checked In" || b.status === "Confirmed").reduce((sum, b) => sum + (b.paymentStatus === "Paid" ? 0 : Number(b.pricePaid || 0)), 0), [bookings]);

  const List = ({ title, items, icon }: { title: string; items: Booking[]; icon: React.ReactNode }) => <div className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center gap-2 border-b border-slate-100 p-4"><span className="rounded-lg bg-slate-50 p-2">{icon}</span><div><h2 className="font-semibold text-slate-900">{title}</h2><p className="text-xs text-slate-500">{items.length} today</p></div></div>{items.length === 0 ? <p className="p-6 text-sm text-slate-500">Nothing scheduled.</p> : <div className="divide-y divide-slate-100">{items.map((b) => <div key={b.id} className="flex items-center justify-between gap-3 p-4"><div><p className="font-medium text-slate-800">{b.guestName || "Guest"}</p><p className="text-xs text-slate-500">Room {b.roomNumber || "—"}</p></div><span className="text-xs font-medium text-slate-500">{toPMSDate(b.checkIn)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "—"}</span></div>)}</div>}</div>;

  return <section className="space-y-6"><header><h1 className="page-title">Front Desk</h1><p className="page-subtitle">Today's arrivals, departures and guest balances.</p></header><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Arrivals</p><p className="mt-1 text-2xl font-bold">{arrivals.length}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Departures</p><p className="mt-1 text-2xl font-bold">{departures.length}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">In-house</p><p className="mt-1 text-2xl font-bold">{inHouse.length}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Unsettled</p><p className="mt-1 text-lg font-bold">{money(outstanding)}</p></div></div>{loading ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">Loading front desk…</div> : <div className="grid gap-5 lg:grid-cols-2"><List title="Today's arrivals" items={arrivals} icon={<LogIn size={18} />} /><List title="Today's departures" items={departures} icon={<LogOut size={18} />} /></div>}<div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><div className="flex items-center gap-2 font-medium text-slate-800"><CalendarCheck2 size={17} /> Operational rule</div><p className="mt-1">Use Reservations for protected booking records; use the Front Desk for the day's work, Room Board for live room state, and Accommodation for legacy booking management.</p></div></section>;
}
