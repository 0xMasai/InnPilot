import { useState, useEffect } from "react";
import {
  onSnapshot,
  // deleteDoc,
  updateDoc,
} from "firebase/firestore";
import { auth } from "../../../firebase";
import { hotelCollection, hotelDoc } from "../../lib/hotelScope";
import { useAuth } from "../../auth/AuthProvider";
import { Printer, Search, Pencil, Utensils, X, Download, FileSpreadsheet } from "lucide-react";
import { exportToCsv, exportToPdf } from "../../lib/exportUtils";

interface Order {
  id?: string;
  clientName: string;
  orderDetails: string;
  category: "Breakfast" | "Lunch" | "Dinner" | "Cocktails";
  price: number;
  userId: string;
  createdAt: string;
}

const categories = ["Breakfast", "Lunch", "Dinner", "Cocktails"] as const;
const categoryColors: Record<typeof categories[number], string> = {
  Breakfast: "badge badge-warning badge-plain",
  Lunch: "badge badge-success badge-plain",
  Dinner: "badge badge-info badge-plain",
  Cocktails: "badge badge-neutral badge-plain",
};

export default function AdminRestaurantDashboard() {
  const { hotelId } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit modal state
  const [isEditing, setIsEditing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);

  const [clientFilter, setClientFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"" | Order["category"]>("");
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);


  useEffect(() => {
    if (!auth.currentUser || !hotelId) return;

    const ordersRef = hotelCollection(hotelId, "restaurant");

    const unsub = onSnapshot(ordersRef, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Order),
      }));
      setOrders(
        data.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      );
      setLoading(false);
    });

    return () => unsub();
  }, [hotelId]);

  useEffect(() => {
  let filtered = [...orders];

  if (clientFilter.trim()) {
    filtered = filtered.filter((o) =>
      o.clientName.toLowerCase().includes(clientFilter.toLowerCase())
    );
  }

  if (categoryFilter) {
    filtered = filtered.filter((o) => o.category === categoryFilter);
  }

  setFilteredOrders(filtered);
}, [orders, clientFilter, categoryFilter]);


  // const printReceipt = (order: Order) => {
  //   const receiptWindow = window.open("", "PRINT", "height=600,width=400");
  //   if (!receiptWindow) return;

  //   receiptWindow.document.write(`<html><head><title>Receipt</title></head><body>`);
  //   receiptWindow.document.write(`<h2 style="font-family:sans-serif;">Restaurant Receipt</h2>`);
  //   receiptWindow.document.write(`<p><strong>Client:</strong> ${order.clientName}</p>`);
  //   receiptWindow.document.write(`<p><strong>Order:</strong> ${order.orderDetails}</p>`);
  //   receiptWindow.document.write(`<p><strong>Category:</strong> ${order.category}</p>`);
  //   receiptWindow.document.write(`<p><strong>Price:</strong> ${order.price.toLocaleString()} UGX</p>`);
  //   receiptWindow.document.write(`<p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleString()}</p>`);
  //   receiptWindow.document.write(`</body></html>`);
  //   receiptWindow.document.close();
  //   receiptWindow.focus();
  //   receiptWindow.print();
  // };

  const printRestaurantOrders = () => {
  const printWindow = window.open("", "PRINT", "height=600,width=1000");
  if (!printWindow) return;

  printWindow.document.write("<html><head><title>Restaurant Orders</title>");
  printWindow.document.write(`
    <style>
      body { font-family: Arial, sans-serif; color: black; padding: 20px; }
      h2 { text-align: center; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
      th, td { border: 1px solid #000; padding: 6px 8px; text-align: left; }
      th { background: #f3f4f6; font-weight: bold; }
    </style>
  `);
  printWindow.document.write("</head><body>");

  printWindow.document.write("<h2>Restaurant Orders</h2>");
  printWindow.document.write(
    `<p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>`
  );

  printWindow.document.write("<table>");
  printWindow.document.write(`
    <thead>
      <tr>
        <th>Client</th>
        <th>Order Details</th>
        <th>Category</th>
        <th>Price (UGX)</th>
        <th>Date</th>
      </tr>
    </thead>
  `);

  printWindow.document.write("<tbody>");

  filteredOrders.forEach((o) => {
    printWindow.document.write(`
      <tr>
        <td>${o.clientName}</td>
        <td>${o.orderDetails}</td>
        <td>${o.category}</td>
        <td>${o.price.toLocaleString()}</td>
        <td>${new Date(o.createdAt).toLocaleString()}</td>
      </tr>
    `);
  });

  printWindow.document.write("</tbody></table>");
  printWindow.document.write("</body></html>");

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
};

const handleExportCsv = () => {
  exportToCsv({
    title: "Restaurant Orders Report",
    subtitle: "Dining and bar orders across property",
    filename: "restaurant-orders",
    columns: ["Client Name", "Category", "Order Details", "Price (UGX)", "Created Date"],
    rows: filteredOrders.map((o) => [
      o.clientName,
      o.category,
      o.orderDetails,
      o.price,
      new Date(o.createdAt).toLocaleString(),
    ]),
    kpis: [
      { label: "Total Orders", value: String(filteredOrders.length) },
      { label: "Total Sales", value: `UGX ${filteredOrders.reduce((sum, o) => sum + (Number(o.price) || 0), 0).toLocaleString()}` },
    ],
  });
};

