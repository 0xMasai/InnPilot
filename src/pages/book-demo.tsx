import { useState } from "react";
import type { FormEvent } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Send,
} from "lucide-react";

import innpilotLogoLight from "../assets/brand/innpilot-logo-full-light.png";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

/* ------------------------------------------------------------
   Common countries (autocomplete list, not exhaustive)
   ------------------------------------------------------------ */
const COUNTRIES = [
  "Uganda", "Kenya", "Tanzania", "Rwanda", "Burundi", "South Sudan",
  "Ethiopia", "Nigeria", "Ghana", "South Africa", "Egypt", "Morocco",
  "United States", "United Kingdom", "Canada", "Germany", "France",
  "Netherlands", "Spain", "Italy", "United Arab Emirates", "India",
  "China", "Australia", "Brazil", "Other",
];

/* ------------------------------------------------------------
   Form types
   ------------------------------------------------------------ */
interface DemoRequestPayload {
  fullName: string;
  hotelName: string;
  workEmail: string;
  phone: string;
  rooms: string;
  country: string;
  message: string;
}

type FormErrors = Partial<Record<keyof DemoRequestPayload, string>>;

const EMPTY_FORM: DemoRequestPayload = {
  fullName: "",
  hotelName: "",
  workEmail: "",
  phone: "",
  rooms: "",
  country: "",
  message: "",
};

/* ------------------------------------------------------------
   INTEGRATION POINT
   ------------------------------------------------------------
   There is currently no lead-storage backend wired up for this
   form (no Firestore collection, API route, or third-party form
   service). This function is where that integration belongs —
   for example:
     - writing to a dedicated Firestore "demoRequests" collection
       (kept separate from PMS data, with its own security rules)
     - POSTing to a serverless/API endpoint that forwards the
       lead to email or a CRM
     - a hosted form backend (e.g. Formspree, Getform, Resend)
   Right now it only resolves locally — nothing leaves the browser
   and no lead data is actually saved anywhere yet.
   ------------------------------------------------------------ */
async function submitDemoRequest(payload: DemoRequestPayload): Promise<void> {
  // TODO: replace with a real submission call once a backend exists.
  console.warn(
    "[book-demo] No backend is connected yet — this request was not saved:",
    payload
  );
  return new Promise((resolve) => setTimeout(resolve, 600));
}

const FieldError = ({ message }: { message?: string }) =>
  message ? <p className="mt-1 text-xs text-[var(--danger)]">{message}</p> : null;

