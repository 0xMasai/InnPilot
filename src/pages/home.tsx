import { motion } from "framer-motion";
import { Swiper, SwiperSlide } from "swiper/react";
import 'swiper/swiper-bundle.css';
// import "swiper/css";                          // REQUIRED
// import "swiper/css/pagination";               // REQUIRED
import { Autoplay, Pagination } from "swiper/modules";

import { BedDouble, Utensils, Briefcase, PieChart, Hotel } from "lucide-react";
import { Link } from "react-router-dom";

import backgroundImage from "../assets/hotel.jpeg";
import preview1 from "../assets/preview.png";
import preview2 from "../assets/preview1.png";

const LandingPage = () => {
  return (
    <div className="min-h-screen flex flex-col text-gray-800 font-poppins relative">
      {/* Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat filter blur-md"
        style={{ backgroundImage: `url(${backgroundImage})` }}
      ></div>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-linear-to-b from-black/60 via-black/40 to-black/70"></div>

      {/* Page Content */}
      <div className="relative z-10 flex flex-col">
        {/* Navbar */}
        <nav className="flex justify-between items-center px-10 py-5 bg-white/60 backdrop-blur-xl shadow-sm border-b border-white/40 sticky top-0 z-50">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center space-x-3"
          >
            <Hotel className="w-8 h-8 text-blue-600" />
            <span className="text-xl font-extrabold text-slate-900">
              Jamiz Hotel - Mubende
            </span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-x-4 flex items-center"
          >
            <Link
              to="/login"
              className="px-5 py-2.5 text-sm font-semibold text-blue-700 border border-blue-700 rounded-xl hover:bg-blue-700 hover:text-white transition-all duration-300 shadow-sm"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="px-5 py-2.5 text-sm font-semibold text-blue-700 border border-blue-700 rounded-xl hover:bg-blue-700 hover:text-white transition-all duration-300 shadow-sm"
            >
              Sign Up
            </Link>
          </motion.div>
        </nav>

        {/* Hero */}
        <section className="flex flex-col md:flex-row items-center justify-between px-10 md:px-20 mt-24 gap-16 relative">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="flex-1 space-y-6 max-w-xl"
          >
            <h2 className="text-5xl md:text-6xl font-extrabold leading-tight text-white drop-shadow-lg">
              Streamline Your Hotel Operations Effortlessly
            </h2>
            <p className="text-gray-200 text-lg leading-relaxed">
              All-in-one hotel management solution to handle reservations, dining, expenses, and conferences with ease.
            </p>

            <div className="flex gap-4 pt-2">
              <Link
                to="/signup"
                className="px-6 py-3 bg-blue-700 text-white rounded-xl font-semibold hover:bg-blue-800 shadow-lg transition"
              >
                Get Started
              </Link>
              <Link
                to="/admin/login"
                className="px-6 py-3 bg-white/80 backdrop-blur-xl border border-gray-200 rounded-xl font-semibold text-blue-700 hover:border-blue-500 hover:text-blue-800 shadow-md transition"
              >
                Admin Login
              </Link>
            </div>
          </motion.div>

          {/* Mockup + Swiper */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="flex-1 flex justify-center"
          >
            <div className="relative w-full max-w-md">
              {/* Glow */}
              <div className="absolute -inset-5 bg-linear-to-tr from-blue-300/40 via-blue-200/20 to-transparent rounded-3xl blur-3xl opacity-80"></div>

              {/* Card */}
              <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl overflow-hidden border border-white/40">
                <div className="bg-blue-700 text-white text-center py-3 font-medium tracking-wide">
                  Dashboard Preview
                </div>

                {/* Swiper Slider */}
                <div className="h-64 w-full overflow-hidden">
                  <Swiper
                    modules={[Pagination, Autoplay]}
                    pagination={{ clickable: true }}
                    loop={true}
                    slidesPerView={1}
                    autoplay={{
                      delay: 3000,
                      disableOnInteraction: false,
                    }}
                    className="h-full w-full"
                  >
                    <SwiperSlide className="w-full h-full">
                      <img
                        src={preview1}
                        alt="Dashboard Preview 1"
                        className="w-full h-full object-cover"
                      />
                    </SwiperSlide>

                    <SwiperSlide className="w-full h-full">
                      <img
                        src={preview2}
                        alt="Dashboard Preview 2"
                        className="w-full h-full object-cover"
                      />
                    </SwiperSlide>
                  </Swiper>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Features */}
        <section className="mt-32 px-10 md:px-24">
          <h3 className="text-4xl font-extrabold text-center text-white mb-16 drop-shadow-lg">
            Manage Every Department with Ease
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            {[
              {
                icon: <BedDouble size={34} />,
                title: "Accommodation",
                desc: "Easily manage room bookings, check-ins, and guest profiles.",
              },
              {
                icon: <Utensils size={34} />,
                title: "Restaurant",
                desc: "Track meal orders, dining reservations, and kitchen inventory.",
              },
              {
                icon: <Briefcase size={34} />,
                title: "Conference",
                desc: "Organize meeting spaces and handle billing seamlessly.",
              },
              {
                icon: <PieChart size={34} />,
                title: "Expenses",
                desc: "Monitor your hotel’s financial performance in real-time.",
              },
            ].map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="bg-white/90 backdrop-blur-xl p-8 rounded-3xl shadow-xl border border-white/50 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 text-center"
              >
                <div className="flex justify-center mb-4 text-blue-700">{f.icon}</div>
                <h4 className="text-xl font-bold mb-2 text-blue-900">{f.title}</h4>
                <p className="text-gray-600 text-sm leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-gray-200 py-8 bg-black/50 border-t border-white/20 mt-24">
          <p className="text-sm">
            © {new Date().getFullYear()}{" "}
            <span className="font-semibold text-blue-300">Jamiz Hotel — Mubende</span>. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default LandingPage;
