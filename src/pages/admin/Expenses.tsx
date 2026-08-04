import { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  // deleteDoc,
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../firebase";
// import Flatpickr from "react-flatpickr";
import "flatpickr/dist/flatpickr.min.css";
import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";
import { Printer, Pencil, PieChart, X } from "lucide-react";

interface Expense {
  id: string;
  department: string;
  description: string;
  amount: number;
  date: string;
  notes?: string;
  userId: string;
  createdByName?: string; // fetched from Firestore
}

export default function AdminExpensesDashboard() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [createdByFilter, setCreatedByFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");


  // Edit modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editData, setEditData] = useState<Expense | null>(null);

  // Fetch expenses and map user names
 useEffect(() => {
  const q = collection(db, "expenses");

  const unsub = onSnapshot(q, async (snapshot) => {
    const data: Expense[] = await Promise.all(
      snapshot.docs.map(async (docSnap) => {
        const raw = docSnap.data() as any;
        // Expenses are written with `createdAt` (Timestamp); derive the `date`
        // string the UI expects so dates aren't "Invalid Date".
        const exp = {
          ...(raw as Expense),
          id: docSnap.id,
          date: raw.date || raw.createdAt?.toDate?.()?.toISOString() || "",
        };

        // Use createdByName from expense first
        let createdByName = exp.createdByName || "";

        // If missing, try fetching from Firestore 'users' collection
        if (!createdByName && exp.userId) {
          try {
            const userDoc = await getDoc(doc(db, "users", exp.userId));
            if (userDoc.exists()) {
              const userData = userDoc.data();
              createdByName =
                userData.name || userData.displayName || userData.email || "Unknown";
            } else {
              createdByName = "Unknown";
            }
          } catch (err) {
            console.error("Failed to fetch user:", err);
            createdByName = "Unknown";
          }
        }

        return {
          ...exp,
          createdByName,
        };
      })
    );

    // Sort by newest first
    data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setExpenses(data);
    setLoading(false);
  });

  return () => unsub();
}, []);



  const filteredExpenses = expenses.filter((exp) => {
  if (
    departmentFilter &&
    !exp.department.toLowerCase().includes(departmentFilter.toLowerCase())
  ) {
    return false;
  }

  if (
    createdByFilter &&
    !exp.createdByName?.toLowerCase().includes(createdByFilter.toLowerCase())
  ) {
    return false;
  }

  if (searchFilter) {
    const search = searchFilter.toLowerCase();
    if (
      !exp.description?.toLowerCase().includes(search) &&
      !exp.notes?.toLowerCase().includes(search)
    ) {
      return false;
    }
  }

  return true;
});


  // Delete expense
  // const handleDelete = async (id: string) => {
  //   if (!confirm("Are you sure you want to delete this expense?")) return;
  //   try {
  //     await deleteDoc(doc(db, "expenses", id));
  //     alert("Expense deleted successfully.");
  //   } catch (err) {
  //     console.error(err);
  //     alert("Failed to delete expense.");
  //   }
  // };

  // Open edit modal
  const openEditModal = (exp: Expense) => {
    setEditData(exp);
    setIsEditOpen(true);
  };

  const handleEditChange = (field: keyof Expense, value: string | number) => {
    if (!editData) return;
    setEditData({ ...editData, [field]: value });
  };

  // Save edit changes
  const saveEditChanges = async () => {
    if (!editData) return;
    const { id, ...dataToUpdate } = editData;
    try {
      await updateDoc(doc(db, "expenses", id), dataToUpdate);
      setIsEditOpen(false);
      alert("Expense updated successfully.");
    } catch (err) {
      console.error(err);
      alert("Failed to update expense.");
    }
  };

  // Print expenses
  const handlePrint = () => {
    const printWindow = window.open("", "PRINT", "height=600,width=800");
    if (!printWindow) return;

    printWindow.document.write("<html><head><title>Expenses</title>");
    printWindow.document.write(
      "<style>table{width:100%;border-collapse:collapse;font-family:sans-serif;}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f3f4f6;font-weight:bold;}</style>"
    );
    printWindow.document.write("</head><body>");
    printWindow.document.write("<h2>Expenses Report</h2>");
    printWindow.document.write("<table>");
    printWindow.document.write(
      "<thead><tr><th>Department</th><th>Description</th><th>Amount</th><th>Date</th><th>Notes</th><th>Created By</th></tr></thead>"
    );
    printWindow.document.write("<tbody>");
    filteredExpenses.forEach((exp) => {
      printWindow.document.write(
        `<tr>
          <td>${exp.department || "-"}</td>
          <td>${exp.description || "-"}</td>
          <td>${exp.amount.toLocaleString()} UGX</td>
          <td>${new Date(exp.date).toLocaleString()}</td>
          <td>${exp.notes || "-"}</td>
          <td>${exp.createdByName || "Unknown"}</td>
        </tr>`
      );
    });
    printWindow.document.write("</tbody></table>");
    printWindow.document.write("</body></html>");
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">All operational spending across the property.</p>
        </div>
        <button onClick={handlePrint} className="btn btn-secondary">
          <Printer size={16} /> Print
        </button>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <h3 className="section-title mb-3">Filter expenses</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="field-label">Department</label>
            <input type="text" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} placeholder="e.g. Kitchen, Admin" className="input" />
          </div>
          <div>
            <label className="field-label">Created by</label>
            <input type="text" value={createdByFilter} onChange={(e) => setCreatedByFilter(e.target.value)} placeholder="User name" className="input" />
          </div>
          <div>
            <label className="field-label">Search description / notes</label>
            <input type="text" value={searchFilter} onChange={(e) => setSearchFilter(e.target.value)} placeholder="Search…" className="input" />
          </div>
        </div>
      </div>

      {/* Expenses Table */}
      <div className="card card-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {["Department", "Description", "Amount", "Date", "Notes", "Created By", "Actions"].map((title) => (
                  <th key={title}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 1 ? 140 : 70 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-icon"><PieChart size={24} /></div>
                      <p className="empty-title">No expenses found</p>
                      <p className="empty-desc">No expenses match your current filters.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((exp) => (
                  <tr key={exp.id}>
                    <td><span className="badge badge-neutral badge-plain">{exp.department || "-"}</span></td>
                    <td className="max-w-xs truncate text-slate-700">
                      <Tippy content={exp.description || "-"} placement="top">
                        <span>{exp.description || "-"}</span>
                      </Tippy>
                    </td>
                    <td className="font-medium">{exp.amount.toLocaleString()} UGX</td>
                    <td className="text-slate-500 whitespace-nowrap">{exp.date ? new Date(exp.date).toLocaleString() : "-"}</td>
                    <td className="max-w-xs truncate text-slate-500">
                      <Tippy content={exp.notes || "-"} placement="top">
                        <span>{exp.notes || "-"}</span>
                      </Tippy>
                    </td>
                    <td className="text-slate-600">{exp.createdByName || "Unknown"}</td>
                    <td>
                      <button onClick={() => openEditModal(exp)} className="btn btn-secondary btn-sm">
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

      {/* EDIT POPUP */}
      {isEditOpen && editData && (
        <div className="modal-overlay" onClick={() => setIsEditOpen(false)}>
          <div className="modal-panel max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit expense">
            <div className="modal-header">
              <h2 className="modal-title">Edit Expense</h2>
              <button className="icon-btn" onClick={() => setIsEditOpen(false)} aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              {(
                [
                  ["department", "Department"],
                  ["description", "Description"],
                  ["amount", "Amount (UGX)"],
                  ["date", "Date"],
                  ["notes", "Notes"],
                ] as [keyof Expense, string][]
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="field-label">{label}</label>
                  <input
                    type={field === "amount" ? "number" : "text"}
                    value={editData[field] as string | number}
                    onChange={(e) =>
                      handleEditChange(field, field === "amount" ? Number(e.target.value) : e.target.value)
                    }
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
