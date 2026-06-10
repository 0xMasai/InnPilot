"use client";
import { useMemo, useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  Timestamp,
  doc,
  updateDoc,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import { Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Booking {
  id?: string;
  roomNumber?: string;
  guestName: string;
  guestPhoneNumber?: string;
  roomType: string;
  numberOfGuests?: number;
  checkIn?: Date;
  checkOut?: Date;
  pricePaid?: number;
  paymentStatus: "Paid" | "Pending";
  notes?: string;
  isOccupied: boolean;
  currentBookingId?: string | null;
  userId?: string;
}

const roomTypes = [
  { type: "Single" },
  { type: "Double" },
  { type: "Suite" },
];

export default function AccommodationDashboard() {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<Booking>({
    guestName: "",
    guestPhoneNumber: "",
    roomType: "Single",
    paymentStatus: "Paid",
    notes: "",
    isOccupied: false,
    currentBookingId: null,
  });

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [availability, setAvailability] = useState({
    total: 15,
    occupied: 0,
    free: 15,
  });

  // Search & filter states
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"All" | "Single" | "Double" | "Suite">("All");
  const [filterPayment, setFilterPayment] = useState<"All" | "Paid" | "Pending">("All");
  const [filterOccupied, setFilterOccupied] = useState<"All" | "Occupied" | "Free">("All");

  // 🔄 Real-time Firestore listener
  useEffect(() => {
    const user = auth.currentUser;
    const q = user
      ? query(collection(db, "accomodation"), where("userId", "==", user.uid))
      : collection(db, "accomodation");

    const unsub = onSnapshot(q, async (snapshot) => {
      const data: Booking[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Booking),
      }));

      const now = new Date();

      for (const d of data) {
        if (d.checkOut instanceof Timestamp) {
          const checkoutDate = d.checkOut.toDate();
          if (checkoutDate < now && d.isOccupied) {
            try {
              await updateDoc(doc(db, "accomodation", d.id!), {
                isOccupied: false,
                currentBookingId: null,
              });
            } catch (err) {
              console.error("Failed auto-release booking:", err);
            }
          }
        }
      }

      setBookings(data);

      const occupiedCount = data.filter((b) => b.isOccupied).length;
      const totalRooms = 15;
      setAvailability({
        total: totalRooms,
        occupied: occupiedCount,
        free: totalRooms - occupiedCount,
      });
    });

    

    return () => unsub();
  }, []);

  // Input change handler
  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    const numericFields = ["numberOfGuests", "pricePaid", "roomNumber"];
    setFormData((prev) => ({
      ...prev,
      [name]: numericFields.includes(name) ? Number(value) || undefined : value,
    }));
  };

  // Submit booking
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.guestName.trim()) return alert("Enter guest name.");
    if (!formData.checkIn || !formData.checkOut) return alert("Select dates.");

    try {
      await addDoc(collection(db, "accomodation"), {
        ...formData,
        roomNumber: formData.roomNumber || 0,
        numberOfGuests: formData.numberOfGuests || 1,
        pricePaid: formData.pricePaid || 0,
        checkIn: Timestamp.fromDate(formData.checkIn),
        checkOut: Timestamp.fromDate(formData.checkOut),
        userId: auth.currentUser?.uid || "anonymous",
        isOccupied: formData.paymentStatus === "Paid",
        currentBookingId: formData.paymentStatus === "Paid" ? "active" : null,
      });

      setOpen(false);
      setFormData({
        guestName: "",
        guestPhoneNumber: "",
        roomType: "Single",
        paymentStatus: "Paid",
        notes: "",
        isOccupied: false,
        currentBookingId: null,
      });
    } catch (err) {
      console.log(err);
      alert("Failed to save booking.");
    }
  };

  const formatDate = (timestamp: any) =>
    timestamp instanceof Timestamp
      ? timestamp.toDate().toLocaleString()
      : timestamp?.toLocaleString() || "-";

  // Filtered bookings
  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      const matchesSearch =
        q === "" ||
        b.guestName?.toLowerCase().includes(q) ||
        b.guestPhoneNumber?.toLowerCase().includes(q) ||
        String(b.roomNumber ?? "").includes(q);
      const matchesType = filterType === "All" ? true : b.roomType === filterType;
      const matchesPayment = filterPayment === "All" ? true : b.paymentStatus === filterPayment;
      const matchesOccupied =
        filterOccupied === "All"
          ? true
          : filterOccupied === "Occupied"
          ? b.isOccupied
          : !b.isOccupied;
      return matchesSearch && matchesType && matchesPayment && matchesOccupied;
    });
  }, [bookings, search, filterType, filterPayment, filterOccupied]);

  // const resetFilters = () => {
  //   setSearch("");
  //   setFilterType("All");
  //   setFilterPayment("All");
  //   setFilterOccupied("All");
  // };
