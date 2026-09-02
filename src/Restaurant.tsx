"use client";
import { useState, useEffect, useMemo } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { addDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth } from "../firebase";
import { hotelCollection, hotelDoc } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import {
  Plus,
  X,
  Printer,
  Search,
  Utensils,
  CheckCircle2,
  Banknote,
  Ban,
  ReceiptText,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { COLLECTIONS } from "./lib/collections";
import { getRange, inRange, orderDate } from "./lib/metrics";
import { logAction } from "./lib/audit";

type OrderStatus = "Open" | "Served" | "Paid" | "Cancelled";
type PaymentMethod = "Cash" | "Mobile Money" | "Card";

interface Order {
  id?: string;
  clientName: string;
  clientPhoneNumber?: string;
  orderDetails: string;
  category: "Breakfast" | "Lunch" | "Dinner" | "Cocktails";
  price: number;
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  userId: string;
  createdAt: string;
}

const categories = ["Breakfast", "Lunch", "Dinner", "Cocktails"] as const;
const paymentMethods: PaymentMethod[] = ["Cash", "Mobile Money", "Card"];

const categoryBadge: Record<typeof categories[number], string> = {
  Breakfast: "badge-warning badge-plain",
  Lunch: "badge-success badge-plain",
  Dinner: "badge-info badge-plain",
  Cocktails: "badge-neutral badge-plain",
};

const statusBadge: Record<OrderStatus, string> = {
  Open: "badge-info",
  Served: "badge-warning",
  Paid: "badge-success",
  Cancelled: "badge-danger",
};

/** Legacy orders predate the lifecycle — they were recorded as completed sales. */
const orderStatusOf = (o: Order): OrderStatus => o.status ?? "Paid";

export default function RestaurantDashboard() {
  const { hotelId } = useAuth();
  const [open, setOpen] = useState(false);

  const initialFormData: Order = {
    clientName: "",
    clientPhoneNumber: "",
    orderDetails: "",
    category: "Breakfast",
    price: 0,
    paymentMethod: "Cash",
    userId: auth.currentUser?.uid ?? "",
    createdAt: new Date().toISOString(),
  };

  const [formData, setFormData] = useState<Order>(initialFormData);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<"All" | typeof categories[number]>("All");
  const [filterStatus, setFilterStatus] = useState<"All" | OrderStatus>("All");

  // Fetch orders — shared operational data: every staff member sees all
  // orders (userId is still written on each record for accountability).
  useEffect(() => {
    if (!hotelId) return;
    const unsub = onSnapshot(hotelCollection(hotelId, COLLECTIONS.RESTAURANT), (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Order),
      }));

      setOrders(data.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
      setLoading(false);
    });

    return () => unsub();
  }, [hotelId]);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === "price" ? Number(value) || 0 : value,
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!formData.clientName || !formData.orderDetails || !formData.price) {
      alert("Please fill all fields");
      return;
    }

    if (!hotelId) return alert("No hotel context — please sign in again.");

    try {
      const ref = await addDoc(hotelCollection(hotelId, COLLECTIONS.RESTAURANT), {
        ...formData,
        status: "Open" as OrderStatus,
        userId: auth.currentUser?.uid ?? "",
        createdAt: new Date().toISOString(),
      });
      logAction(hotelId, "Order created", "order", ref.id, `${formData.clientName} · ${formData.category} · UGX ${formData.price.toLocaleString()}`);

      setFormData({
        ...initialFormData,
        userId: auth.currentUser?.uid ?? "",
        createdAt: new Date().toISOString(),
      });

      setOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  const setStatus = async (o: Order, status: OrderStatus) => {
    if (!o.id || !hotelId) return;
    try {
      await updateDoc(hotelDoc(hotelId, COLLECTIONS.RESTAURANT, o.id), { status });
      logAction(hotelId, `Order ${status.toLowerCase()}`, "order", o.id, `${o.clientName} · UGX ${o.price.toLocaleString()}`);
    } catch (err) {
      console.error("Failed to update order:", err);
    }
  };

  const printReceipt = (order: Order) => {
    const w = window.open("", "PRINT", "height=600,width=400");
    if (!w) return;

    w.document.write(`
      <html>
        <head><title>Restaurant Receipt</title></head>
        <body>
          <h2>Restaurant Receipt</h2>
          <p><strong>Client:</strong> ${order.clientName}</p>
          <p><strong>Order:</strong> ${order.orderDetails}</p>
          <p><strong>Category:</strong> ${order.category}</p>
          <p><strong>Price:</strong> ${order.price.toLocaleString()} UGX</p>
          <p><strong>Status:</strong> ${orderStatusOf(order)}</p>
          <p><strong>Payment:</strong> ${order.paymentMethod ?? "-"}</p>
          <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
        </body>
      </html>
    `);

    w.document.close();
    w.focus();
    w.print();
  };

  // Today's stats (same range logic as the dashboard).
  const todayStats = useMemo(() => {
    const today = getRange("today");
    let sales = 0;
    let count = 0;
    let openCount = 0;
    for (const o of orders) {
      const st = orderStatusOf(o);
      if (st === "Open" || st === "Served") openCount += 1;
      if (st === "Cancelled") continue;
      if (!inRange(orderDate(o), today)) continue;
      count += 1;
      sales += Number(o.price) || 0;
    }
    return { sales, count, openCount };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        search === "" ||
        o.clientName.toLowerCase().includes(search.toLowerCase()) ||
        o.orderDetails.toLowerCase().includes(search.toLowerCase());

      const matchesCategory = filterCategory === "All" ? true : o.category === filterCategory;
      const matchesStatus = filterStatus === "All" ? true : orderStatusOf(o) === filterStatus;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [orders, search, filterCategory, filterStatus]);

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Restaurant</h2>
          <p className="page-subtitle">Take orders, track service and record payments.</p>
        </div>
        <button onClick={() => setOpen(true)} className="btn btn-primary">
          <Plus className="w-4 h-4" /> New Order
        </button>
      </div>

      {/* TODAY'S STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Today's Sales</span>
            <span className="stat-icon is-success"><Banknote size={19} /></span>
          </div>
          <div className="stat-value">UGX {todayStats.sales.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Today's Orders</span>
            <span className="stat-icon is-orange"><ReceiptText size={19} /></span>
          </div>
          <div className="stat-value">{todayStats.count}</div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Open Orders</span>
            <span className="stat-icon is-warning"><Utensils size={19} /></span>
          </div>
          <div className="stat-value">{todayStats.openCount}</div>
        </div>
      </div>

      {/* MODAL */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setOpen(false); setFormData(initialFormData); }}
          >
            <motion.div
              className="modal-panel max-w-2xl"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="New order"
            >
              <div className="modal-header">
                <h2 className="modal-title">New Order</h2>
                <button
                  className="icon-btn"
                  onClick={() => { setOpen(false); setFormData(initialFormData); }}
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* FORM */}
              <form className="p-6 space-y-5" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="field-label">Client name<span className="req">*</span></label>
                    <input type="text" name="clientName" value={formData.clientName} onChange={handleChange} placeholder="Enter client name" className="input" required />
                  </div>
                  <div>
                    <label className="field-label">Phone number</label>
                    <input type="tel" name="clientPhoneNumber" value={formData.clientPhoneNumber ?? ""} onChange={handleChange} placeholder="+256 7xx xxx xxx" className="input" />
                  </div>
                  <div>
                    <label className="field-label">Category</label>
                    <select name="category" value={formData.category} onChange={handleChange} className="select">
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Price (UGX)<span className="req">*</span></label>
                    <input type="number" name="price" value={formData.price === 0 ? "" : formData.price} onChange={handleChange} placeholder="Enter price" className="input" required />
                  </div>
                  <div>
                    <label className="field-label">Payment method</label>
                    <select name="paymentMethod" value={formData.paymentMethod} onChange={handleChange} className="select">
                      {paymentMethods.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="field-label">Order details<span className="req">*</span></label>
                  <textarea name="orderDetails" value={formData.orderDetails} onChange={handleChange} placeholder="Describe the order…" className="textarea" required />
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button type="button" className="btn btn-secondary" onClick={() => { setOpen(false); setFormData(initialFormData); }}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Submit Order</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FILTERS */}
      <div className="filter-bar">
        <h3 className="section-title mb-3">Search &amp; filter</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Search orders" placeholder="Search by client or order…" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as "All" | typeof categories[number])} className="select" aria-label="Category">
            <option value="All">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as OrderStatus | "All")} className="select" aria-label="Order status">
            <option value="All">All statuses</option>
            <option value="Open">Open</option>
            <option value="Served">Served</option>
            <option value="Paid">Paid</option>
            <option value="Cancelled">Cancelled</option>
          </select>
        </div>
        <p className="mt-3 text-sm muted">
          Showing <strong className="text-slate-700">{filteredOrders.length}</strong> of <strong className="text-slate-700">{orders.length}</strong> orders
        </p>
      </div>

      {/* ORDERS TABLE */}
      <div className="card card-pad">
        <h2 className="section-title mb-4">Recent Orders</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Order</th>
                <th>Category</th>
                <th>Price</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Date</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 1 ? 140 : 70 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredOrders.length ? (
                filteredOrders.map((o) => {
                  const st = orderStatusOf(o);
                  return (
                    <tr key={o.id}>
                      <td className="font-medium text-slate-800">{o.clientName}</td>
                      <td className="max-w-xs truncate">{o.orderDetails}</td>
                      <td>
                        <span className={`badge ${categoryBadge[o.category]}`}>{o.category}</span>
                      </td>
                      <td className="font-medium">{o.price.toLocaleString()} UGX</td>
                      <td className="text-slate-500">{o.paymentMethod ?? "-"}</td>
                      <td>
                        <span className={`badge ${statusBadge[st]}`}>{st}</span>
                      </td>
                      <td className="text-slate-500 whitespace-nowrap">{new Date(o.createdAt).toLocaleString()}</td>
                      <td>
                        <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                          {st === "Open" && (
                            <>
                              <button onClick={() => setStatus(o, "Served")} className="btn btn-secondary btn-sm" title="Mark as served">
                                <CheckCircle2 size={14} /> Served
                              </button>
                              <button onClick={() => setStatus(o, "Cancelled")} className="btn btn-ghost btn-sm" title="Cancel order">
                                <Ban size={14} />
                              </button>
                            </>
                          )}
                          {(st === "Open" || st === "Served") && (
                            <button onClick={() => setStatus(o, "Paid")} className="btn btn-success btn-sm" title="Mark as paid">
                              <Banknote size={14} /> Paid
                            </button>
                          )}
                          <button onClick={() => printReceipt(o)} className="btn btn-ghost btn-sm" title="Print receipt">
                            <Printer size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state">
                      <div className="empty-icon"><Utensils size={24} /></div>
                      <p className="empty-title">No orders found</p>
                      <p className="empty-desc">
                        {orders.length ? "No orders match your current filters." : "Add your first order and it will appear here."}
                      </p>
                      {!orders.length && (
                        <button className="btn btn-primary btn-sm mt-2" onClick={() => setOpen(true)}>
                          <Plus size={15} /> New Order
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
