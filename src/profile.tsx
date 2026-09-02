import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getDocs, query, where } from "firebase/firestore";
import { auth } from "../firebase";
import { hotelCollection } from "./lib/hotelScope";
import { useAuth } from "./auth/AuthProvider";
import { Utensils, DollarSign, BedDouble, ArrowLeft, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

const ITEMS_PER_PAGE = 5;

// Fields to display per collection
const FIELDS = {
  accomodation: [
    "guestName",
    "guestEmail",
    "roomType",
    "numberOfGuests",
    "checkIn",
    "checkOut",
    "paymentStatus",
    "pricePaid",
    "notes",
  ],
  conferenceRooms: [
    "organizerName",
    "email",
    "room",
    "attendees",
    "dateTime",
    "durationHours",
    "price",
    "notes",
  ],
  expenses: ["description", "amount", "category", "date", "department", "notes"],
  restaurant: ["clientName", "orderDetails", "category", "price", "date", "notes"],
};

export default function ProfileDashboard() {
  const { hotelId } = useAuth();
  type TableRow = Record<string, unknown> & { id?: string };

  const [accommodationData, setAccommodationData] = useState<TableRow[]>([]);
  const [conferenceData, setConferenceData] = useState<TableRow[]>([]);
  const [expensesData, setExpensesData] = useState<TableRow[]>([]);
  const [restaurantData, setRestaurantData] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const user = auth.currentUser;
      if (!user || !hotelId) {
        setLoading(false);
        return;
      }

      const uid = user.uid;

      try {
        // Accommodation
        const accomSnap = await getDocs(
          query(hotelCollection(hotelId, "accomodation"), where("userId", "==", uid))
        );
        setAccommodationData(accomSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Conference Rooms
        const confSnap = await getDocs(
          query(hotelCollection(hotelId, "conferenceRooms"), where("userId", "==", uid))
        );
        setConferenceData(confSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Expenses
        const expensesSnap = await getDocs(
          query(hotelCollection(hotelId, "expenses"), where("userId", "==", uid))
        );
        setExpensesData(expensesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Restaurant
        const restaurantSnap = await getDocs(
          query(hotelCollection(hotelId, "restaurant"), where("userId", "==", uid))
        );
        setRestaurantData(restaurantSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [hotelId]);

  if (loading)
    return (
      <div className="flex items-center justify-center h-[70vh] text-gray-400 font-medium">
        Loading your submissions...
      </div>
    );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="p-6 bg-gray-50 min-h-screen w-full space-y-8"
    >
      {/* Back Button */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 font-medium mb-2"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <h2 className="text-3xl font-bold text-gray-900 mb-6">👤 Your Submissions</h2>

      {/* Accommodation */}
      <TableSection
        icon={<BedDouble size={20} className="text-green-600" />}
        title="Accommodation Bookings"
        data={accommodationData}
        fields={FIELDS.accomodation}
      />

      {/* Conference Rooms */}
      <TableSection
        icon={<BedDouble size={20} className="text-purple-600" />}
        title="Conference Room Bookings"
        data={conferenceData}
        fields={FIELDS.conferenceRooms}
      />

      {/* Expenses */}
      <TableSection
        icon={<DollarSign size={20} className="text-blue-600" />}
        title="Expenses Records"
        data={expensesData}
        fields={FIELDS.expenses}
      />

      {/* Restaurant */}
      <TableSection
        icon={<Utensils size={20} className="text-orange-500" />}
        title="Restaurant Submissions"
        data={restaurantData}
        fields={FIELDS.restaurant}
      />
    </motion.div>
  );
}

const TableSection = ({
  icon,
  title,
  data,
  fields,
}: {
  icon: React.ReactNode;
  title: string;
  data: Array<Record<string, unknown> & { id?: string }>;
  fields: string[];
}) => {
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredData = data.filter((item) =>
    fields.some((field) =>
      String(item[field] || "").toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const canLoadMore = visibleCount < filteredData.length;

  return (
    <div className="bg-white p-6 rounded-2xl shadow-md border border-gray-100 space-y-4 w-full">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100">
          {icon}
        </div>
        <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
      </div>

      {/* Search */}
      <div className="flex items-center border border-gray-200 rounded-xl px-3 py-2 w-full max-w-full mb-3 bg-white">
        <Search size={16} className="text-gray-400 mr-2" />
        <input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full outline-none text-gray-700"
        />
      </div>

      {/* Table */}
      {filteredData.length > 0 ? (
        <div className="overflow-x-auto w-full">
          <table className="min-w-full border-collapse text-sm text-gray-700">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-200 uppercase text-gray-600">
                {fields.map((field) => (
                  <th key={field} className="py-2 px-4 text-left whitespace-nowrap">
                    {field.replace(/([A-Z])/g, " $1")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.slice(0, visibleCount).map((item, index) => (
                <tr
                  key={String(item.id ?? index)}
                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  {fields.map((field) => {
                    const value = item[field];
                    // Format timestamps nicely
                    if (value && typeof value === "object" && "toDate" in value) {
                      const dateish = value as { toDate?: () => Date };
                      if (typeof dateish.toDate === "function") {
                        return (
                          <td key={field} className="py-2 px-4 whitespace-nowrap">
                            {dateish.toDate().toLocaleString()}
                          </td>
                        );
                      }
                    }
                    return (
                      <td key={field} className="py-2 px-4 truncate max-w-[200px] whitespace-nowrap">
                        {String(value || "-")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-400 italic">No submissions found.</p>
      )}

      {canLoadMore && (
        <button
          onClick={() => setVisibleCount((prev) => prev + ITEMS_PER_PAGE)}
          className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition"
        >
          Load More
        </button>
      )}
    </div>
  );
};  