const printBooking = (b: Booking) => {
  const win = window.open("", "PRINT", "height=600,width=400");
  if (!win) return;

  win.document.write(`<html><head><title>Booking Receipt</title></head><body>`);
  win.document.write(`<h2 style="font-family:sans-serif;">Welcome to Jamiz Hotel</h2>`);
  win.document.write(`<h3 style="font-family:sans-serif;">Booking Receipt</h3>`);

  win.document.write(`<p><strong>Room:</strong> ${b.roomNumber ?? "-"}</p>`);
  win.document.write(`<p><strong>Guest:</strong> ${b.guestName}</p>`);
  win.document.write(`<p><strong>Type:</strong> ${b.roomType}</p>`);
  win.document.write(`<p><strong>Check-in:</strong> ${formatDate(b.checkIn)}</p>`);
  win.document.write(`<p><strong>Check-out:</strong> ${formatDate(b.checkOut)}</p>`);
  win.document.write(`<p><strong>Amount Paid:</strong> ${b.pricePaid ? b.pricePaid.toLocaleString() + " UGX" : "-"}</p>`);
  win.document.write(`<p><strong>Payment Status:</strong> ${b.paymentStatus}</p>`);
  win.document.write(`<p><strong>Occupied:</strong> ${b.isOccupied ? "✅ Yes" : "❌ No"}</p>`);

  win.document.write(`</body></html>`);
  win.document.close();
  win.focus();
  win.print();
};


  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* HEADER + ADD BUTTON */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold text-gray-900">Accommodation Dashboard</h2>
        <button
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          onClick={() => setOpen(true)}
        >
          <Plus className="w-4 h-4" /> Add Booking
        </button>
      </div>

      {/* MODAL */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-white rounded-lg p-6 w-full max-w-2xl relative text-black shadow-lg
                        max-h-[90vh] overflow-y-auto pr-2"
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              transition={{ duration: 0.25 }}
            >

              <button
                className="absolute top-3 right-3 text-gray-600 hover:text-gray-800"
                onClick={() => setOpen(false)}
              >
                <X className="w-5 h-5" />
              </button>
              <h2 className="text-xl font-bold mb-4 text-blue-900">New Accommodation Booking</h2>

            <form
  className="space-y-6 bg-white p-6 rounded-2xl shadow-md"
  onSubmit={handleSubmit}
>
  {/* Guest & Room Info */}
  <div className="space-y-3">
    <h3 className="text-lg font-semibold text-blue-800">
      Guest & Room Information
    </h3>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <input
        type="text"
        name="roomNumber"
        placeholder="Room Number (e.g. A12)"
        value={formData.roomNumber}
        onChange={handleChange}
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          placeholder-blue-400 focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />

      <input
        type="text"
        name="guestName"
        placeholder="Guest Full Name"
        value={formData.guestName}
        onChange={handleChange}
        required
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          placeholder-blue-400 focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />

      <input
        type="tel"
        name="guestPhoneNumber"
        placeholder="Phone Number"
        value={formData.guestPhoneNumber ?? ""}
        onChange={handleChange}
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          placeholder-blue-400 focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />
    </div>
  </div>

  {/* Room Details */}
  <div className="space-y-3">
    <h3 className="text-lg font-semibold text-blue-800">
      Room Details
    </h3>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <select
        name="roomType"
        value={formData.roomType}
        onChange={handleChange}
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
      >
        {roomTypes.map((r) => (
          <option key={r.type} value={r.type}>
            {r.type}
          </option>
        ))}
      </select>

      <input
        type="number"
        name="numberOfGuests"
        placeholder="Number of Guests"
        value={formData.numberOfGuests ?? ""}
        onChange={handleChange}
        min={1}
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          placeholder-blue-400 focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />
    </div>
  </div>

  {/* Check-in / Check-out */}
  <div className="space-y-3">
    <h3 className="text-lg font-semibold text-blue-800">
      Stay Duration
    </h3>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Flatpickr
        value={formData.checkIn || undefined}
        onChange={(dates) =>
          setFormData((prev) => ({ ...prev, checkIn: dates[0] }))
        }
        options={{ enableTime: true, dateFormat: "Y-m-d H:i", static: true }}
        placeholder="Check-in Date & Time"
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          cursor-pointer focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />

      <Flatpickr
        value={formData.checkOut || undefined}
        onChange={(dates) =>
          setFormData((prev) => ({ ...prev, checkOut: dates[0] }))
        }
        options={{ enableTime: true, dateFormat: "Y-m-d H:i", static: true }}
        placeholder="Check-out Date & Time"
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          cursor-pointer focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />
    </div>
  </div>

  {/* Payment */}
  <div className="space-y-3">
    <h3 className="text-lg font-semibold text-blue-800">
      Payment Information
    </h3>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <input
        type="number"
        name="pricePaid"
        placeholder="Amount Paid (UGX)"
        value={formData.pricePaid ?? ""}
        onChange={handleChange}
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          placeholder-blue-400 focus:outline-none focus:ring-2
          focus:ring-blue-400 transition"
      />

      <select
        name="paymentStatus"
        value={formData.paymentStatus}
        onChange={handleChange}
        className="p-3 rounded-xl border border-blue-300 text-blue-900
          focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
      >
        <option value="Paid">Paid</option>
        <option value="Pending">Pending</option>
      </select>
    </div>
  </div>

  {/* Notes */}
  <div className="space-y-2">
    <h3 className="text-lg font-semibold text-blue-800">
      Additional Notes
    </h3>

    <textarea
      name="notes"
      placeholder="Any special requests or remarks"
      value={formData.notes ?? ""}
      onChange={handleChange}
      className="p-3 w-full h-28 rounded-xl border border-blue-300
        text-blue-900 placeholder-blue-400 focus:outline-none
        focus:ring-2 focus:ring-blue-400 transition"
    />
  </div>

  {/* Submit */}
  <button
    type="submit"
    className="w-full bg-blue-600 text-white py-3 rounded-xl
      font-semibold hover:bg-blue-700 active:scale-[0.99]
      transition"
  >
    Save Booking
  </button>
</form>



            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AVAILABILITY CARDS */}
      <div className="grid grid-cols-3 gap-6 mb-6">
        <div className="stat-card bg-blue-50 text-blue-900">
          <p className="text-lg font-semibold">Total Rooms</p>
          <p className="text-3xl font-bold">{availability.total}</p>
        </div>
        <div className="stat-card bg-red-50 text-red-900">
          <p className="text-lg font-semibold">Occupied</p>
          <p className="text-3xl font-bold">{availability.occupied}</p>
        </div>
        <div className="stat-card bg-green-50 text-green-900">
          <p className="text-lg font-semibold">Free</p>
          <p className="text-3xl font-bold">{availability.free}</p>
        </div>
      </div>

      {/* SEARCH + FILTERS */}
      <div className="bg-white/90 backdrop-blur-md p-6 rounded-xl shadow-md border border-blue-300 mb-6">
  <h3 className="text-lg font-semibold text-blue-900 mb-4">Search & Filter</h3>

  <div className="flex flex-col md:flex-row md:items-center md:gap-4">
    <input
      type="text"
      placeholder="Search by guest name, email or room..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="w-full md:flex-1 mb-3 md:mb-0 p-3 rounded-xl border border-blue-300 text-blue-900 placeholder-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
    />

    <div className="grid grid-cols-3 gap-3 md:w-2/3 md:ml-4">
      <select
        value={filterType}
        onChange={(e) => setFilterType(e.target.value as any)}
        className="p-3 rounded-xl border border-blue-300 text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
      >
        <option value="All">All Room Types</option>
        <option value="Single">Single</option>
        <option value="Double">Double</option>
        <option value="Suite">Suite</option>
      </select>

      <select
        value={filterPayment}
        onChange={(e) => setFilterPayment(e.target.value as any)}
        className="p-3 rounded-xl border border-blue-300 text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
      >
        <option value="All">All Payments</option>
        <option value="Paid">Paid</option>
        <option value="Pending">Pending</option>
      </select>

      <select
        value={filterOccupied}
        onChange={(e) => setFilterOccupied(e.target.value as any)}
        className="p-3 rounded-xl border border-blue-300 text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
      >
        <option value="All">All Rooms</option>
        <option value="Occupied">Occupied</option>
        <option value="Free">Free</option>
      </select>
    </div>
  </div>

  <div className="mt-4 flex items-center justify-between">
    <p className="text-sm text-blue-900">
      Showing <strong>{filteredBookings.length}</strong> of <strong>{bookings.length}</strong> bookings
    </p>
    {/* <button
      onClick={resetFilters}
      className="px-4 py-2 rounded-xl border border-blue-300 text-blue-900 hover:bg-blue-50 transition"
    >
      Reset
    </button> */}
  </div>
      </div>


      {/* BOOKINGS TABLE */}
  <div className="bg-white/95 backdrop-blur-md p-6 rounded-xl shadow-lg border border-blue-200">
  <h2 className="text-xl font-semibold mb-6 text-blue-900">Recent Bookings</h2>

  <div className="overflow-x-auto rounded-lg">
    <table className="w-full text-left">
      <thead className="bg-blue-100 text-blue-900">
        <tr>
          <th className="px-4 py-3 border-b">Room</th>
          <th className="px-4 py-3 border-b">Guest</th>
          <th className="px-4 py-3 border-b">Phone</th>
          <th className="px-4 py-3 border-b">Type</th>
          <th className="px-4 py-3 border-b">Check-in</th>
          <th className="px-4 py-3 border-b">Check-out</th>
          <th className="px-4 py-3 border-b">Amount</th>
          <th className="px-4 py-3 border-b">Status</th>
          <th className="px-4 py-3 border-b text-center">Occupied</th>
          <th className="px-4 py-3 border-b text-center">Receipt</th>
        </tr>
      </thead>

      <tbody>
        {filteredBookings.length ? (
          filteredBookings.map((b, i) => (
            <tr
              key={b.id}
              className={`border-b hover:bg-blue-50 ${
                i % 2 === 0 ? "bg-white" : "bg-blue-50/50"
              }`}
            >
              <td className="px-4 py-3 text-blue-900">{b.roomNumber ?? "-"}</td>
              <td className="px-4 py-3 text-blue-900">{b.guestName}</td>
              <td className="px-4 py-3 text-blue-900">
                {b.guestPhoneNumber || "-"}
              </td>

              <td className="px-4 py-3 text-blue-900">{b.roomType}</td>
              <td className="px-4 py-3 text-blue-900">{formatDate(b.checkIn)}</td>
              <td className="px-4 py-3 text-blue-900">{formatDate(b.checkOut)}</td>
              <td className="px-4 py-3 text-blue-900">{b.pricePaid ? b.pricePaid.toLocaleString() + " UGX" : "-"}</td>
              <td className="px-4 py-3 text-blue-900">{b.paymentStatus}</td>
              <td className="px-4 py-3 text-blue-900 text-center">{b.isOccupied ? "✅ Yes" : "❌ No"}</td>
              <td className="px-4 py-3 text-center">
                <button
                  onClick={() => printBooking(b)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                >
                  Print
                </button>
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={9} className="text-center py-6 text-blue-900">
              No bookings match your search/filters.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>

  {/* PRINT FUNCTION */}
  <script>
    {`
      function printBooking(b) {
        const win = window.open("", "PRINT", "height=600,width=400");
        if (!win) return;
        win.document.write('<html><head><title>Booking Receipt</title></head><body>');
        win.document.write('<h2 style="font-family:sans-serif;">Hotel Booking Receipt</h2>');
        win.document.write('<p><strong>Room:</strong> ' + (b.roomNumber ?? "-") + '</p>');
        win.document.write('<p><strong>Guest:</strong> ' + b.guestName + '</p>');
        win.document.write('<p><strong>Type:</strong> ' + b.roomType + '</p>');
        win.document.write('<p><strong>Check-in:</strong> ' + b.checkIn + '</p>');
        win.document.write('<p><strong>Check-out:</strong> ' + b.checkOut + '</p>');
        win.document.write('<p><strong>Amount:</strong> ' + (b.pricePaid?.toLocaleString() + " UGX" ?? "-") + '</p>');
        win.document.write('<p><strong>Status:</strong> ' + b.paymentStatus + '</p>');
        win.document.write('<p><strong>Occupied:</strong> ' + (b.isOccupied ? "Yes" : "No") + '</p>');
        win.document.write('</body></html>');
        win.document.close();
        win.focus();
        win.print();
      }
    `}
  </script>
</div>




      {/* extra styles */}
      <style>{`
        .input { @apply p-2 border rounded border-gray-300 text-gray-900; }
        .stat-card { @apply p-5 rounded shadow text-center; }
        .th { @apply p-2 border text-left text-gray-900; }
        .td { @apply p-2 border text-gray-900; }
      `}</style>
    </div>
  );
}
