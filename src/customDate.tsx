// CustomDateInput.tsx
import { forwardRef } from "react";
import { FiCalendar } from "react-icons/fi";

interface DateInputProps {
  value?: string;
  onClick?: () => void;
  placeholder?: string;
}

const CustomDateInput = forwardRef<HTMLDivElement, DateInputProps>(
  ({ value, onClick, placeholder }, ref) => {
    return (
      <div
        ref={ref}
        onClick={onClick} // forward click to react-datepicker
        className="flex items-center p-2 border rounded border-gray-300 text-gray-800 cursor-pointer w-full bg-white hover:border-blue-500 transition"
      >
        <FiCalendar className="mr-2 text-gray-400" />
        <span className={`${value ? "text-gray-800" : "text-gray-400"}`}>
          {value || placeholder}
        </span>
      </div>
    );
  }
);

CustomDateInput.displayName = "CustomDateInput";
export default CustomDateInput;