const handleExportPdf = () => {
  exportToPdf({
    title: "Restaurant Orders Report",
    subtitle: "Dining and bar orders across property",
    filename: "restaurant-orders",
    columns: ["Client Name", "Category", "Order Details", "Price (UGX)", "Created Date"],
    rows: filteredOrders.map((o) => [
      o.clientName,
      o.category,
      o.orderDetails,
      o.price.toLocaleString(),
      new Date(o.createdAt).toLocaleString(),
    ]),
    kpis: [
      { label: "Total Orders", value: String(filteredOrders.length) },
      { label: "Total Sales", value: `UGX ${filteredOrders.reduce((sum, o) => sum + (Number(o.price) || 0), 0).toLocaleString()}` },
    ],
  });
};

  // const handleDelete = async (id: string | undefined) => {
  //   if (!id) return;
  //   if (!confirm("Are you sure you want to delete this order?")) return;

  //   try {
  //     await deleteDoc(doc(db, "restaurant", id));
  //     alert("Order deleted successfully.");
  //   } catch (err) {
  //     console.error(err);
  //     alert("Failed to delete order.");
  //   }
  // };

  // ---- EDIT FUNCTIONS ----
  const startEditing = (order: Order) => {
    setCurrentOrder(order);
    setIsEditing(true);
  };

  const saveEdit = async () => {
    if (!currentOrder?.id || !hotelId) return;

    try {
      await updateDoc(hotelDoc(hotelId, "restaurant", currentOrder.id), {
        clientName: currentOrder.clientName,
        orderDetails: currentOrder.orderDetails,
        category: currentOrder.category,
        price: currentOrder.price,
      });

      setIsEditing(false);
      alert("Order updated successfully.");
    } catch (err) {
      console.error(err);
      alert("Failed to update order.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Restaurant Orders</h1>
          <p className="page-subtitle">All dining orders across the property.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={printRestaurantOrders} className="btn btn-secondary">
            <Printer size={16} /> Print
          </button>
          <button onClick={handleExportCsv} className="btn btn-secondary">
            <FileSpreadsheet size={16} /> CSV
          </button>
          <button onClick={handleExportPdf} className="btn btn-primary">
            <Download size={16} /> PDF
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="filter-bar">
        <h3 className="section-title mb-3">Filter orders</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
          <div className="search-wrap">
            <Search size={16} />
            <input type="text" aria-label="Filter by client name" placeholder="Filter by client name" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="input" />
          </div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as "" | Order["category"])} className="select" aria-label="Category">
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Orders Table */}
      <div className="card card-pad">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {["Client", "Order Details", "Category", "Price", "Date", "Actions"].map((title) => (
                  <th key={title}>{title}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, width: j === 1 ? 140 : 70 }} /></td>
                    ))}
                  </tr>
                ))
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-icon"><Utensils size={24} /></div>
                      <p className="empty-title">No orders found</p>
                      <p className="empty-desc">No restaurant orders match your filters yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id}>
                    <td className="font-medium text-slate-800">{order.clientName}</td>
                    <td className="max-w-xs truncate">{order.orderDetails}</td>
                    <td>
                      <span className={categoryColors[order.category]}>{order.category}</span>
                    </td>
                    <td className="font-medium">{order.price.toLocaleString()} UGX</td>
                    <td className="text-slate-500 whitespace-nowrap">{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      <button onClick={() => startEditing(order)} className="btn btn-secondary btn-sm">
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
      {isEditing && currentOrder && (
        <div className="modal-overlay" onClick={() => setIsEditing(false)}>
          <div className="modal-panel max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit order">
            <div className="modal-header">
              <h2 className="modal-title">Edit Order</h2>
              <button className="icon-btn" onClick={() => setIsEditing(false)} aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="field-label">Client name</label>
                <input type="text" value={currentOrder.clientName} onChange={(e) => setCurrentOrder({ ...currentOrder, clientName: e.target.value })} placeholder="Client name" className="input" />
              </div>
              <div>
                <label className="field-label">Order details</label>
                <input type="text" value={currentOrder.orderDetails} onChange={(e) => setCurrentOrder({ ...currentOrder, orderDetails: e.target.value })} placeholder="Order details" className="input" />
              </div>
              <div>
                <label className="field-label">Category</label>
                <select value={currentOrder.category} onChange={(e) => setCurrentOrder({ ...currentOrder, category: e.target.value as Order["category"] })} className="select">
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Price (UGX)</label>
                <input type="number" value={currentOrder.price} onChange={(e) => setCurrentOrder({ ...currentOrder, price: Number(e.target.value) })} placeholder="Price" className="input" />
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setIsEditing(false)} className="btn btn-secondary">Cancel</button>
                <button onClick={saveEdit} className="btn btn-primary">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
