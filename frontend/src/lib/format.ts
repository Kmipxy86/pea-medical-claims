import type { DocType, Relation, Role, Status } from "./api";

export const statusLabel: Record<Status, string> = {
  draft: "ร่าง",
  pending_review: "รอตรวจ",
  in_review: "กำลังตรวจ",
  need_info: "ต้องส่งเอกสารเพิ่ม",
  pending_approval: "รออนุมัติ",
  approved: "อนุมัติแล้ว รอจ่าย",
  rejected: "ไม่อนุมัติ",
  paid: "จ่ายแล้ว",
};

// ชื่อ class ของ chip สถานะ (สีกำหนดใน globals.css)
export const statusTone: Record<Status, string> = {
  draft: "neutral",
  pending_review: "info",
  in_review: "brand",
  need_info: "warn",
  pending_approval: "info",
  approved: "ok",
  rejected: "danger",
  paid: "ok",
};

export const relationLabel: Record<Relation, string> = {
  self: "ตนเอง",
  spouse: "คู่สมรส",
  child: "บุตร",
  parent: "บิดา / มารดา",
};

export const docLabel: Record<DocType, string> = {
  receipt: "ใบเสร็จรับเงิน",
  medical_certificate: "ใบรับรองแพทย์",
  expense_summary: "ใบสรุปค่าใช้จ่าย",
  relationship_proof: "เอกสารแสดงความสัมพันธ์",
  other: "เอกสารอื่น ๆ",
};

export const roleLabel: Record<Role, string> = {
  employee: "พนักงาน (ผู้ยื่นเรื่อง)",
  reviewer: "เจ้าหน้าที่ตรวจสอบ",
  approver: "ผู้อนุมัติ",
  finance: "การเงิน",
  admin: "ผู้ดูแลระบบ",
};

const moneyFmt = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number | null | undefined) => (n == null ? "—" : moneyFmt.format(n));

const dateFmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function thDate(s: string | null | undefined) {
  if (!s) return "—";
  const d = s.length === 10 ? new Date(s + "T00:00:00") : new Date(s);
  return dateFmt.format(d);
}

export function thDateTime(s: string | null | undefined) {
  return s ? dateTimeFmt.format(new Date(s)) : "—";
}

// เวลาที่เหลือก่อนครบ SLA เป็นข้อความสั้น ๆ
export function slaText(due: string | null): { text: string; urgent: boolean } {
  if (!due) return { text: "—", urgent: false };
  const ms = new Date(due).getTime() - Date.now();
  const h = Math.round(ms / 3_600_000);
  if (ms < 0) return { text: `เกิน ${Math.max(1, -h)} ชม.`, urgent: true };
  if (h < 24) return { text: `เหลือ ${Math.max(1, h)} ชม.`, urgent: true };
  const d = Math.floor(h / 24);
  return { text: `เหลือ ${d} วัน`, urgent: d <= 1 };
}

export const isStaff = (r: Role) => r !== "employee";
