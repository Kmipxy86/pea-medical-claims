import { api, type DocType, type OCRResult, type Ticket } from "./api";

export async function uploadDoc(ticketId: number, docType: DocType, file: File) {
  const fd = new FormData();
  fd.set("docType", docType);
  fd.set("file", file);
  return api<{ id: number; contentType: string; ocr: OCRResult | null }>(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: fd,
  });
}

// เติมช่องที่ยังว่างด้วยผลอ่านใบเสร็จ (ไม่ทับค่าที่ผู้ใช้กรอกแล้ว)
export function ocrPatch(t: Ticket, ocr: OCRResult) {
  const patch: Record<string, unknown> = {};
  if (!t.hospital && ocr.hospital) patch.hospital = ocr.hospital;
  if (!t.receiptNo && ocr.receiptNo) patch.receiptNo = ocr.receiptNo;
  if (!t.treatmentDate && ocr.treatmentDate) patch.treatmentDate = ocr.treatmentDate;
  if (ocr.treatmentType) patch.treatmentType = ocr.treatmentType;
  if (!t.amountRequested && ocr.totalAmount) patch.amountRequested = ocr.totalAmount;
  return patch;
}
