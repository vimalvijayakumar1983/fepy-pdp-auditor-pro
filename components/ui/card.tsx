import * as React from "react";
export function Card({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={`rounded-2xl bg-white ${className}`} {...props}/> }
export function CardHeader({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={`px-6 py-4 ${className}`} {...props}/> }
export function CardContent({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>){ return <div className={`px-6 py-4 ${className}`} {...props}/> }
export function CardTitle({ className="", ...props }: React.HTMLAttributes<HTMLHeadingElement>){ return <h2 className={`text-lg font-semibold ${className}`} {...props}/> }
