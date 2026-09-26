"use client";

import { useEffect, useState } from "react";
import { api, errorText, type Ticket } from "@/lib/api";
import { useSession } from "@/components/Session";
import { StaffTicketList } from "@/components/TicketList";
import { IconSearch } from "@/components/Icons";

type Stats = { byStatus: Record<string, number>; overdue: number; dueSoon: number; flagged: number };

const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "mine", label: "ที่ฉันรับไว้" },
  { key: "flagged", label: "มีธง AI" },
  { key: "OPD", label: "OPD" },
  { key: "IPD", label: "IPD" },
] as const;

const subtitle: Record<string, string> = {
  reviewer: "เรื่องที่รอตรวจ เรียงตาม SLA ที่ใกล้หมดก่อน แล้วตามความสำคัญที่ AI ประเมิน",
  approver: "เรื่องที่เจ้าหน้าที่ตรวจแล้ว รอการอนุมัติ",
  finance: "เรื่องที่อนุมัติแล้ว รอบันทึกการจ่ายเงิน",
  admin: "เรื่องที่ยังไม่ปิดทั้งหมด",
};

export default function Queue() {
  const { user } = useSession();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [q, setQ] = useState("");
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams();
    if (filter === "mine") p.set("mine", "1");
    if (filter === "flagged") p.set("flagged", "1");
    if (filter === "OPD" || filter === "IPD") p.set("type", filter);
    if (q.trim()) p.set("q", q.trim());
    const h = setTimeout(() => {
      api<Ticket[]>(`/api/queue?${p}`).then(setTickets).catch((e) => setError(errorText(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(h);
  }, [filter, q]);

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
  }, []);

  const waiting = stats ? (stats.byStatus.pending_review ?? 0) + (stats.byStatus.in_review ?? 0) : null;

  return (
    <>
      <div className="topbar">
        <div className="title">
          <h1>คิวงานของฉัน</h1>
          <span className="muted small">{subtitle[user.role] ?? ""}</span>
        </div>
        <label className="row spacer" htmlFor="q" style={{ background: "var(--surface)", border: "1px solid var(--line-strong)", borderRadius: 12, padding: "0 12px", minHeight: 44, flex: "1 1 260px", maxWidth: 360 }}>
          <IconSearch size={18} />
          <span className="sr-only">ค้นหา</span>
          <input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลข Ticket, ชื่อ, โรงพยาบาล" style={{ border: 0, outline: "none", flex: 1, background: "transparent", minWidth: 0, fontSize: 16 }} />
        </label>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="small muted">รอตรวจ / กำลังตรวจ</span><span className="v">{waiting ?? "–"}</span></div>
        <div className="kpi warn"><span className="small">ใกล้เกิน SLA (≤ 24 ชม.)</span><span className="v">{stats?.dueSoon ?? "–"}</span></div>
        <div className="kpi danger"><span className="small muted">เกิน SLA แล้ว</span><span className="v">{stats?.overdue ?? "–"}</span></div>
        <div className="kpi danger"><span className="small muted">AI ติดธงให้ตรวจละเอียด</span><span className="v">{stats?.flagged ?? "–"}</span></div>
      </div>

      <div className="chips" role="group" aria-label="ตัวกรอง">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip-btn" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="alert danger" role="alert">{error}</div>}
      {tickets === null ? (
        <div className="muted">กำลังโหลด…</div>
      ) : tickets.length === 0 ? (
        <div className="card muted" style={{ textAlign: "center" }}>ไม่มีเรื่องค้างในคิว</div>
      ) : (
        <StaffTicketList tickets={tickets} />
      )}
    </>
  );
}
