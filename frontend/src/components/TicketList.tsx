import Link from "next/link";
import type { Ticket } from "@/lib/api";
import { money, relationLabel, slaText, statusLabel, statusTone } from "@/lib/format";

export function StatusChip({ status }: { status: Ticket["status"] }) {
  return <span className={`chip ${statusTone[status]}`}>{statusLabel[status]}</span>;
}

export function FlagText({ t }: { t: Ticket }) {
  const danger = t.flags.find((f) => f.level === "danger");
  const warn = t.flags.find((f) => f.level === "warn");
  if (danger) return <span className="flag-danger">{danger.message}</span>;
  if (warn) return <span className="flag-warn">{warn.message}</span>;
  if (t.status === "draft") return <span className="muted small">—</span>;
  return <span className="flag-ok">ผ่านการตรวจเบื้องต้น</span>;
}

// รายการเรื่องสำหรับเจ้าหน้าที่: เป็นการ์ดบนมือถือ และเป็นตารางบน PC (จัดด้วย grid-template-areas ใน CSS)
export function StaffTicketList({ tickets }: { tickets: Ticket[] }) {
  return (
    <div className="tlist" role="table" aria-label="รายการเรื่อง">
      <div className="thead" role="row">
        <span role="columnheader">Ticket</span>
        <span role="columnheader">ผู้ยื่น / ผู้ป่วย</span>
        <span role="columnheader">ประเภท</span>
        <span role="columnheader">สถานพยาบาล</span>
        <span role="columnheader" style={{ textAlign: "right" }}>ยอดขอเบิก</span>
        <span role="columnheader">สถานะ</span>
        <span role="columnheader">SLA</span>
        <span role="columnheader">ธงจาก AI</span>
      </div>
      {tickets.map((t) => {
        const sla = slaText(t.slaDue);
        return (
          <Link key={t.id} href={`/queue/${t.id}`} className="titem" role="row">
            <span className="c-code" role="cell">{t.code}</span>
            <span className="c-who" role="cell">
              {t.requesterName}
              <span className="small muted" style={{ display: "block", fontWeight: 400 }}>
                ผู้ป่วย: {relationLabel[t.relation]}
              </span>
            </span>
            <span className="c-type" role="cell">{t.treatmentType}</span>
            <span className="c-hosp" role="cell">{t.hospital || "—"}</span>
            <span className="c-amt num" role="cell">{money(t.amountRequested)}</span>
            <span className="c-status" role="cell"><StatusChip status={t.status} /></span>
            <span className={`c-sla small ${sla.urgent ? "sla-urgent" : "muted"}`} role="cell">{sla.text}</span>
            <span className="c-meta" aria-hidden>
              <StatusChip status={t.status} /> {t.treatmentType} · {t.hospital || "—"}
            </span>
            <span className="c-flag" role="cell"><FlagText t={t} /></span>
          </Link>
        );
      })}
    </div>
  );
}
