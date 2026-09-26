// ตัวเรียก API กลาง: ส่ง cookie + header กัน CSRF และแปลง error ให้อ่านง่าย

export type Role = "employee" | "reviewer" | "approver" | "finance" | "admin";

export type User = {
  id: number;
  email: string;
  name: string;
  picture: string;
  employeeCode: string;
  role: Role;
  active: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
};

export type Status =
  | "draft"
  | "pending_review"
  | "in_review"
  | "need_info"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "paid";

export type Relation = "self" | "spouse" | "child" | "parent";
export type TreatmentType = "OPD" | "IPD";
export type DocType = "receipt" | "medical_certificate" | "expense_summary" | "relationship_proof" | "other";

export type Flag = { code: string; level: "danger" | "warn" | "info"; message: string };

export type Ticket = {
  id: number;
  code: string;
  requesterId: number;
  requesterName: string;
  requesterEmail: string;
  patientName: string;
  relation: Relation;
  treatmentType: TreatmentType;
  hospital: string;
  receiptNo: string;
  treatmentDate: string | null;
  amountRequested: number;
  amountOcr: number | null;
  amountApproved: number | null;
  status: Status;
  assigneeId: number | null;
  assigneeName: string | null;
  slaDue: string | null;
  flags: Flag[];
  priority: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  closedAt: string | null;
};

export type OCRResult = {
  hospital: string | null;
  receiptNo: string | null;
  treatmentDate: string | null;
  treatmentType: TreatmentType | null;
  patientName: string | null;
  totalAmount: number | null;
  confidence?: Record<string, number>;
};

export type Attachment = {
  id: number;
  docType: DocType;
  filename: string;
  contentType: string;
  sizeBytes: number;
  ocr: OCRResult | null;
  createdAt: string;
};

export type HistoryItem = {
  fromStatus: Status | null;
  toStatus: Status;
  actorName: string | null;
  note: string;
  createdAt: string;
};

export type Comment = {
  id: number;
  authorName: string;
  authorRole: Role;
  mine: boolean;
  body: string;
  internal: boolean;
  createdAt: string;
};

export type Analysis = {
  flags: Flag[];
  requiredDocs: DocType[];
  missingDocs: DocType[];
  entitlement: {
    annualLimit: number;
    used: number;
    remaining: number;
    reimbursePct: number;
    estimate: number;
  } | null;
  priority: number;
  eta: string | null;
};

export type ActionInfo = { name: string; label: string; needNote: boolean; needAmount: boolean };

export type TicketDetail = {
  ticket: Ticket;
  attachments: Attachment[];
  history: HistoryItem[];
  comments: Comment[];
  analysis: Analysis;
  actions: ActionInfo[];
};

export type AuthConfig = {
  googleClientId: string;
  devLogin: boolean;
  allowedDomain: string;
  ocrEnabled: boolean;
};

export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Requested-With", "fetch");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, body, headers, credentials: "same-origin", cache: "no-store" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `เกิดข้อผิดพลาด (${res.status})`, data?.details || []);
  }
  return data as T;
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return [e.message, ...e.details].join(" · ");
  if (e instanceof Error) return e.message;
  return "เกิดข้อผิดพลาด";
}
