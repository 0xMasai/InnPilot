import { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  // deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import { db, auth } from "../../../firebase";

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
  Breakfast: "bg-yellow-100 text-yellow-800",
  Lunch: "bg-green-100 text-green-800",
  Dinner: "bg-purple-100 text-purple-800",
  Cocktails: "bg-pink-100 text-pink-800",
};

export default function AdminRestaurantDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit modal state
  const [isEditing, setIsEditing] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);

  const [clientFilter, setClientFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"" | Order["category"]>("");
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);


  useEffect(() => {
    if (!auth.currentUser) return;

    const ordersRef = collection(db, "restaurant");

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
  }, []);

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
    if (!currentOrder?.id) return;

    try {
      await updateDoc(doc(db, "restaurant", currentOrder.id), {
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
    <div className="p-8 bg-gray-50 min-h-screen">
      <h1 className="text-4xl font-extrabold mb-6 text-gray-900">
        Restaurant Orders Dashboard
      </h1>

      {/* FILTERS */}
<div className="flex flex-wrap gap-4 mb-6">
  <input
    type="text"
    placeholder="Filter by client name"
    value={clientFilter}
    onChange={(e) => setClientFilter(e.target.value)}
    className="px-3 py-2 border border-black text-black rounded w-60"
  />

  <select
    value={categoryFilter}
    onChange={(e) =>
      setCategoryFilter(e.target.value as "" | Order["category"])
    }
    className="px-3 py-2 border border-black text-black rounded w-48"
  >
    <option value="">All Categories</option>
    {categories.map((cat) => (
      <option key={cat} value={cat}>
        {cat}
      </option>
    ))}
  </select>

  <button
    onClick={printRestaurantOrders}
    className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
  >
    Print Orders
  </button>
</div>


      {/* Orders Table */}
      <div className="overflow-x-auto shadow-lg rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-black">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              {[
                "Client",
                "Order Details",
                "Category",
                "Price",
                "Date",
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
                <td colSpan={6} className="p-4 text-center text-gray-500">
                  Loading orders...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-700">
                  No restaurant orders found.
                </td>
              </tr>
            ) : (
              orders.map((order, idx) => (
                <tr
                  key={order.id}
                  className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                >
                  <td className="px-6 py-4">{order.clientName}</td>
                  <td className="px-6 py-4 max-w-xs truncate">{order.orderDetails}</td>

                  <td className="px-6 py-4">
                    <span
                      className={`px-2 py-1 rounded-full text-sm font-medium ${categoryColors[order.category]}`}
                    >
                      {order.category}
                    </span>
                  </td>

                  <td className="px-6 py-4">{order.price.toLocaleString()} UGX</td>

                  <td className="px-6 py-4">
                    {new Date(order.createdAt).toLocaleString()}
                  </td>

                  {/* Improved Action Buttons */}
                  <td className="px-6 py-4">
                    <div className="flex gap-3">
                      {/* <button
                        onClick={() => printReceipt(order)}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                      >
                        Print
                      </button> */}

                      <button
                        onClick={() => startEditing(order)}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition"
                      >
                        Edit
                      </button>

                      {/* <button
                        onClick={() => handleDelete(order.id)}
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
      {isEditing && currentOrder && (
        <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg text-black">
            <h2 className="text-2xl font-bold mb-4">Edit Order</h2>

            <div className="space-y-3">
              {/* Client Name */}
              <input
                type="text"
                value={currentOrder.clientName}
                onChange={(e) =>
                  setCurrentOrder({ ...currentOrder, clientName: e.target.value })
                }
                placeholder="Client Name"
                className="w-full border px-3 py-2 rounded text-black"
              />

              {/* Order Details */}
              <input
                type="text"
                value={currentOrder.orderDetails}
                onChange={(e) =>
                  setCurrentOrder({ ...currentOrder, orderDetails: e.target.value })
                }
                placeholder="Order Details"
                className="w-full border px-3 py-2 rounded text-black"
              />

              {/* Category */}
              <select
                value={currentOrder.category}
                onChange={(e) =>
                  setCurrentOrder({
                    ...currentOrder,
                    category: e.target.value as Order["category"],
                  })
                }
                className="w-full border px-3 py-2 rounded text-black"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              {/* Price */}
              <input
                type="number"
                value={currentOrder.price}
                onChange={(e) =>
                  setCurrentOrder({
                    ...currentOrder,
                    price: Number(e.target.value),
                  })
                }
                placeholder="Price"
                className="w-full border px-3 py-2 rounded text-black"
              />
            </div>

            <div className="flex justify-end gap-4 mt-6">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-gray-400 text-white rounded"
              >
                Cancel
              </button>

              <button
                onClick={saveEdit}
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
