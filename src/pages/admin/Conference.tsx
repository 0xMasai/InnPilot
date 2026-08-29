"use client";

import { useState, useEffect } from "react";
import {
  onSnapshot,
  // deleteDoc,
  updateDoc,
} from "firebase/firestore";
import { auth } from "../../../firebase";
import { hotelCollection, hotelDoc } from "../../lib/hotelScope";
import { useAuth } from "../../auth/AuthProvider";


import "flatpickr/dist/flatpickr.min.css";

import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import { Printer, Search, Pencil, Briefcase, X } from "lucide-react";

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
  const { hotelId } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([]);

  const [searchOrganizer, setSearchOrganizer] = useState("");
  const [searchEmail, setSearchEmail] = useState("");


  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editData, setEditData] = useState<Booking | null>(null);

  // Fetch bookings
  useEffect(() => {
    if (!auth.currentUser || !hotelId) return;

    const ref = hotelCollection(hotelId, "conferenceRooms");

    const unsub = onSnapshot(ref, (snapshot) => {
      const data = snapshot.docs.map((d) => {
        const raw = d.data() as any;
        return {
          id: d.id,
          ...(raw as Booking),
          // Bookings are written with `createdAt` (Timestamp); derive the
          // `dateTime` string the UI expects so dates aren't "Invalid Date".
          dateTime: raw.dateTime || raw.createdAt?.toDate?.()?.toISOString() || "",
        };
      });

      const sorted = data.sort(
        (a, b) =>
          new Date(b.dateTime).getTime() -
          new Date(a.dateTime).getTime()
      );

      setBookings(sorted);
      setFilteredBookings(sorted);
    });

    return () => unsub();
  }, [hotelId]);

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
    if (!editData || !editData.id || !hotelId) return;

    const { id, ...data } = editData;
    await updateDoc(hotelDoc(hotelId, "conferenceRooms", id), data);

    alert("Booking updated successfully.");
    setIsEditOpen(false);
  };

  // const deleteBooking = async (id?: string) => {
  //   if (!id) return;
  //   if (!confirm("Are you sure you want to delete this booking?")) return;
  //   await deleteDoc(doc(db, "conferenceRooms", id));
  // };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conference Room Bookings</h1>
          <p className="page-subtitle">All meeting-space bookings across the property.</p>
        </div>
        <button onClick={printBooking} className="btn btn-secondary">
          <Printer size={16} /> Print
        </button>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <h3 className="section-title mb-3">Filter bookings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Search organizer" placeholder="Search organizer" className="input" value={searchOrganizer} onChange={(e) => setSearchOrganizer(e.target.value)} />
          </div>
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Search email" placeholder="Search email" className="input" value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card card-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {["Room", "Organizer", "Email", "Attendees", "Date", "Duration", "Price", "Notes", "Actions"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      <div className="empty-icon"><Briefcase size={24} /></div>
                      <p className="empty-title">No bookings found</p>
                      <p className="empty-desc">No conference bookings match your filters yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredBookings.map((b) => (
                  <tr key={b.id}>
                    <td><span className="badge badge-info badge-plain">{b.room}</span></td>
                    <td className="font-medium text-slate-800">{b.organizerName}</td>
                    <td className="text-slate-500">{b.email}</td>
                    <td>{b.attendees}</td>
                    <td className="text-slate-500 whitespace-nowrap">{new Date(b.dateTime).toLocaleString()}</td>
                    <td>{b.durationHours} hrs</td>
                    <td className="font-medium">{b.price.toLocaleString()} UGX</td>
                    <td className="max-w-xs truncate">
                      <Tippy content={b.notes}>
                        <span>{b.notes || "-"}</span>
                      </Tippy>
                    </td>
                    <td>
                      <button onClick={() => openEditModal(b)} className="btn btn-secondary btn-sm">
                        <Pencil size={15} /> Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* EDIT MODAL */}
      {isEditOpen && editData && (
        <div className="modal-overlay" onClick={() => setIsEditOpen(false)}>
          <div className="modal-panel max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit booking">
            <div className="modal-header">
              <h2 className="modal-title">Edit Booking</h2>
              <button className="icon-btn" onClick={() => setIsEditOpen(false)} aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              {(
                [
                  ["room", "Room"],
                  ["organizerName", "Organizer name"],
                  ["email", "Email"],
                  ["attendees", "Attendees"],
                  ["durationHours", "Duration (hrs)"],
                  ["price", "Price (UGX)"],
                  ["notes", "Notes"],
                ] as [keyof Booking, string][]
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="field-label">{label}</label>
                  <input
                    type="text"
                    value={editData[field]}
                    onChange={(e) => handleEditChange(field, e.target.value)}
                    className="input"
                  />
                </div>
              ))}

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setIsEditOpen(false)} className="btn btn-secondary">Cancel</button>
                <button onClick={saveEditChanges} className="btn btn-primary">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
