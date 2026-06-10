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
        const exp = { ...(docSnap.data() as Expense), id: docSnap.id };

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
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-4xl font-extrabold mb-6 text-gray-900">
        Admin Expenses Dashboard
      </h1>

      {/* Filters + Print */}
<div className="flex flex-wrap items-end gap-4 mb-6">
  <div>
    <label className="block text-gray-700 font-semibold mb-1">
      Department
    </label>
    <input
      type="text"
      value={departmentFilter}
      onChange={(e) => setDepartmentFilter(e.target.value)}
      placeholder="e.g. Kitchen, Admin"
      className="px-3 py-2 border border-black rounded w-48 text-black"
    />
  </div>

  <div>
    <label className="block text-gray-700 font-semibold mb-1">
      Created By
    </label>
    <input
      type="text"
      value={createdByFilter}
      onChange={(e) => setCreatedByFilter(e.target.value)}
      placeholder="User name"
      className="px-3 py-2 border border-black rounded w-48 text-black"
    />
  </div>

  <div className="flex-1 min-w-[200px]">
    <label className="block text-gray-700 font-semibold mb-1">
      Search Description / Notes
    </label>
    <input
      type="text"
      value={searchFilter}
      onChange={(e) => setSearchFilter(e.target.value)}
      placeholder="Search..."
      className="px-3 py-2 border border-black rounded w-full text-black"
    />
  </div>

  <button
    onClick={handlePrint}
    className="px-5 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
  >
    Print
  </button>
</div>


      {/* Expenses Table */}
      <div className="overflow-x-auto shadow-lg rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              {[
                "Department",
                "Description",
                "Amount",
                "Date",
                "Notes",
                "Created By",
                "Actions",
              ].map((title) => (
                <th
                  key={title}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                >
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-500">
                  Loading expenses...
                </td>
              </tr>
            ) : filteredExpenses.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-700">
                  No expenses found in selected range.
                </td>
              </tr>
            ) : (
              filteredExpenses.map((exp, idx) => (
                <tr
                  key={exp.id}
                  className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                >
                  <td className="px-6 py-4 text-gray-700">{exp.department || "-"}</td>
                  <td className="px-6 py-4 max-w-xs truncate text-gray-700">
                    <Tippy content={exp.description || "-"} placement="top">
                      <span>{exp.description || "-"}</span>
                    </Tippy>
                  </td>
                  <td className="px-6 py-4 text-gray-700">{exp.amount.toLocaleString()} UGX</td>
                  <td className="px-6 py-4 text-gray-700">
                    {exp.date ? new Date(exp.date).toLocaleString() : "-"}
                  </td>
                  <td className="px-6 py-4 max-w-xs truncate text-gray-700">
                    <Tippy content={exp.notes || "-"} placement="top">
                      <span>{exp.notes || "-"}</span>
                    </Tippy>
                  </td>
                  <td className="px-6 py-4 text-gray-700">
                    {exp.createdByName || "Unknown"}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-3">
                      <button
                        onClick={() => openEditModal(exp)}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                      >
                        Edit
                      </button>
                      {/* <button
                        onClick={() => handleDelete(exp.id)}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition"
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

      {/* EDIT POPUP */}
      {isEditOpen && editData && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg text-black">
            <h2 className="text-2xl font-bold mb-4">Edit Expense</h2>

            <div className="space-y-3">
              {(
                ["department","description","amount","date","notes"] as (keyof Expense)[]
              ).map((field) => (
                <input
                  key={field}
                  type={field === "amount" ? "number" : "text"}
                  value={editData[field] as string | number}
                  onChange={(e) =>
                    handleEditChange(
                      field,
                      field === "amount" ? Number(e.target.value) : e.target.value
                    )
                  }
                  className="w-full border px-3 py-2 rounded text-black"
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
