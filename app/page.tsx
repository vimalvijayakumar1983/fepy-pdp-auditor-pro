import Link from "next/link";

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 40, fontFamily: "Georgia, serif", color: "#302E2C" }}>
      <p style={{ letterSpacing: 3, color: "#956B43" }}>FEPY</p>
      <h1 style={{ fontWeight: 500, fontSize: 44 }}>PDP auditor</h1>
      <p>Score catalog rows, find missing specs and weak product copy, and review suggested corrections before anything is published.</p>
      <Link href="/catalog" style={{ display: "inline-block", marginTop: 16, background: "#302E2C", color: "#F8D798", padding: "12px 18px", textDecoration: "none" }}>Open catalog audit</Link>
    </main>
  );
}
