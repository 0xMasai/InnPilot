"use client";
import { useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
// import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import { Plus, X } from "lucide-react";
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

const rooms = ["Room A", "Room B", "Room C", "Room D"];

export default function ConferenceRoomDashboard() {
  const [open, setOpen] = useState(false);
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
  // const [availability, setAvailability] = useState({
  //   total: rooms.length,
  //   occupied: 0,
  //   free: rooms.length,
  // });

  /* 🔍 SEARCH & FILTER STATE */
  const [search, setSearch] = useState("");
  const [filterRoom, setFilterRoom] = useState("All");
  const [filterMinPrice, setFilterMinPrice] = useState<number | "">("");
  const [filterMaxPrice, setFilterMaxPrice] = useState<number | "">("");

  // Firestore listener
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const bookingsQuery = query(
      collection(db, "conferenceRooms"),
      where("userId", "==", user.uid)
    );

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

      // Count currently occupied rooms based on duration and createdAt
      // const now = new Date();
      // const occupiedRooms = data.filter((b) => {
      //   const start = new Date(b.startTime);
      //   const durationMs = Number(b.durationHours) * 60 * 60 * 1000;
      //   const end = new Date(start.getTime() + durationMs);
      //   return now >= start && now <= end;
      // }).length;

      // setAvailability({
      //   total: rooms.length,
      //   occupied: occupiedRooms,
      //   free: rooms.length - occupiedRooms,
      // });
    });

    return () => unsub();
  }, []);

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

    try {
      await addDoc(collection(db, "conferenceRooms"), {
        organizerName: formData.organizerName,
        email: formData.email,
        room: formData.room,
        attendees: Number(formData.attendees),
        durationHours: Number(formData.durationHours),
        price: Number(formData.price),
        notes: formData.notes,
        userId: user.uid,
        createdAt: Timestamp.now(),
      });

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
    win.document.write(`<h2 style="font-family:sans-serif;">Welcome to Jamiz Hotel</h2>`);
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
    <div className="min-h-screen bg-linear-to-br from-gray-100 to-gray-200 p-6">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-4xl font-bold text-gray-900 tracking-tight">
            Conference Room Dashboard
          </h2>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl shadow hover:bg-blue-700 transition-all"
          >
            <Plus className="w-5 h-5" /> Add Booking
          </button>
        </div>

        {/* MODAL */}
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-white rounded-2xl p-8 shadow-xl w-full max-w-2xl relative"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
              >
                <button
                  className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
                  onClick={() => setOpen(false)}
                >
                  <X className="w-6 h-6" />
                </button>

                <h2 className="text-2xl font-bold mb-6 text-gray-800">
                  New Conference Booking
                </h2>

                <form className="space-y-6" onSubmit={handleSubmit}>
                  {/* Organizer & Email */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <input
                      type="text"
                      name="organizerName"
                      placeholder="Organizer Name"
                      value={formData.organizerName}
                      onChange={handleChange}
                      required
                      className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <input
                      type="email"
                      name="email"
                      placeholder="Email (optional)"
                      value={formData.email}
                      onChange={handleChange}
                      className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <input
                      type="tel"
                      name="phoneNumber"
                      placeholder="Phone Number"
                      value={formData.phoneNumber}
                      onChange={handleChange}
                      className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg"
                    />
                  </div>

                  {/* Room & Duration/Price */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <select
                      name="room"
                      value={formData.room}
                      onChange={handleChange}
                      required
                      className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="" disabled>Select Room</option>
                      {rooms.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>

                    <input
                      type="number"
                      name="durationHours"
                      placeholder="Duration (hrs)"
                      value={formData.durationHours}
                      onChange={handleChange}
                      className="p-3 border-2 border-blue-500 bg-blue-50 rounded-lg text-blue-900"
                    />
                    <input
                      type="number"
                      name="price"
                      placeholder="Price (UGX)"
                      value={formData.price}
                      onChange={handleChange}
                      className="p-3 border-2 border-blue-500 bg-blue-50 rounded-lg text-blue-900"
                    />
                  </div>

                  {/* Notes */}
                  <textarea
                    name="notes"
                    placeholder="Notes"
                    value={formData.notes}
                    onChange={handleChange}
                    className="p-3 w-full h-28 border-2 border-blue-500 bg-blue-50 rounded-lg text-blue-900 outline-none focus:ring-2 focus:ring-blue-200"
                  />

                  <button
                    type="submit"
                    className="w-full bg-blue-600 py-3 rounded-xl text-white font-semibold hover:bg-blue-700 transition"
                  >
                    Save Booking
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SEARCH & FILTER */}
        <div className="bg-white/95 backdrop-blur-md p-6 rounded-xl text-blue-900 shadow-lg border border-blue-400 mb-8">
          <h3 className="text-lg font-semibold text-blue-900 mb-6">Search & Filter Bookings</h3>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <input
              type="text"
              placeholder="Search organizer or room..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
            />
            <select
              value={filterRoom}
              onChange={(e) => setFilterRoom(e.target.value)}
              className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
            >
              <option value="All">All Rooms</option>
              {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input
              type="number"
              placeholder="Min Price"
              value={filterMinPrice}
              onChange={(e) => setFilterMinPrice(e.target.value === "" ? "" : Number(e.target.value))}
              className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
            />
            <input
              type="number"
              placeholder="Max Price"
              value={filterMaxPrice}
              onChange={(e) => setFilterMaxPrice(e.target.value === "" ? "" : Number(e.target.value))}
              className="p-3 border-2 border-blue-500 bg-blue-50 rounded-lg"
            />
          </div>
          <p className="mt-4 text-sm text-blue-900">
            Showing <strong>{filteredBookings.length}</strong> of <strong>{bookings.length}</strong> bookings
          </p>
        </div>

        {/* TABLE */}
        <div className="bg-white/95 backdrop-blur-md p-6 rounded-xl shadow-lg border border-blue-400">
          <h2 className="text-xl font-semibold mb-6 text-blue-900">Recent Bookings</h2>
          <div className="overflow-hidden border border-blue-300 rounded-xl">
            <table className="w-full text-left">
              <thead className="bg-blue-100 text-blue-900">
                <tr>
                  <th className="px-4 py-3 border-b">Organizer</th>
                  <th className="px-4 py-3 border-b">Phone</th>
                  <th className="px-4 py-3 border-b">Room</th>
                  <th className="px-4 py-3 border-b">Time</th>
                  <th className="px-4 py-3 border-b">Duration</th>
                  <th className="px-4 py-3 border-b">Price</th>
                  <th className="px-4 py-3 border-b text-center">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {filteredBookings.length ? filteredBookings.map((b, i) => (
                  <tr key={b.id} className={`border-b hover:bg-blue-50 ${i % 2 === 0 ? "bg-white" : "bg-blue-50/50"}`}>
                    <td className="px-4 py-3 text-blue-900">{b.organizerName}</td>
                    <td className="px-4 py-3 text-blue-900">
                      {b.phoneNumber || "-"}
                    </td>

                    <td className="px-4 py-3 text-blue-900">{b.room}</td>
                    <td className="px-4 py-3 text-blue-900">{new Date(b.startTime).toLocaleString()}</td>
                    <td className="px-4 py-3 text-blue-900">{b.durationHours} hr(s)</td>
                    <td className="px-4 py-3 text-blue-900">{Number(b.price).toLocaleString()} UGX</td>
                    <td className="px-4 py-3 text-blue-900 text-center">
                      <button
                        onClick={() => printBooking(b)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                      >
                        Print
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="text-center py-8">No bookings match your filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
