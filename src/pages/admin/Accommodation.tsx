import { useCallback, useEffect, useState } from "react";
import {
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  // deleteDoc,
  updateDoc,
} from "firebase/firestore";
import type { DocumentData } from "firebase/firestore/lite";
import { auth } from "../../../firebase";
import { hotelCollection, hotelDoc } from "../../lib/hotelScope";
import { useAuth } from "../../auth/AuthProvider";
import { onAuthStateChanged } from "firebase/auth";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import { Printer, Search, Pencil, BedDouble, X } from "lucide-react";

interface AccommodationRecord {
  id: string;
  guestName: string;
  guestEmail: string;
  roomType: string;
  numberOfGuests: number;
  checkIn: string;
  checkOut: string;
  pricePaid: number;
  paymentStatus: string;
  notes: string;
}

const PAGE_SIZE = 10;

export default function AdminAccommodationDashboard() {
  const { hotelId, user } = useAuth();
  const [records, setRecords] = useState<AccommodationRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<AccommodationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [guestNameFilter, setGuestNameFilter] = useState("");
  const [guestEmailFilter, setGuestEmailFilter] = useState("");

  // EDIT POPUP STATE
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editData, setEditData] = useState<AccommodationRecord | null>(null);

  const openEditModal = (record: AccommodationRecord) => {
    setEditData(record);
    setIsEditOpen(true);
  };

  const closeEditModal = () => {
    setIsEditOpen(false);
    setEditData(null);
  };

  const handleEditChange = (field: keyof AccommodationRecord, value: unknown) => {
    if (!editData) return;
    setEditData({ ...editData, [field]: value });
  };

  const saveEditChanges = async () => {
    if (!editData || !hotelId) return;

    try {
      const ref = hotelDoc(hotelId, "accomodation", editData.id);

      await updateDoc(ref, {
        guestName: editData.guestName,
        guestEmail: editData.guestEmail,
        roomType: editData.roomType,
        numberOfGuests: editData.numberOfGuests,
        pricePaid: editData.pricePaid,
        paymentStatus: editData.paymentStatus,
        notes: editData.notes,
      });

      // Update UI
      setRecords((prev) => prev.map((r) => (r.id === editData.id ? editData : r)));
      setFilteredRecords((prev) => prev.map((r) => (r.id === editData.id ? editData : r)));

      alert("Record updated successfully!");
      closeEditModal();
    } catch (err) {
      console.error(err);
      alert("Failed to update record.");
    }
  };

  const printAccommodationRecords = () => {
  const printWindow = window.open("", "PRINT", "height=600,width=1000");
  if (!printWindow) return;

  printWindow.document.write("<html><head><title>Accommodation Records</title>");
  printWindow.document.write(`
    <style>
      body {
        color: black;
        font-family: Arial, sans-serif;
        padding: 20px;
      }
      h2 {
        text-align: center;
        margin-bottom: 10px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
        font-size: 13px;
      }
      th, td {
        border: 1px solid #000;
        padding: 6px 8px;
        text-align: left;
      }
      th {
        background: #f3f4f6;
        font-weight: bold;
      }
    </style>
  `);
  printWindow.document.write("</head><body>");

  printWindow.document.write("<h2>Accommodation Records</h2>");
  printWindow.document.write(
    `<p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>`
  );

  printWindow.document.write("<table>");
  printWindow.document.write(`
    <thead>
      <tr>
        <th>Guest Name</th>
        <th>Guest Email</th>
        <th>Room Type</th>
        <th>Guests</th>
        <th>Check-in</th>
        <th>Check-out</th>
        <th>Amount Paid (UGX)</th>
        <th>Payment Status</th>
        <th>Notes</th>
      </tr>
    </thead>
  `);

  printWindow.document.write("<tbody>");

  filteredRecords.forEach((r) => {
    printWindow.document.write(`
      <tr>
        <td>${r.guestName}</td>
        <td>${r.guestEmail}</td>
        <td>${r.roomType}</td>
        <td>${r.numberOfGuests}</td>
        <td>${r.checkIn || "-"}</td>
        <td>${r.checkOut || "-"}</td>
        <td>${r.pricePaid.toLocaleString()} UGX</td>
        <td>${r.paymentStatus}</td>
        <td>${r.notes || "-"}</td>
      </tr>
    `);
  });

  printWindow.document.write("</tbody></table>");
  printWindow.document.write("</body></html>");

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

  // const handleDelete = async (id: string) => {
  //   if (!confirm("Are you sure you want to delete this record?")) return;

  //   try {
  //     await deleteDoc(doc(db, "accomodation", id));
  //     setRecords((prev) => prev.filter((r) => r.id !== id));
  //     setFilteredRecords((prev) => prev.filter((r) => r.id !== id));
  //     alert("Record deleted successfully.");
  //   } catch (err) {
  //     console.error(err);
  //     alert("Failed to delete record.");
  //   }
  // };

  // Fetch first page
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (!user) throw new Error("User not authenticated.");
      if (!hotelId) throw new Error("No hotel context — please sign in again.");

      const q = query(hotelCollection(hotelId, "accomodation"), orderBy("checkIn"), limit(PAGE_SIZE));
      const snapshot = await getDocs(q);

      const data: AccommodationRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          id: docSnap.id,
          guestName: (d.guestName as string) ?? "",
          guestEmail: (d.guestEmail as string) ?? "",
          roomType: (d.roomType as string) ?? "",
          numberOfGuests: (d.numberOfGuests as number) ?? 0,
          checkIn: (d.checkIn as { toDate?: () => Date })?.toDate?.()?.toLocaleString() ?? "",
          checkOut: (d.checkOut as { toDate?: () => Date })?.toDate?.()?.toLocaleString() ?? "",
          pricePaid: (d.pricePaid as number) ?? 0,
          paymentStatus: (d.paymentStatus as string) ?? "",
          notes: (d.notes as string) ?? "",
        };
      });

      setRecords(data);
      setFilteredRecords(data);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [hotelId]);

  // Load more
  const loadMore = async () => {
    if (!lastDoc || !hotelId) return;

    setLoadingMore(true);

    try {
      const q = query(
        hotelCollection(hotelId, "accomodation"),
        orderBy("checkIn"),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(q);

      const data: AccommodationRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        return {
          id: docSnap.id,
          guestName: (d.guestName as string) ?? "",
          guestEmail: (d.guestEmail as string) ?? "",
          roomType: (d.roomType as string) ?? "",
          numberOfGuests: (d.numberOfGuests as number) ?? 0,
          checkIn: (d.checkIn as { toDate?: () => Date })?.toDate?.()?.toLocaleString() ?? "",
          checkOut: (d.checkOut as { toDate?: () => Date })?.toDate?.()?.toLocaleString() ?? "",
          pricePaid: (d.pricePaid as number) ?? 0,
          paymentStatus: (d.paymentStatus as string) ?? "",
          notes: (d.notes as string) ?? "",
        };
      });

      setRecords((prev) => [...prev, ...data]);
      setFilteredRecords((prev) => [...prev, ...data]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  // Filtering
  useEffect(() => {
    let filtered = [...records];

    if (guestNameFilter.trim() !== "") {
      filtered = filtered.filter((r) =>
        r.guestName.toLowerCase().includes(guestNameFilter.toLowerCase())
      );
    }

    if (guestEmailFilter.trim() !== "") {
      filtered = filtered.filter((r) =>
        r.guestEmail.toLowerCase().includes(guestEmailFilter.toLowerCase())
      );
    }

    setFilteredRecords(filtered);
  }, [guestNameFilter, guestEmailFilter, records]);

  // Auth check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user && hotelId) fetchRecords();
      else if (user && !hotelId) {
        // signed in but hotel context hasn't resolved yet — wait for it
        setLoading(true);
      } else {
        setError("You must be logged in to view this data.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, [hotelId, fetchRecords]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Accommodation Records</h1>
          <p className="page-subtitle">All guest bookings across the property.</p>
        </div>
        <button onClick={printAccommodationRecords} className="btn btn-secondary">
          <Printer size={16} /> Print Records
        </button>
      </div>

      {/* ERROR */}
      {error && (
        <div className="card" style={{ borderColor: "var(--danger-border)", background: "var(--danger-soft)" }}>
          <p className="px-4 py-3 text-sm font-medium" style={{ color: "var(--danger-text)" }}>{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar">
        <h3 className="section-title mb-3">Filter records</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Filter by guest name" placeholder="Filter by guest name" value={guestNameFilter} onChange={(e) => setGuestNameFilter(e.target.value)} className="input" />
          </div>
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Filter by guest email" placeholder="Filter by guest email" value={guestEmailFilter} onChange={(e) => setGuestEmailFilter(e.target.value)} className="input" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card card-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {[
                  "Guest Name",
                  "Guest Email",
                  "Room Type",
                  "Guests",
                  "Check-in",
                  "Check-out",
                  "Amount (UGX)",
                  "Payment",
                  "Notes",
                  "Actions",
                ].map((title) => (
                  <th key={title}>{title}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: 70 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredRecords.length ? (
                filteredRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="font-medium text-slate-800">{record.guestName}</td>
                    <td className="text-slate-500">{record.guestEmail}</td>
                    <td>{record.roomType}</td>
                    <td>{record.numberOfGuests}</td>
                    <td className="text-slate-500 whitespace-nowrap">{record.checkIn}</td>
                    <td className="text-slate-500 whitespace-nowrap">{record.checkOut}</td>
                    <td className="font-medium">{record.pricePaid.toLocaleString()} UGX</td>
                    <td>
                      <span className={`badge ${String(record.paymentStatus).toLowerCase() === "paid" ? "badge-success" : "badge-warning"}`}>
                        {record.paymentStatus || "—"}
                      </span>
                    </td>
                    <td className="max-w-xs truncate">
                      <Tippy content={record.notes}>
                        <span>{record.notes}</span>
                      </Tippy>
                    </td>
                    <td>
                      <button onClick={() => openEditModal(record)} className="btn btn-secondary btn-sm">
                        <Pencil size={15} /> Edit
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10}>
                    <div className="empty-state">
                      <div className="empty-icon"><BedDouble size={24} /></div>
                      <p className="empty-title">No records found</p>
                      <p className="empty-desc">No accommodation records match your filters yet.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && !loading && (
        <div className="text-center">
          <button onClick={loadMore} disabled={loadingMore} className="btn btn-secondary">
            {loadingMore ? "Loading…" : "Load More"}
          </button>
        </div>
      )}

      {/* EDIT POPUP */}
      {isEditOpen && editData && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div className="modal-panel max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit record">
            <div className="modal-header">
              <h2 className="modal-title">Edit Record</h2>
              <button className="icon-btn" onClick={closeEditModal} aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              {(
                [
                  ["guestName", "Guest name"],
                  ["guestEmail", "Guest email"],
                  ["roomType", "Room type"],
                  ["numberOfGuests", "Number of guests"],
                  ["pricePaid", "Amount paid (UGX)"],
                  ["paymentStatus", "Payment status"],
                  ["notes", "Notes"],
                ] as [keyof AccommodationRecord, string][]
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
                <button onClick={closeEditModal} className="btn btn-secondary">Cancel</button>
                <button onClick={saveEditChanges} className="btn btn-primary">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
