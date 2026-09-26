import type { HistoryItem, Status } from "@/lib/api";
import { thDateTime } from "@/lib/format";

const STEPS: { key: Status; label: string }[] = [
  { key: "pending_review", label: "ยื่นเรื่องแล้ว" },
  { key: "in_review", label: "เจ้าหน้าที่ตรวจเอกสาร" },
  { key: "pending_approval", label: "รออนุมัติ" },
  { key: "approved", label: "อนุมัติแล้ว" },
  { key: "paid", label: "โอนเงินเข้าบัญชี" },
];

const stepIndex: Partial<Record<Status, number>> = {
  pending_review: 1,
  in_review: 1,
  need_info: 1,
  pending_approval: 2,
  approved: 3,
  paid: 5,
};

// timeline แบบติดตามพัสดุ: ขั้นที่ผ่านแล้ว / ขั้นปัจจุบัน / ขั้นถัดไป
export function Timeline({ status, history }: { status: Status; history: HistoryItem[] }) {
  const when = (s: Status) => [...history].reverse().find((h) => h.toStatus === s)?.createdAt;
  const rejected = status === "rejected";
  const rejectEntry = rejected ? [...history].reverse().find((h) => h.toStatus === "rejected") : undefined;
  // ถ้าไม่อนุมัติ ให้แสดงกากบาทที่ขั้นที่ถูกปฏิเสธ แล้วไม่แสดงขั้นหลังจากนั้น
  const current = rejected ? (stepIndex[rejectEntry?.fromStatus ?? "in_review"] ?? 1) : (stepIndex[status] ?? 0);

  return (
    <ol className="timeline">
      {STEPS.map((s, i) => {
        const done = i < current;
        const isCurrent = i === current && !rejected;
        let sub = done ? thDateTime(when(s.key)) : "";
        let label = s.label;
        if (isCurrent && status === "need_info") {
          label = "รอคุณส่งเอกสาร/ข้อมูลเพิ่ม";
          sub = "เวลานับ SLA หยุดชั่วคราว";
        } else if (isCurrent && status === "pending_review") {
          label = "รอเจ้าหน้าที่รับเรื่อง";
        }
        if (rejected && i > current) return null;
        if (rejected && i === current) {
          return (
            <li key={s.key} className="bad">
              <div className="rail"><span className="dot">×</span></div>
              <div className="body">
                <span className="t" style={{ color: "var(--danger)", fontWeight: 700 }}>ไม่อนุมัติ</span>
                <span className="small muted">{thDateTime(rejectEntry?.createdAt)}{rejectEntry?.note ? ` — ${rejectEntry.note}` : ""}</span>
              </div>
            </li>
          );
        }
        return (
          <li key={s.key} className={done ? "done" : isCurrent ? "current" : ""} aria-current={isCurrent ? "step" : undefined}>
            <div className="rail">
              <span className="dot">{done ? "✓" : ""}</span>
              {i < STEPS.length - 1 && <span className="line" />}
            </div>
            <div className="body">
              <span className="t">{label}</span>
              {sub && <span className="small muted">{sub}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
