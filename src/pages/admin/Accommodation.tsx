import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  doc,
  // deleteDoc,
  updateDoc,
} from "firebase/firestore";
import type { DocumentData } from "firebase/firestore/lite";
import { db, auth } from "../../../firebase";
import { onAuthStateChanged } from "firebase/auth";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";

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

  const handleEditChange = (field: keyof AccommodationRecord, value: any) => {
    if (!editData) return;
    setEditData({ ...editData, [field]: value });
  };

  const saveEditChanges = async () => {
    if (!editData) return;

    try {
      const ref = doc(db, "accomodation", editData.id);

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
  const fetchRecords = async () => {
    setLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("User not authenticated.");

      const q = query(collection(db, "accomodation"), orderBy("checkIn"), limit(PAGE_SIZE));
      const snapshot = await getDocs(q);

      const data: AccommodationRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as any;
        return {
          id: docSnap.id,
          guestName: d.guestName ?? "",
          guestEmail: d.guestEmail ?? "",
          roomType: d.roomType ?? "",
          numberOfGuests: d.numberOfGuests ?? 0,
          checkIn: d.checkIn?.toDate?.()?.toLocaleString() ?? "",
          checkOut: d.checkOut?.toDate?.()?.toLocaleString() ?? "",
          pricePaid: d.pricePaid ?? 0,
          paymentStatus: d.paymentStatus ?? "",
          notes: d.notes ?? "",
        };
      });

      setRecords(data);
      setFilteredRecords(data);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Load more
  const loadMore = async () => {
    if (!lastDoc) return;

    setLoadingMore(true);

    try {
      const q = query(
        collection(db, "accomodation"),
        orderBy("checkIn"),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(q);

      const data: AccommodationRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as any;
        return {
          id: docSnap.id,
          guestName: d.guestName ?? "",
          guestEmail: d.guestEmail ?? "",
          roomType: d.roomType ?? "",
          numberOfGuests: d.numberOfGuests ?? 0,
          checkIn: d.checkIn?.toDate?.()?.toLocaleString() ?? "",
          checkOut: d.checkOut?.toDate?.()?.toLocaleString() ?? "",
          pricePaid: d.pricePaid ?? 0,
          paymentStatus: d.paymentStatus ?? "",
          notes: d.notes ?? "",
        };
      });

      setRecords((prev) => [...prev, ...data]);
      setFilteredRecords((prev) => [...prev, ...data]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err: any) {
      setError(err.message);
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
      if (user) fetchRecords();
      else {
        setError("You must be logged in to view this data.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  return (
    <div className="p-8 bg-gray-50 min-h-screen text-black">
      <h1 className="text-4xl font-extrabold mb-6">Accommodation Records</h1>

      {/* LOADING */}
      {loading && (
        <p className="text-blue-600 mb-4 text-lg font-semibold">Loading records...</p>
      )}

      {/* ERROR */}
      {error && (
        <p className="text-red-600 mb-4 text-lg font-semibold">{error}</p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <input
          type="text"
          placeholder="Filter by Guest Name"
          value={guestNameFilter}
          onChange={(e) => setGuestNameFilter(e.target.value)}
          className="px-3 py-2 border border-black rounded w-60 text-black"
        />

        <input
          type="text"
          placeholder="Filter by Guest Email"
          value={guestEmailFilter}
          onChange={(e) => setGuestEmailFilter(e.target.value)}
          className="px-3 py-2 border border-black rounded w-60 text-black"
        />

        <button
          onClick={printAccommodationRecords}
          className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Print Records
        </button>

        
      </div>

      {/* Table */}
      <div className="overflow-x-auto shadow-lg rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-black">
          <thead className="bg-gray-100 sticky top-0 text-black">
            <tr>
              {[
                "Guest Name",
                "Guest Email",
                "Room Type",
                "Guests",
                "Check-in",
                "Check-out",
                "Amount Paid (in UGX)",
                "Payment Status",
                "Notes",
                "Actions",
              ].map((title) => (
                <th
                  key={title}
                  className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wider text-black"
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="bg-white divide-y divide-gray-200">
            {filteredRecords.map((record) => (
              <tr key={record.id}>
                <td className="px-6 py-4 text-black">{record.guestName}</td>
                <td className="px-6 py-4 text-black">{record.guestEmail}</td>
                <td className="px-6 py-4 text-black">{record.roomType}</td>
                <td className="px-6 py-4 text-black">{record.numberOfGuests}</td>
                <td className="px-6 py-4 text-black">{record.checkIn}</td>
                <td className="px-6 py-4 text-black">{record.checkOut}</td>
                <td className="px-6 py-4 text-black">{record.pricePaid}</td>
                <td className="px-6 py-4 text-black">{record.paymentStatus}</td>

                <td className="px-6 py-4 max-w-xs truncate text-black">
                  <Tippy content={record.notes}>
                    <span>{record.notes}</span>
                  </Tippy>
                </td>

                {/* ACTION BUTTONS */}
                <td className="px-6 py-4">
                  <div className="flex gap-3">
                    <button
                      onClick={() => openEditModal(record)}
                      className="px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700"
                    >
                      Edit
                    </button>

                    {/* <button
                      onClick={() => handleDelete(record.id)}
                      className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Delete
                    </button> */}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 rounded text-white bg-blue-600 hover:bg-blue-700"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {/* EDIT POPUP */}
      {isEditOpen && editData && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg text-black">
            <h2 className="text-2xl font-bold mb-4">Edit Record</h2>

            <div className="space-y-3">
              {(
                [
                  "guestName",
                  "guestEmail",
                  "roomType",
                  "numberOfGuests",
                  "pricePaid",
                  "paymentStatus",
                  "notes",
                ] as (keyof AccommodationRecord)[]
              ).map((field) => (
                <input
                  key={field}
                  type="text"
                  value={editData[field]}
                  onChange={(e) => handleEditChange(field, e.target.value)}
                  className="w-full border px-3 py-2 rounded text-black"
                />
              ))}
            </div>

            <div className="flex justify-end gap-4 mt-6">
              <button
                onClick={closeEditModal}
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
