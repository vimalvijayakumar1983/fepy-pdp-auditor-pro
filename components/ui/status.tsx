import { Pill } from "./pills";
export function StatusBadge({ ok, label }: { ok: boolean, label: string }){
  const cls = ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800";
  return <Pill className={cls}>{label}: {ok ? "YES" : "NO"}</Pill>;
}
export function ScoreBar({ value }:{ value:number }){
  const bar = value>=80? "bg-emerald-500" : value>=50? "bg-amber-500" : "bg-rose-500";
  const v = Math.max(0, Math.min(100, value));
  return (<div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden"><div className={`h-2 ${bar}`} style={{ width: `${v}%` }} /></div>);
}
