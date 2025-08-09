import * as React from "react";
export function Pill({children, className=""}:{children:React.ReactNode,className?:string}){
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${className}`}>{children}</span>;
}
