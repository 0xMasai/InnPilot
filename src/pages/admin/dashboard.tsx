// The separate admin shell was retired: admins and staff now share one
// role-aware shell (src/dashboard.tsx). Admin record-management pages live
// under /dashboard/records/*. This stub only redirects legacy links.
import { Navigate } from "react-router-dom";

const AdminHome = () => <Navigate to="/dashboard" replace />;

export default AdminHome;
