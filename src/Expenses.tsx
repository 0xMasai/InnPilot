"use client";
import { useState, useEffect } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  collection,
  addDoc,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { logAction } from "./lib/audit";
import { Plus, X, Printer, Search, PieChart } from "lucide-react";
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
  const [loading, setLoading] = useState(true);
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

  /* FIRESTORE LISTENER — shared operational data: all staff see all
     expenses (userId still recorded on each entry for accountability). */
  useEffect(() => {
    const q = collection(db, "expenses");

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
      setLoading(false);
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

  const totalFiltered = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

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

    const ref = await addDoc(collection(db, "expenses"), {
      department: formData.department,
      description: formData.description,
      amount: Number(formData.amount),
      notes: formData.notes,
      userId: user.uid,
      createdAt: Timestamp.now(),
    });
    logAction("Expense recorded", "expense", ref.id, `${formData.department} · UGX ${Number(formData.amount).toLocaleString()}`);

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
    win.document.write(`<h2>Hotel Management</h2>`);
    win.document.write(`<h3>Expense Voucher</h3>`);
    win.document.write(`<p><b>Department:</b> ${e.department}</p>`);
    win.document.write(`<p><b>Description:</b> ${e.description}</p>`);
    win.document.write(`<p><b>Amount:</b> ${Number(e.amount).toLocaleString()} UGX</p>`);
    win.document.write(`<p><b>Date:</b> ${new Date(e.expenseDate).toLocaleString()}</p>`);
    win.document.write(`<p><b>Notes:</b> ${e.notes || "-"}</p>`);
    win.print();
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Expenses</h2>
          <p className="page-subtitle">Track and review operational spending.</p>
        </div>
        <button onClick={() => setOpen(true)} className="btn btn-primary">
          <Plus className="w-4 h-4" /> New Expense
        </button>
      </div>

      {/* MODAL */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="modal-panel max-w-xl"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="New expense"
            >
              <div className="modal-header">
                <h3 className="modal-title">New Expense</h3>
                <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="field-label">Department<span className="req">*</span></label>
                  <select name="department" value={formData.department} onChange={handleChange} className="select">
                    <option value="" disabled>Select department</option>
                    {departments.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="field-label">Description<span className="req">*</span></label>
                  <input name="description" placeholder="What was this expense for?" value={formData.description} onChange={handleChange} className="input" />
                </div>

                <div>
                  <label className="field-label">Amount (UGX)<span className="req">*</span></label>
                  <input type="number" name="amount" placeholder="0" value={formData.amount} onChange={handleChange} className="input" />
                </div>

                <div>
                  <label className="field-label">Notes</label>
                  <textarea name="notes" placeholder="Additional details" value={formData.notes} onChange={handleChange} className="textarea" />
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Expense</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SUMMARY + FILTER */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Filtered Total</span>
            <span className="stat-icon is-warning"><PieChart size={19} /></span>
          </div>
          <div className="stat-value" style={{ fontSize: "1.4rem" }}>{totalFiltered.toLocaleString()} UGX</div>
        </div>

        <div className="filter-bar lg:col-span-3">
          <h3 className="section-title mb-3">Search &amp; filter</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="search-wrap">
              <Search size={16} />
              <input aria-label="Search expenses" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
            </div>
            <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="select" aria-label="Department">
              <option value="All">All departments</option>
              {departments.map((d) => <option key={d}>{d}</option>)}
            </select>
            <input type="number" placeholder="Min amount" value={minAmount} onChange={(e) => setMinAmount(e.target.value === "" ? "" : Number(e.target.value))} className="input" aria-label="Minimum amount" />
            <input type="number" placeholder="Max amount" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value === "" ? "" : Number(e.target.value))} className="input" aria-label="Maximum amount" />
          </div>
          <p className="mt-3 text-sm muted">
            Showing <strong className="text-slate-700">{filteredExpenses.length}</strong> of <strong className="text-slate-700">{expenses.length}</strong> expenses
          </p>
        </div>
      </div>

      {/* TABLE */}
      <div className="card card-pad">
        <h2 className="section-title mb-4">Recent Expenses</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Date</th>
                <th className="text-center">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 1 ? 140 : 80 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredExpenses.length ? (
                filteredExpenses.map((e) => (
                  <tr key={e.id}>
                    <td><span className="badge badge-neutral badge-plain">{e.department}</span></td>
                    <td className="text-slate-700">{e.description}</td>
                    <td className="font-medium">{Number(e.amount).toLocaleString()} UGX</td>
                    <td className="text-slate-500 whitespace-nowrap">{new Date(e.expenseDate).toLocaleString()}</td>
                    <td className="text-center">
                      <button onClick={() => printExpense(e)} className="btn btn-secondary btn-sm">
                        <Printer size={15} /> Print
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <div className="empty-icon"><PieChart size={24} /></div>
                      <p className="empty-title">No expenses found</p>
                      <p className="empty-desc">
                        {expenses.length ? "No expenses match your current filters." : "Record your first expense and it will appear here."}
                      </p>
                      {!expenses.length && (
                        <button className="btn btn-primary btn-sm mt-2" onClick={() => setOpen(true)}>
                          <Plus size={15} /> New Expense
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
