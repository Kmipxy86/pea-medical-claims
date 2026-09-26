package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
)

type Ticket struct {
	ID              int64           `json:"id"`
	Code            string          `json:"code"`
	RequesterID     int64           `json:"requesterId"`
	RequesterName   string          `json:"requesterName"`
	RequesterEmail  string          `json:"requesterEmail"`
	PatientName     string          `json:"patientName"`
	Relation        string          `json:"relation"`
	TreatmentType   string          `json:"treatmentType"`
	Hospital        string          `json:"hospital"`
	ReceiptNo       string          `json:"receiptNo"`
	TreatmentDate   *string         `json:"treatmentDate"`
	AmountRequested float64         `json:"amountRequested"`
	AmountOCR       *float64        `json:"amountOcr"`
	AmountApproved  *float64        `json:"amountApproved"`
	Status          string          `json:"status"`
	AssigneeID      *int64          `json:"assigneeId"`
	AssigneeName    *string         `json:"assigneeName"`
	SLADue          *time.Time      `json:"slaDue"`
	Flags           json.RawMessage `json:"flags"`
	Priority        int             `json:"priority"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
	SubmittedAt     *time.Time      `json:"submittedAt"`
	ClosedAt        *time.Time      `json:"closedAt"`
}

const ticketSelect = `
SELECT t.id, t.code, t.requester_id, ru.name, ru.email, t.patient_name, t.relation, t.treatment_type,
       t.hospital, t.receipt_no, t.treatment_date, t.amount_requested, t.amount_ocr, t.amount_approved,
       t.status, t.assignee_id, au.name, t.sla_due, t.flags, t.priority, t.created_at, t.updated_at,
       t.submitted_at, t.closed_at
FROM tickets t
JOIN users ru ON ru.id = t.requester_id
LEFT JOIN users au ON au.id = t.assignee_id`

type scanner interface{ Scan(dest ...any) error }

func scanTicket(s scanner) (*Ticket, error) {
	t := &Ticket{}
	var tdate sql.NullTime
	var ocr, approved sql.NullFloat64
	var assignee sql.NullInt64
	var assigneeName sql.NullString
	var sla, submitted, closed sql.NullTime
	var flags []byte
	err := s.Scan(&t.ID, &t.Code, &t.RequesterID, &t.RequesterName, &t.RequesterEmail, &t.PatientName,
		&t.Relation, &t.TreatmentType, &t.Hospital, &t.ReceiptNo, &tdate, &t.AmountRequested, &ocr, &approved,
		&t.Status, &assignee, &assigneeName, &sla, &flags, &t.Priority, &t.CreatedAt, &t.UpdatedAt,
		&submitted, &closed)
	if err != nil {
		return nil, err
	}
	if tdate.Valid {
		d := tdate.Time.Format("2006-01-02")
		t.TreatmentDate = &d
	}
	if ocr.Valid {
		t.AmountOCR = &ocr.Float64
	}
	if approved.Valid {
		t.AmountApproved = &approved.Float64
	}
	if assignee.Valid {
		t.AssigneeID = &assignee.Int64
	}
	if assigneeName.Valid {
		t.AssigneeName = &assigneeName.String
	}
	if sla.Valid {
		t.SLADue = &sla.Time
	}
	if submitted.Valid {
		t.SubmittedAt = &submitted.Time
	}
	if closed.Valid {
		t.ClosedAt = &closed.Time
	}
	t.Flags = flags
	return t, nil
}

func (a *App) loadTicket(ctx context.Context, id int64) (*Ticket, error) {
	return scanTicket(a.db.QueryRowContext(ctx, ticketSelect+` WHERE t.id = $1`, id))
}

// ticketForUser โหลด ticket และตรวจว่าผู้ใช้มีสิทธิ์เห็นหรือไม่
func (a *App) ticketForUser(w http.ResponseWriter, r *http.Request) (*Ticket, bool) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, 400, "รหัสไม่ถูกต้อง")
		return nil, false
	}
	t, err := a.loadTicket(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "ไม่พบเรื่องนี้")
		return nil, false
	}
	if err != nil {
		serverErr(w, err)
		return nil, false
	}
	u := currentUser(r)
	if t.RequesterID != u.ID && !u.IsStaff() {
		writeErr(w, 404, "ไม่พบเรื่องนี้")
		return nil, false
	}
	return t, true
}

// ---------------------------------------------------------------------------
// รายการของฉัน / สร้าง / แก้ไข
// ---------------------------------------------------------------------------

func (a *App) handleListTickets(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	rows, err := a.db.QueryContext(r.Context(), ticketSelect+` WHERE t.requester_id = $1 ORDER BY t.updated_at DESC LIMIT 200`, u.ID)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []*Ticket{}
	for rows.Next() {
		t, err := scanTicket(rows)
		if err != nil {
			serverErr(w, err)
			return
		}
		out = append(out, t)
	}
	writeJSON(w, 200, out)
}

type ticketInput struct {
	PatientName     *string  `json:"patientName"`
	Relation        *string  `json:"relation"`
	TreatmentType   *string  `json:"treatmentType"`
	Hospital        *string  `json:"hospital"`
	ReceiptNo       *string  `json:"receiptNo"`
	TreatmentDate   *string  `json:"treatmentDate"`
	AmountRequested *float64 `json:"amountRequested"`
}

func (in *ticketInput) validate() []string {
	var errs []string
	if in.Relation != nil && !slices.Contains([]string{"self", "spouse", "child", "parent"}, *in.Relation) {
		errs = append(errs, "ความสัมพันธ์กับผู้ป่วยไม่ถูกต้อง")
	}
	if in.TreatmentType != nil && *in.TreatmentType != "OPD" && *in.TreatmentType != "IPD" {
		errs = append(errs, "ประเภทการรักษาต้องเป็น OPD หรือ IPD")
	}
	if in.TreatmentDate != nil && *in.TreatmentDate != "" {
		if _, err := time.Parse("2006-01-02", *in.TreatmentDate); err != nil {
			errs = append(errs, "วันที่รักษาต้องอยู่ในรูปแบบ YYYY-MM-DD")
		}
	}
	if in.AmountRequested != nil && (*in.AmountRequested < 0 || *in.AmountRequested > 10_000_000) {
		errs = append(errs, "ยอดเงินไม่ถูกต้อง")
	}
	for _, s := range []*string{in.PatientName, in.Hospital, in.ReceiptNo} {
		if s != nil && len(*s) > 300 {
			errs = append(errs, "ข้อความยาวเกินไป")
		}
	}
	return errs
}

func (a *App) handleCreateTicket(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	var in ticketInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, 400, "ข้อมูลไม่ถูกต้อง")
		return
	}
	if errs := in.validate(); len(errs) > 0 {
		writeErr(w, 422, "ข้อมูลไม่ถูกต้อง", errs...)
		return
	}
	var id int64
	yearBE := time.Now().Year() + 543
	err := a.db.QueryRowContext(r.Context(), `
		INSERT INTO tickets (code, requester_id, patient_name)
		VALUES ('MED-' || $1 || '-' || lpad(nextval('ticket_code_seq')::text, 4, '0'), $2, $3)
		RETURNING id`, fmt.Sprintf("%02d", yearBE%100), u.ID, u.Name).Scan(&id)
	if err != nil {
		serverErr(w, err)
		return
	}
	if err := a.applyInput(r.Context(), id, &in); err != nil {
		serverErr(w, err)
		return
	}
	a.addHistory(r.Context(), id, "", "draft", u.ID, "สร้างร่าง")
	a.audit(r, u.ID, "ticket.create", &id, "")
	t, _ := a.loadTicket(r.Context(), id)
	writeJSON(w, 201, t)
}

func (a *App) applyInput(ctx context.Context, id int64, in *ticketInput) error {
	var date any
	if in.TreatmentDate != nil {
		if *in.TreatmentDate == "" {
			date = nil
		} else {
			date = *in.TreatmentDate
		}
	}
	_, err := a.db.ExecContext(ctx, `
		UPDATE tickets SET
		  patient_name     = COALESCE($2, patient_name),
		  relation         = COALESCE($3, relation),
		  treatment_type   = COALESCE($4, treatment_type),
		  hospital         = COALESCE($5, hospital),
		  receipt_no       = COALESCE($6, receipt_no),
		  treatment_date   = CASE WHEN $7 THEN $8::date ELSE treatment_date END,
		  amount_requested = COALESCE($9, amount_requested),
		  updated_at       = now()
		WHERE id = $1`,
		id, in.PatientName, in.Relation, in.TreatmentType, in.Hospital, in.ReceiptNo,
		in.TreatmentDate != nil, date, in.AmountRequested)
	return err
}

func (a *App) handleUpdateTicket(w http.ResponseWriter, r *http.Request) {
	t, ok := a.ticketForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	if t.RequesterID != u.ID || (t.Status != "draft" && t.Status != "need_info") {
		writeErr(w, 409, "แก้ไขได้เฉพาะเรื่องของตนเองที่เป็นร่างหรือถูกขอข้อมูลเพิ่ม")
		return
	}
	var in ticketInput
	if err := readJSON(r, &in); err != nil {
		writeErr(w, 400, "ข้อมูลไม่ถูกต้อง")
		return
	}
	if errs := in.validate(); len(errs) > 0 {
		writeErr(w, 422, "ข้อมูลไม่ถูกต้อง", errs...)
		return
	}
	if err := a.applyInput(r.Context(), t.ID, &in); err != nil {
		serverErr(w, err)
		return
	}
	a.audit(r, u.ID, "ticket.update", &t.ID, "")
	t, _ = a.loadTicket(r.Context(), t.ID)
	writeJSON(w, 200, t)
}

// ---------------------------------------------------------------------------
// รายละเอียด (รวมเอกสาร ประวัติ ข้อความ และผลตรวจของ AI)
// ---------------------------------------------------------------------------

type Attachment struct {
	ID          int64           `json:"id"`
	DocType     string          `json:"docType"`
	Filename    string          `json:"filename"`
	ContentType string          `json:"contentType"`
	SizeBytes   int64           `json:"sizeBytes"`
	OCR         json.RawMessage `json:"ocr"`
	CreatedAt   time.Time       `json:"createdAt"`
}

type HistoryItem struct {
	FromStatus *string   `json:"fromStatus"`
	ToStatus   string    `json:"toStatus"`
	ActorName  *string   `json:"actorName"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Comment struct {
	ID         int64     `json:"id"`
	AuthorName string    `json:"authorName"`
	AuthorRole string    `json:"authorRole"`
	Mine       bool      `json:"mine"`
	Body       string    `json:"body"`
	Internal   bool      `json:"internal"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (a *App) handleGetTicket(w http.ResponseWriter, r *http.Request) {
	t, ok := a.ticketForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	ctx := r.Context()
	if t.RequesterID != u.ID {
		a.audit(r, u.ID, "ticket.view", &t.ID, "")
	}

	atts, err := a.listAttachments(ctx, t.ID)
	if err != nil {
		serverErr(w, err)
		return
	}

	history := []HistoryItem{}
	rows, err := a.db.QueryContext(ctx, `
		SELECT h.from_status, h.to_status, u.name, h.note, h.created_at
		FROM status_history h LEFT JOIN users u ON u.id = h.actor_id
		WHERE h.ticket_id = $1 ORDER BY h.created_at, h.id`, t.ID)
	if err != nil {
		serverErr(w, err)
		return
	}
	for rows.Next() {
		var h HistoryItem
		var from, actor sql.NullString
		if err := rows.Scan(&from, &h.ToStatus, &actor, &h.Note, &h.CreatedAt); err != nil {
			rows.Close()
			serverErr(w, err)
			return
		}
		if from.Valid && from.String != "" {
			h.FromStatus = &from.String
		}
		if actor.Valid {
			h.ActorName = &actor.String
		}
		history = append(history, h)
	}
	rows.Close()

	comments := []Comment{}
	crow, err := a.db.QueryContext(ctx, `
		SELECT c.id, u.id, u.name, u.role, c.body, c.internal, c.created_at
		FROM comments c JOIN users u ON u.id = c.author_id
		WHERE c.ticket_id = $1 AND (c.internal = FALSE OR $2)
		ORDER BY c.created_at, c.id`, t.ID, u.IsStaff())
	if err != nil {
		serverErr(w, err)
		return
	}
	for crow.Next() {
		var c Comment
		var authorID int64
		if err := crow.Scan(&c.ID, &authorID, &c.AuthorName, &c.AuthorRole, &c.Body, &c.Internal, &c.CreatedAt); err != nil {
			crow.Close()
			serverErr(w, err)
			return
		}
		c.Mine = authorID == u.ID
		comments = append(comments, c)
	}
	crow.Close()

	report, err := a.analyze(ctx, t)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"ticket":      t,
		"attachments": atts,
		"history":     history,
		"comments":    comments,
		"analysis":    report,
		"actions":     allowedActions(u, t),
	})
}

func (a *App) listAttachments(ctx context.Context, ticketID int64) ([]Attachment, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, doc_type, filename, content_type, size_bytes, ocr, created_at
		FROM attachments WHERE ticket_id = $1 ORDER BY created_at, id`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Attachment{}
	for rows.Next() {
		var at Attachment
		var ocr []byte
		if err := rows.Scan(&at.ID, &at.DocType, &at.Filename, &at.ContentType, &at.SizeBytes, &ocr, &at.CreatedAt); err != nil {
			return nil, err
		}
		if ocr != nil {
			at.OCR = ocr
		}
		out = append(out, at)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// ข้อความ
// ---------------------------------------------------------------------------

func (a *App) handleAddComment(w http.ResponseWriter, r *http.Request) {
	t, ok := a.ticketForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	var body struct {
		Body     string `json:"body"`
		Internal bool   `json:"internal"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Body) == "" || len(body.Body) > 4000 {
		writeErr(w, 400, "กรุณาพิมพ์ข้อความ (ไม่เกิน 4,000 ตัวอักษร)")
		return
	}
	if !u.IsStaff() {
		body.Internal = false
	}
	if _, err := a.db.ExecContext(r.Context(),
		`INSERT INTO comments (ticket_id, author_id, body, internal) VALUES ($1,$2,$3,$4)`,
		t.ID, u.ID, strings.TrimSpace(body.Body), body.Internal); err != nil {
		serverErr(w, err)
		return
	}
	a.db.ExecContext(r.Context(), `UPDATE tickets SET updated_at = now() WHERE id = $1`, t.ID)
	writeJSON(w, 201, map[string]any{"ok": true})
}

func (a *App) addHistory(ctx context.Context, ticketID int64, from, to string, actorID int64, note string) {
	a.db.ExecContext(ctx, `INSERT INTO status_history (ticket_id, from_status, to_status, actor_id, note) VALUES ($1,NULLIF($2,''),$3,$4,$5)`,
		ticketID, from, to, actorID, note)
}
