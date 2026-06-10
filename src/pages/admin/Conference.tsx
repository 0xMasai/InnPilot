"use client";

import { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  // deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db, auth } from "../../../firebase";


import "flatpickr/dist/flatpickr.min.css";

import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";

interface Booking {
  id?: string;
  room: string;
  organizerName: string;
  email: string;
  attendees: number;
  dateTime: string;
  durationHours: number;
  notes: string;
  price: number;
  userId: string;
  createdAt: string;
}

export default function AdminConferenceRoomDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);

  const [searchOrganizer, setSearchOrganizer] = useState("");
  const [searchEmail, setSearchEmail] = useState("");


  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editData, setEditData] = useState<Booking | null>(null);

  // Fetch bookings
  useEffect(() => {
    if (!auth.currentUser) return;

    const ref = collection(db, "conferenceRooms");

    const unsub = onSnapshot(ref, (snapshot) => {
      const data = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Booking),
      }));

      const sorted = data.sort(
        (a, b) =>
          new Date(b.dateTime).getTime() -
          new Date(a.dateTime).getTime()
      );

      setBookings(sorted);
      setFilteredBookings(sorted);
    });

    return () => unsub();
  }, []);

  // Apply filters
  useEffect(() => {
    const filtered = bookings.filter((b) => {
      // const date = new Date(b.dateTime);


      return (
        b.organizerName.toLowerCase().includes(searchOrganizer.toLowerCase()) &&
        b.email.toLowerCase().includes(searchEmail.toLowerCase())
      );
    });

    setFilteredBookings(filtered);
  }, [searchOrganizer, searchEmail, bookings]);

  // Print Report
  const printBooking = () => {
    const printWindow = window.open("", "PRINT", "height=600,width=800");
    if (!printWindow) return;

    printWindow.document.write("<html><head><title>Conference Bookings</title>");
    printWindow.document.write(`
      <style>
        body { color: black; font-family: Arial; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #000; padding: 8px; font-size: 14px; }
        th { background: #f3f4f6; font-weight: bold; }
      </style>
    `);
    printWindow.document.write("</head><body>");
    printWindow.document.write("<h2>Conference Room Bookings</h2>");
    printWindow.document.write("<table>");
    printWindow.document.write(
      "<thead><tr><th>Room</th><th>Organizer</th><th>Email</th><th>Attendees</th><th>Date</th><th>Duration</th><th>Price</th><th>Notes</th></tr></thead>"
    );
    printWindow.document.write("<tbody>");

    filteredBookings.forEach((b) => {
      printWindow.document.write(`
        <tr>
          <td>${b.room}</td>
          <td>${b.organizerName}</td>
          <td>${b.email}</td>
          <td>${b.attendees}</td>
          <td>${new Date(b.dateTime).toLocaleString()}</td>
          <td>${b.durationHours} hrs</td>
          <td>${b.price.toLocaleString()} UGX</td>
          <td>${b.notes || "-"}</td>
        </tr>
      `);
    });

    printWindow.document.write("</tbody></table>");
    printWindow.document.write("</body></html>");
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  // Edit modal handlers
  const openEditModal = (b: Booking) => {
    setEditData(b);
    setIsEditOpen(true);
  };

  const handleEditChange = (field: keyof Booking, value: string | number) => {
    if (!editData) return;
    setEditData({ ...editData, [field]: value });
  };

  const saveEditChanges = async () => {
    if (!editData || !editData.id) return;

    const { id, ...data } = editData;
    await updateDoc(doc(db, "conferenceRooms", id), data);

    alert("Booking updated successfully.");
    setIsEditOpen(false);
  };

  // const deleteBooking = async (id?: string) => {
  //   if (!id) return;
  //   if (!confirm("Are you sure you want to delete this booking?")) return;
  //   await deleteDoc(doc(db, "conferenceRooms", id));
  // };

  return (
    <div className="p-8 bg-gray-50 min-h-screen text-black">
      <h1 className="text-4xl font-extrabold mb-6 text-black">
        Conference Room Bookings
      </h1>

      {/* Filters */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-4 mb-6">
        <input
          type="text"
          placeholder="Search organizer"
          className="px-3 py-2 border border-black rounded text-black w-full md:w-48"
          value={searchOrganizer}
          onChange={(e) => setSearchOrganizer(e.target.value)}
        />

        <input
          type="text"
          placeholder="Search email"
          className="px-3 py-2 border border-black rounded text-black w-full md:w-48"
          value={searchEmail}
          onChange={(e) => setSearchEmail(e.target.value)}
        />

        {/* <Flatpickr
          value={printStart || undefined}
          onChange={(date) => setPrintStart(date[0] || null)}
          options={{ dateFormat: "Y-m-d" }}
          className="px-3 py-2 border border-black rounded text-black w-full md:w-48"
        />

        <Flatpickr
          value={printEnd || undefined}
          onChange={(date) => setPrintEnd(date[0] || null)}
          options={{ dateFormat: "Y-m-d" }}
          className="px-3 py-2 border border-black rounded text-black w-full md:w-48"
        /> */}

        <button
          onClick={printBooking}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          Print
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto shadow-lg rounded-lg border border-gray-300">
        <table className="min-w-full divide-y divide-gray-300 text-black">
          <thead className="bg-gray-100 sticky top-0 text-black">
            <tr>
              {[
                "Room",
                "Organizer",
                "Email",
                "Attendees",
                "Date",
                "Duration",
                "Price",
                "Notes",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  className="px-6 py-3 text-left text-sm font-semibold text-black uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-300 text-black">
            {filteredBookings.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-4 text-center text-black">
                  No bookings found.
                </td>
              </tr>
            ) : (
              filteredBookings.map((b, idx) => (
                <tr
                  key={b.id}
                  className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                >
                  <td className="px-6 py-4 text-black">{b.room}</td>
                  <td className="px-6 py-4 text-black">{b.organizerName}</td>
                  <td className="px-6 py-4 text-black">{b.email}</td>
                  <td className="px-6 py-4 text-black">{b.attendees}</td>
                  <td className="px-6 py-4 text-black">
                    {new Date(b.dateTime).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-black">{b.durationHours} hrs</td>
                  <td className="px-6 py-4 text-black">
                    {b.price.toLocaleString()} UGX
                  </td>

                  <td className="px-6 py-4 max-w-xs truncate text-black">
                    <Tippy content={b.notes}>
                      <span>{b.notes || "-"}</span>
                    </Tippy>
                  </td>

                  <td className="px-6 py-4 text-black">
                    <div className="flex gap-3">
                      <button
                        onClick={() => openEditModal(b)}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Edit
                      </button>

                      {/* <button
                        onClick={() => deleteBooking(b.id)}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Delete
                      </button> */}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* EDIT MODAL */}
      {isEditOpen && editData && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg text-black">
            <h2 className="text-2xl font-bold mb-4 text-black">Edit Booking</h2>

            <div className="space-y-3">
              {(
                [
                  "room",
                  "organizerName",
                  "email",
                  "attendees",
                  "durationHours",
                  "price",
                  "notes",
                ] as (keyof Booking)[]
              ).map((field) => (
                <input
                  key={field}
                  type="text"
                  value={editData[field]}
                  onChange={(e) =>
                    handleEditChange(field, e.target.value)
                  }
                  className="w-full border px-3 py-2 rounded text-black bg-white"
                />
              ))}
            </div>

            <div className="flex justify-end gap-4 mt-6">
              <button
                onClick={() => setIsEditOpen(false)}
                className="px-4 py-2 bg-gray-400 text-white rounded"
              >
                Cancel
              </button>

              <button
                onClick={saveEditChanges}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
