package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var allowedTypes = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true, "application/pdf": true,
}

// handleUpload รับไฟล์แนบ ตรวจชนิดไฟล์จากเนื้อไฟล์จริง เก็บลงดิสก์ และ (ถ้าเปิดไว้) ให้ AI อ่านใบเสร็จ
func (a *App) handleUpload(w http.ResponseWriter, r *http.Request) {
	t, ok := a.ticketForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	if t.RequesterID != u.ID || (t.Status != "draft" && t.Status != "need_info") {
		writeErr(w, 409, "แนบไฟล์ได้เฉพาะเรื่องของตนเองที่เป็นร่างหรือถูกขอข้อมูลเพิ่ม")
		return
	}
	maxBytes := a.cfg.MaxUploadMB << 20
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1<<20)
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeErr(w, 413, fmt.Sprintf("ไฟล์ต้องมีขนาดไม่เกิน %d MB", a.cfg.MaxUploadMB))
		return
	}
	docType := r.FormValue("docType")
	if _, ok := docLabels[docType]; !ok {
		writeErr(w, 400, "ประเภทเอกสารไม่ถูกต้อง")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "ไม่พบไฟล์")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		serverErr(w, err)
		return
	}
	if int64(len(data)) > maxBytes {
		writeErr(w, 413, fmt.Sprintf("ไฟล์ต้องมีขนาดไม่เกิน %d MB", a.cfg.MaxUploadMB))
		return
	}
	ctype := http.DetectContentType(data)
	if i := strings.Index(ctype, ";"); i > 0 {
		ctype = ctype[:i]
	}
	if !allowedTypes[ctype] {
		writeErr(w, 415, "รองรับเฉพาะไฟล์ JPG, PNG, WEBP และ PDF")
		return
	}

	sum := sha256.Sum256(data)
	rnd := make([]byte, 16)
	rand.Read(rnd)
	key := filepath.Join(strconv.FormatInt(t.ID, 10), hex.EncodeToString(rnd))
	full := filepath.Join(a.cfg.UploadDir, key)
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		serverErr(w, err)
		return
	}
	if err := os.WriteFile(full, data, 0o640); err != nil {
		serverErr(w, err)
		return
	}

	name := filepath.Base(header.Filename)
	if len(name) > 200 {
		name = name[:200]
	}
	var attID int64
	err = a.db.QueryRowContext(r.Context(), `
		INSERT INTO attachments (ticket_id, doc_type, filename, content_type, size_bytes, sha256, storage_key, uploaded_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		t.ID, docType, name, ctype, len(data), hex.EncodeToString(sum[:]), key, u.ID).Scan(&attID)
	if err != nil {
		os.Remove(full)
		serverErr(w, err)
		return
	}
	a.audit(r, u.ID, "attachment.upload", &t.ID, docType+" "+name)

	// อ่านใบเสร็จด้วย AI (ถ้าตั้ง ANTHROPIC_API_KEY)
	var ocr *OCRResult
	if docType == "receipt" && a.cfg.AnthropicKey != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		res, err := a.readReceipt(ctx, data, ctype)
		if err != nil {
			log.Printf("ocr: %v", err)
		} else {
			ocr = res
			raw, _ := json.Marshal(res)
			a.db.ExecContext(r.Context(), `UPDATE attachments SET ocr = $2 WHERE id = $1`, attID, raw)
			if res.TotalAmount != nil {
				a.db.ExecContext(r.Context(), `UPDATE tickets SET amount_ocr = $2, updated_at = now() WHERE id = $1`, t.ID, *res.TotalAmount)
			}
		}
	}
	writeJSON(w, 201, map[string]any{"id": attID, "contentType": ctype, "ocr": ocr})
}

func (a *App) attachmentForUser(w http.ResponseWriter, r *http.Request) (int64, *Ticket, string, string, string, bool) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, 400, "รหัสไม่ถูกต้อง")
		return 0, nil, "", "", "", false
	}
	var ticketID int64
	var key, ctype, name string
	err = a.db.QueryRowContext(r.Context(), `SELECT ticket_id, storage_key, content_type, filename FROM attachments WHERE id=$1`, id).
		Scan(&ticketID, &key, &ctype, &name)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "ไม่พบไฟล์")
		return 0, nil, "", "", "", false
	}
	if err != nil {
		serverErr(w, err)
		return 0, nil, "", "", "", false
	}
	t, err := a.loadTicket(r.Context(), ticketID)
	if err != nil {
		serverErr(w, err)
		return 0, nil, "", "", "", false
	}
	u := currentUser(r)
	if t.RequesterID != u.ID && !u.IsStaff() {
		writeErr(w, 404, "ไม่พบไฟล์")
		return 0, nil, "", "", "", false
	}
	return id, t, key, ctype, name, true
}

func (a *App) handleDownload(w http.ResponseWriter, r *http.Request) {
	_, t, key, ctype, name, ok := a.attachmentForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	if t.RequesterID != u.ID {
		a.audit(r, u.ID, "attachment.view", &t.ID, name)
	}
	f, err := os.Open(filepath.Join(a.cfg.UploadDir, filepath.Clean(key)))
	if err != nil {
		serverErr(w, err)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s", urlEscape(name)))
	if strings.HasPrefix(ctype, "image/") {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
	}
	w.Header().Set("Cache-Control", "private, no-store")
	io.Copy(w, f)
}

func (a *App) handleDeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id, t, key, _, name, ok := a.attachmentForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	if t.RequesterID != u.ID || (t.Status != "draft" && t.Status != "need_info") {
		writeErr(w, 409, "ลบไฟล์ได้เฉพาะเรื่องของตนเองที่เป็นร่างหรือถูกขอข้อมูลเพิ่ม")
		return
	}
	if _, err := a.db.ExecContext(r.Context(), `DELETE FROM attachments WHERE id=$1`, id); err != nil {
		serverErr(w, err)
		return
	}
	os.Remove(filepath.Join(a.cfg.UploadDir, filepath.Clean(key)))
	a.audit(r, u.ID, "attachment.delete", &t.ID, name)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.IndexByte("-._~", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// อ่านใบเสร็จด้วย Claude API
// หมายเหตุ PDPA: ไฟล์ถูกส่งไปประมวลผลภายนอกองค์กร ต้องได้รับอนุญาตตามนโยบายก่อนเปิดใช้
// ---------------------------------------------------------------------------

type OCRResult struct {
	Hospital      *string            `json:"hospital"`
	ReceiptNo     *string            `json:"receiptNo"`
	TreatmentDate *string            `json:"treatmentDate"`
	TreatmentType *string            `json:"treatmentType"`
	PatientName   *string            `json:"patientName"`
	TotalAmount   *float64           `json:"totalAmount"`
	Confidence    map[string]float64 `json:"confidence"`
}

const ocrPrompt = `คุณคือระบบอ่านใบเสร็จค่ารักษาพยาบาลของไทย อ่านเอกสารแล้วตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น ตามรูปแบบนี้:
{"hospital": string|null, "receiptNo": string|null, "treatmentDate": "YYYY-MM-DD"|null,
 "treatmentType": "OPD"|"IPD"|null, "patientName": string|null, "totalAmount": number|null,
 "confidence": {"hospital":0-1,"receiptNo":0-1,"treatmentDate":0-1,"treatmentType":0-1,"patientName":0-1,"totalAmount":0-1}}
- วันที่ที่เป็นปี พ.ศ. ให้แปลงเป็น ค.ศ. (ลบ 543)
- totalAmount คือยอดรวมสุทธิที่ผู้ป่วยชำระ เป็นตัวเลขไม่มีจุลภาค
- IPD เมื่อมีค่าห้อง/วันรับไว้-จำหน่าย มิฉะนั้น OPD
- ถ้าอ่านไม่ได้ให้ใส่ null และ confidence ต่ำ`

func (a *App) readReceipt(ctx context.Context, data []byte, ctype string) (*OCRResult, error) {
	block := map[string]any{"type": "image", "source": map[string]any{
		"type": "base64", "media_type": ctype, "data": base64.StdEncoding.EncodeToString(data)}}
	if ctype == "application/pdf" {
		block["type"] = "document"
	}
	reqBody, _ := json.Marshal(map[string]any{
		"model":      a.cfg.AnthropicModel,
		"max_tokens": 1024,
		"messages": []any{map[string]any{"role": "user", "content": []any{
			block, map[string]any{"type": "text", "text": ocrPrompt},
		}}},
	})
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(reqBody))
	req.Header.Set("x-api-key", a.cfg.AnthropicKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("anthropic %d: %s", resp.StatusCode, raw)
	}
	var out struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	var text string
	for _, c := range out.Content {
		if c.Type == "text" {
			text += c.Text
		}
	}
	i, j := strings.Index(text, "{"), strings.LastIndex(text, "}")
	if i < 0 || j <= i {
		return nil, errors.New("ไม่พบ JSON ในคำตอบ")
	}
	res := &OCRResult{}
	if err := json.Unmarshal([]byte(text[i:j+1]), res); err != nil {
		return nil, err
	}
	if res.TreatmentType != nil && *res.TreatmentType != "OPD" && *res.TreatmentType != "IPD" {
		res.TreatmentType = nil
	}
	if res.TreatmentDate != nil {
		if _, err := time.Parse("2006-01-02", *res.TreatmentDate); err != nil {
			res.TreatmentDate = nil
		}
	}
	return res, nil
}
