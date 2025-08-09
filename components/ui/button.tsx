import * as React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default"|"outline"|"ghost", size?: "sm"|"md" };
export function Button({ className="", variant="default", size="md", ...props }: Props){
  const base = "inline-flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
  const variants = {
    default: "bg-indigo-600 text-white hover:opacity-90",
    outline: "border border-gray-300 bg-white hover:bg-gray-50",
    ghost: "bg-transparent hover:bg-gray-100"
  } as const;
  const sizes = { sm: "h-8 px-3 rounded-full text-sm", md: "h-10 px-4 rounded-xl" } as const;
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
