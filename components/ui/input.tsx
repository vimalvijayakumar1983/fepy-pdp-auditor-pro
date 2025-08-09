import * as React from "react";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full border border-gray-300 px-3 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 ${className}`}
      />
    );
  }
);

Input.displayName = "Input";
