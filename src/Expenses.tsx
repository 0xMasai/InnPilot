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
import { Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Expense {
  id?: string;
  department: string;
  description: string;
  amount: number | string;
  expenseDate: string; // ISO string
  notes?: string;
  userId: string;
}

const departments = ["Kitchen", "Cleaning", "Maintenance", "Front Desk", "Other"];

export default function ExpensesDashboard() {
  const [open, setOpen] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("All");
  const [minAmount, setMinAmount] = useState<number | "">("");
  const [maxAmount, setMaxAmount] = useState<number | "">("");

  const [formData, setFormData] = useState<Expense>({
    department: "",
    description: "",
    amount: "",
    expenseDate: "",
    notes: "",
    userId: auth.currentUser?.uid || "",
  });

  /* 🔥 FIRESTORE LISTENER */
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, "expenses"),
      where("userId", "==", user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((doc) => {
        const raw = doc.data() as any;
        return {
          id: doc.id,
          ...raw,
          expenseDate: raw.createdAt?.toDate()?.toISOString() || "",
        };
      });

      setExpenses(
        data.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))
      );
    });

    return () => unsub();
  }, []);

  /* 🔍 FILTER */
  const filteredExpenses = expenses.filter((e) => {
    const matchSearch =
      e.description.toLowerCase().includes(search.toLowerCase()) ||
      e.department.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === "All" || e.department === filterDept;
    const matchMin = minAmount === "" || Number(e.amount) >= minAmount;
    const matchMax = maxAmount === "" || Number(e.amount) <= maxAmount;
    return matchSearch && matchDept && matchMin && matchMax;
  });

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return alert("Not authenticated");

    if (!formData.department || !formData.description || !formData.amount)
      return alert("Fill required fields");

    await addDoc(collection(db, "expenses"), {
      department: formData.department,
      description: formData.description,
      amount: Number(formData.amount),
      notes: formData.notes,
      userId: user.uid,
      createdAt: Timestamp.now(),
    });

    setOpen(false);
    setFormData({
      department: "",
      description: "",
      amount: "",
      expenseDate: "",
      notes: "",
      userId: user.uid,
    });
  };

  const printExpense = (e: Expense) => {
    const win = window.open("", "PRINT", "width=400,height=600");
    if (!win) return;
    win.document.write(`<h2>Jamiz Hotel</h2>`);
    win.document.write(`<h3>Expense Voucher</h3>`);
    win.document.write(`<p><b>Department:</b> ${e.department}</p>`);
    win.document.write(`<p><b>Description:</b> ${e.description}</p>`);
    win.document.write(`<p><b>Amount:</b> ${Number(e.amount).toLocaleString()} UGX</p>`);
    win.document.write(`<p><b>Date:</b> ${new Date(e.expenseDate).toLocaleString()}</p>`);
    win.document.write(`<p><b>Notes:</b> ${e.notes || "-"}</p>`);
    win.print();
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-100 to-gray-200 p-6">
      <div className="max-w-7xl mx-auto">

        {/* HEADER */}
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-4xl font-bold text-gray-900">Expenses Dashboard</h2>
          <button
            onClick={() => setOpen(true)}
            className="flex gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl"
          >
            <Plus /> Add Expense
          </button>
        </div>

        {/* MODAL */}
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 bg-black/40 z-50 flex justify-center items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-white p-8 rounded-2xl w-full max-w-xl relative"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
              >
                <button
                  onClick={() => setOpen(false)}
                  className="absolute top-4 right-4"
                >
                  <X />
                </button>

                <h3 className="text-2xl font-bold mb-6 text-gray-800">New Expense</h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <select
                    name="department"
                    value={formData.department}
                    onChange={handleChange}
                    className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option value="" disabled>Select Department</option>
                    {departments.map(d => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>

                  <input
                    name="description"
                    placeholder="Description"
                    value={formData.description}
                    onChange={handleChange}
                    className="p-3 w-full h-28 border-2 border-blue-500 bg-blue-50 rounded-lg text-blue-900 outline-none focus:ring-2 focus:ring-blue-200"
                  />

                  <input
                    type="number"
                    name="amount"
                    placeholder="Amount (UGX)"
                    value={formData.amount}
                    onChange={handleChange}
                    className="p-3 border-2 border-blue-500 bg-blue-50 rounded-lg text-blue-900"
                  />

                  <textarea
                    name="notes"
                    placeholder="Notes"
                    value={formData.notes}
                    onChange={handleChange}
                    className="p-3 w-full h-28 border-2 border-blue-500 bg-blue-50 rounded-lg text-blue-900 outline-none focus:ring-2 focus:ring-blue-200"
                  />

                  <button className="w-full bg-blue-600 text-white py-3 rounded-xl">
                    Save Expense
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FILTER */}
        <div className="bg-white p-6 rounded-xl mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
          />
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
          >
            <option value="All">All Departments</option>
            {departments.map(d => <option key={d}>{d}</option>)}
          </select>
          <input
            type="number"
            placeholder="Min Amount"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value === "" ? "" : Number(e.target.value))}
            className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
          />
          <input
            type="number"
            placeholder="Max Amount"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value === "" ? "" : Number(e.target.value))}
            className="p-3 border-2 border-blue-500 text-blue-900 bg-blue-50 rounded-lg"
          />
          <p className="mt-4 text-sm text-blue-900">
            Showing <strong>{filteredExpenses.length}</strong> of{" "}
            <strong>{expenses.length}</strong> expenses
          </p>
        </div>

        {/* TABLE */}
        <div className="bg-white/95 backdrop-blur-md p-6 rounded-xl shadow-lg border border-blue-400">
          <h2 className="text-xl font-semibold mb-6 text-blue-900">Recent Expenses</h2>
         <div className="overflow-hidden border border-blue-300 rounded-xl">
          <table className="w-full text-left">
            <thead className="bg-blue-100 text-blue-900">
              <tr>
                <th className="px-4 py-3 border-b">Department</th>
                <th className="px-4 py-3 border-b">Description</th>
                <th className="px-4 py-3 border-b">Amount</th>
                <th className="px-4 py-3 border-b">Date</th>
                <th className="px-4 py-3 border-b text-center">Receipt</th>
              </tr>
            </thead>

            <tbody>
              {filteredExpenses.length ? (
                filteredExpenses.map((e, i) => (
                  <tr
                    key={e.id}
                    className={`border-b hover:bg-blue-50 ${
                      i % 2 === 0 ? "bg-white" : "bg-blue-50/50"
                    }`}
                  >
                    <td className="px-4 py-3 text-blue-900">{e.department}</td>
                    <td className="px-4 py-3 text-blue-900">{e.description}</td>
                    <td className="px-4 py-3 text-blue-900">
                      {Number(e.amount).toLocaleString()} UGX
                    </td>
                    <td className="px-4 py-3 text-blue-900">
                      {new Date(e.expenseDate).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => printExpense(e)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                      >
                        Print
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-blue-900">
                    No expenses match your filters.
                  </td>
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