const BookDemoPage = () => {
  const [form, setForm] = useState<DemoRequestPayload>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");

  const update = (field: keyof DemoRequestPayload) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    if (errors[field]) setErrors((er) => ({ ...er, [field]: undefined }));
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!form.fullName.trim()) next.fullName = "Full name is required.";
    if (!form.hotelName.trim()) next.hotelName = "Hotel / property name is required.";
    if (!form.workEmail.trim()) {
      next.workEmail = "Work email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.workEmail.trim())) {
      next.workEmail = "Enter a valid email address.";
    }
    if (!form.phone.trim()) next.phone = "Phone / WhatsApp number is required.";
    if (!form.country.trim()) next.country = "Country is required.";
    return next;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError("");
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await submitDemoRequest(form);
      setSubmitted(true);
    } catch {
      setSubmitError("Something went wrong sending your request. Please try again or email us directly.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full font-poppins text-slate-800" style={{ background: "var(--app-bg)" }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-3">
          <Link to="/landing">
            <img src={innpilotLogoLight} alt="InnPilot" className="h-8 w-auto object-contain" />
          </Link>
          <Link
            to="/landing"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 transition"
          >
            <ArrowLeft size={16} />
            Back to landing page
          </Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-14 sm:py-20">
        {submitted ? (
          <motion.div
            initial="hidden"
            animate="show"
            variants={fadeUp}
            className="card p-8 sm:p-12 text-center max-w-lg mx-auto"
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ background: "var(--success-soft)", color: "var(--success)" }}
            >
              <CheckCircle2 size={28} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Thanks!</h1>
            <p className="text-slate-500 leading-relaxed mb-8">
              Your demo request has been received. We'll be in touch shortly.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link to="/landing" className="btn btn-primary px-6 py-3 text-sm inline-flex items-center justify-center gap-2">
                Back to landing page <ArrowRight size={16} />
              </Link>
              <Link
                to="/login"
                className="px-6 py-3 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
              >
                Sign In
              </Link>
            </div>
          </motion.div>
        ) : (
          <>
            <motion.div initial="hidden" animate="show" variants={fadeUp} className="max-w-xl mb-8 sm:mb-10">
              <span className="inline-block text-xs font-semibold tracking-wide uppercase text-[var(--primary)] mb-3">
                Book a demo
              </span>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">Let's show you InnPilot</h1>
              <p className="text-slate-500 leading-relaxed">
                Tell us a bit about your property and we'll set up a walkthrough tailored to how you run it.
              </p>
            </motion.div>

            <motion.form
              initial="hidden"
              animate="show"
              variants={fadeUp}
              onSubmit={handleSubmit}
              noValidate
              className="card p-6 sm:p-8 space-y-5"
            >
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="fullName" className="field-label">Full Name <span className="req">*</span></label>
                  <input
                    id="fullName"
                    type="text"
                    value={form.fullName}
                    onChange={update("fullName")}
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby="fullName-error"
                    className="input"
                    placeholder="Jane Doe"
                  />
                  <div id="fullName-error"><FieldError message={errors.fullName} /></div>
                </div>
                <div>
                  <label htmlFor="hotelName" className="field-label">Hotel / Property Name <span className="req">*</span></label>
                  <input
                    id="hotelName"
                    type="text"
                    value={form.hotelName}
                    onChange={update("hotelName")}
                    aria-invalid={Boolean(errors.hotelName)}
                    aria-describedby="hotelName-error"
                    className="input"
                    placeholder="Lakeview Hotel"
                  />
                  <div id="hotelName-error"><FieldError message={errors.hotelName} /></div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="workEmail" className="field-label">Work Email <span className="req">*</span></label>
                  <input
                    id="workEmail"
                    type="email"
                    value={form.workEmail}
                    onChange={update("workEmail")}
                    aria-invalid={Boolean(errors.workEmail)}
                    aria-describedby="workEmail-error"
                    className="input"
                    placeholder="jane@yourhotel.com"
                  />
                  <div id="workEmail-error"><FieldError message={errors.workEmail} /></div>
                </div>
                <div>
                  <label htmlFor="phone" className="field-label">Phone / WhatsApp <span className="req">*</span></label>
                  <input
                    id="phone"
                    type="tel"
                    value={form.phone}
                    onChange={update("phone")}
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby="phone-error"
                    className="input"
                    placeholder="+256 700 000000"
                  />
                  <div id="phone-error"><FieldError message={errors.phone} /></div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="rooms" className="field-label">Number of Rooms</label>
                  <input
                    id="rooms"
                    type="number"
                    min={1}
                    value={form.rooms}
                    onChange={update("rooms")}
                    className="input"
                    placeholder="e.g. 24"
                  />
                </div>
                <div>
                  <label htmlFor="country" className="field-label">Country <span className="req">*</span></label>
                  <input
                    id="country"
                    list="country-options"
                    type="text"
                    value={form.country}
                    onChange={update("country")}
                    aria-invalid={Boolean(errors.country)}
                    aria-describedby="country-error"
                    className="input"
                    placeholder="Uganda"
                  />
                  <datalist id="country-options">
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <div id="country-error"><FieldError message={errors.country} /></div>
                </div>
              </div>

              <div>
                <label htmlFor="message" className="field-label">Message / What would you like to see?</label>
                <textarea
                  id="message"
                  rows={4}
                  value={form.message}
                  onChange={update("message")}
                  className="input resize-none"
                  placeholder="Tell us about your property, current tools, or anything specific you'd like covered in the demo."
                />
              </div>

              {submitError && (
                <p className="text-sm text-[var(--danger)]" role="alert">{submitError}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary w-full sm:w-auto px-8 py-3 text-sm inline-flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    Request Demo <Send size={16} />
                  </>
                )}
              </button>
              <p className="text-xs text-slate-400">
                By submitting, you agree to be contacted by the InnPilot team about your request.
              </p>
            </motion.form>
          </>
        )}
      </div>
    </div>
  );
};

export default BookDemoPage;
