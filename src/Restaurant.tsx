"use client";
import { useState, useEffect, useMemo } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { collection, addDoc, onSnapshot, query, where } from "firebase/firestore";
import { db, auth } from "../firebase";
import { Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Order {
  id?: string;
  clientName: string;
  clientPhoneNumber?: string;
  orderDetails: string;
  category: "Breakfast" | "Lunch" | "Dinner" | "Cocktails";
  price: number;
  userId: string;
  createdAt: string;
}

const categories = ["Breakfast", "Lunch", "Dinner", "Cocktails"] as const;

const categoryColors: Record<typeof categories[number], string> = {
  Breakfast: "bg-yellow-100 text-yellow-800",
  Lunch: "bg-green-100 text-green-800",
  Dinner: "bg-purple-100 text-purple-800",
  Cocktails: "bg-pink-100 text-pink-800",
};

export default function RestaurantDashboard() {
  const [open, setOpen] = useState(false);

  const initialFormData: Order = {
    clientName: "",
    clientPhoneNumber: "",
    orderDetails: "",
    category: "Breakfast",
    price: 0,
    userId: auth.currentUser?.uid ?? "",
    createdAt: new Date().toISOString(),
  };

  const [formData, setFormData] = useState<Order>(initialFormData);
  const [orders, setOrders] = useState<Order[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<"All" | typeof categories[number]>("All");
  const [filterMinPrice, setFilterMinPrice] = useState<number | "">("");
  const [filterMaxPrice, setFilterMaxPrice] = useState<number | "">("");

  // Fetch orders
  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, "restaurant"),
      where("userId", "==", auth.currentUser.uid)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Order),
      }));

      setOrders(data.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });

    return () => unsub();
  }, []);

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

    try {
      await addDoc(collection(db, "restaurant"), {
        ...formData,
        userId: auth.currentUser?.uid ?? "",
        createdAt: new Date().toISOString(),
      });

      // Reset form
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

  const printReceipt = (order: Order) => {
    const w = window.open("", "PRINT", "height=600,width=400");
    if (!w) return;

    w.document.write(`
      <html>
        <head><title>Welcome to Jamiz Hotel</title></head>
        <body>
          <h2>Restaurant Receipt</h2>
          <p><strong>Client:</strong> ${order.clientName}</p>
          <p><strong>Order:</strong> ${order.orderDetails}</p>
          <p><strong>Category:</strong> ${order.category}</p>
          <p><strong>Price:</strong> ${order.price.toLocaleString()} UGX</p>
          <p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>
        </body>
      </html>
    `);

    w.document.close();
    w.focus();
    w.print();
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        search === "" ||
        o.clientName.toLowerCase().includes(search.toLowerCase()) ||
        o.orderDetails.toLowerCase().includes(search.toLowerCase());

      const matchesCategory = filterCategory === "All" ? true : o.category === filterCategory;
      const matchesMinPrice = filterMinPrice === "" ? true : o.price >= filterMinPrice;
      const matchesMaxPrice = filterMaxPrice === "" ? true : o.price <= filterMaxPrice;

      return matchesSearch && matchesCategory && matchesMinPrice && matchesMaxPrice;
    });
  }, [orders, search, filterCategory, filterMinPrice, filterMaxPrice]);

  // const resetFilters = () => {
  //   setSearch("");
  //   setFilterCategory("All");
  //   setFilterMinPrice("");
  //   setFilterMaxPrice("");
  // };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-100 to-gray-200 p-6">
      <div className="max-w-7xl mx-auto">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-4xl font-bold text-gray-900 tracking-tight">
            Restaurant Dashboard
          </h2>

          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-xl shadow hover:bg-green-700 transition-all"
          >
            <Plus className="w-5 h-5" /> Add Order
          </button>
        </div>

        {/* MODAL */}
        <AnimatePresence>
          {open && (
            <motion.div
              className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="bg-white rounded-2xl p-8 shadow-xl w-full max-w-2xl relative"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
              >
                <button
                  className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    setOpen(false);
                    setFormData(initialFormData);
                  }}
                >
                  <X className="w-6 h-6" />
                </button>

                <h2 className="text-2xl font-bold mb-6 text-gray-800">New Order</h2>

                {/* FORM */}
                <form className="space-y-6" onSubmit={handleSubmit}>
                  {/* Client Name & Category */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-semibold text-blue-900 mb-1">
                        Client Name
                      </label>
                      <input
                        type="text"
                        name="clientName"
                        value={formData.clientName}
                        onChange={handleChange}
                        placeholder="Enter client name"
                        className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none 
                                   focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-blue-900 mb-1">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        name="clientPhoneNumber"
                        value={formData.clientPhoneNumber ?? ""}
                        onChange={handleChange}
                        placeholder="e.g. +256 7xx xxx xxx"
                        className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none 
                                  focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
                      />
                    </div>


                    <div>
                      <label className="block text-sm font-semibold text-blue-900 mb-1">
                        Category
                      </label>
                      <select
                        name="category"
                        value={formData.category}
                        onChange={handleChange}
                        className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none 
                                   focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Order Details */}
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-1">
                      Order Details
                    </label>
                    <textarea
                      name="orderDetails"
                      value={formData.orderDetails}
                      onChange={handleChange}
                      placeholder="Describe the order..."
                      className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none 
                                 focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition h-28"
                      required
                    />
                  </div>

                  {/* Price */}
                  <div>
                    <label className="block text-sm font-semibold text-blue-900 mb-1">
                      Price (UGX)
                    </label>
                    <input
                      type="number"
                      name="price"
                      value={formData.price === 0 ? "" : formData.price}
                      onChange={handleChange}
                      placeholder="Enter price"
                      className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none 
                                 focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
                      required
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    className="w-full bg-blue-600 py-3 rounded-xl text-white font-semibold hover:bg-blue-700 transition"
                  >
                    Submit Order
                  </button>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FILTERS */}
        <div className="bg-white/95 backdrop-blur-md p-6 rounded-xl shadow-lg border border-blue-400 mb-8 max-w-7xl mx-auto">
          <h3 className="text-lg font-semibold text-blue-900 mb-6">Search & Filter</h3>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-end">
            <input
              type="text"
              placeholder="Search by client or order..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
            />

            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as any)}
              className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
            >
              <option value="All">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <input
              type="number"
              placeholder="Min Price"
              value={filterMinPrice}
              onChange={(e) =>
                setFilterMinPrice(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
            />

            <input
              type="number"
              placeholder="Max Price"
              value={filterMaxPrice}
              onChange={(e) =>
                setFilterMaxPrice(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="p-3 w-full border-2 border-blue-500 bg-blue-50 text-blue-900 rounded-lg outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-600 transition"
            />

            {/* <button
              onClick={resetFilters}
              className="w-full lg:w-auto px-4 py-3 rounded-lg border border-blue-500 bg-blue-100 hover:bg-blue-200 text-blue-900 font-semibold transition"
            >
              Reset
            </button> */}
          </div>

          <p className="mt-4 text-sm text-blue-900">
            Showing <strong>{filteredOrders.length}</strong> of <strong>{orders.length}</strong> orders
          </p>
        </div>

        {/* ORDERS TABLE */}
        <div className="bg-white/95 backdrop-blur-md p-6 rounded-xl shadow-lg border border-blue-400">
          <h2 className="text-xl font-semibold mb-6 text-blue-900">Recent Orders</h2>

          <div className="overflow-hidden border border-blue-300 rounded-xl">
            <table className="w-full text-left">
              <thead className="bg-blue-100 text-blue-900">
                <tr>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium">Client</th>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium">Phone</th>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium">Order</th>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium">Category</th>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium">Price</th>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium">Date</th>
                  <th className="px-4 py-3 border-b border-blue-300 font-medium text-center">Receipt</th>
                </tr>
              </thead>

              <tbody>
                {filteredOrders.length ? (
                  filteredOrders.map((o, index) => (
                    <tr
                      key={o.id}
                      className={`border-b hover:bg-blue-50 transition ${
                        index % 2 === 0 ? "bg-white" : "bg-blue-50/50"
                      }`}
                    >
                      <td className="px-4 py-3 text-blue-900">{o.clientName}</td>
                      <td className="px-4 py-3 text-blue-900">
                        {o.clientPhoneNumber || "-"}
                      </td>

                      <td className="px-4 py-3 text-blue-900">{o.orderDetails}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-sm font-medium ${categoryColors[o.category]}`}
                        >
                          {o.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-blue-900">{o.price.toLocaleString()} UGX</td>
                      <td className="px-4 py-3 text-blue-900">{new Date(o.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => printReceipt(o)}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                        >
                          Print
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-blue-900">
                      No orders match your filters.
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
