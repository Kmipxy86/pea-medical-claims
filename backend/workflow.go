package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
)

// action คือการเปลี่ยนสถานะหนึ่งแบบ: ใครทำได้ จากสถานะไหน ไปสถานะไหน
type action struct {
	Name        string
	Label       string
	From        []string
	To          string
	Roles       []string // role ที่ทำได้ ("owner" = ผู้ยื่นเรื่องเอง)
	NeedNote    bool
	NeedAmount  bool
	OwnerDenied bool // เจ้าหน้าที่ห้ามทำกับเรื่องของตัวเอง (แบ่งแยกหน้าที่)
}

var workflow = []action{
	{Name: "submit", Label: "ส่งเรื่อง", From: []string{"draft", "need_info"}, To: "pending_review", Roles: []string{"owner"}},
	{Name: "claim", Label: "รับเรื่องมาตรวจ", From: []string{"pending_review"}, To: "in_review", Roles: []string{"reviewer", "admin"}, OwnerDenied: true},
	{Name: "request_info", Label: "ขอเอกสาร/ข้อมูลเพิ่ม", From: []string{"in_review"}, To: "need_info", Roles: []string{"reviewer", "admin"}, NeedNote: true, OwnerDenied: true},
	{Name: "forward", Label: "ส่งให้ผู้อนุมัติ", From: []string{"in_review"}, To: "pending_approval", Roles: []string{"reviewer", "admin"}, OwnerDenied: true},
	{Name: "reject", Label: "ไม่อนุมัติ", From: []string{"in_review", "pending_approval"}, To: "rejected", Roles: []string{"reviewer", "approver", "admin"}, NeedNote: true, OwnerDenied: true},
	{Name: "return", Label: "ส่งกลับให้ตรวจใหม่", From: []string{"pending_approval"}, To: "in_review", Roles: []string{"approver", "admin"}, NeedNote: true, OwnerDenied: true},
	{Name: "approve", Label: "อนุมัติ", From: []string{"pending_approval"}, To: "approved", Roles: []string{"approver", "admin"}, NeedAmount: true, OwnerDenied: true},
	{Name: "pay", Label: "บันทึกจ่ายเงินแล้ว", From: []string{"approved"}, To: "paid", Roles: []string{"finance", "admin"}, OwnerDenied: true},
}

type ActionInfo struct {
	Name       string `json:"name"`
	Label      string `json:"label"`
	NeedNote   bool   `json:"needNote"`
	NeedAmount bool   `json:"needAmount"`
}

func canDo(u *User, t *Ticket, ac action) bool {
	if !slices.Contains(ac.From, t.Status) {
		return false
	}
	isOwner := t.RequesterID == u.ID
	if slices.Contains(ac.Roles, "owner") && isOwner {
		return true
	}
	if ac.OwnerDenied && isOwner {
		return false
	}
	// ขั้น "request_info"/"forward" ต้องเป็นผู้ที่รับเรื่องไว้ (หรือ admin)
	if (ac.Name == "request_info" || ac.Name == "forward" || (ac.Name == "reject" && t.Status == "in_review")) &&
		u.Role == "reviewer" && (t.AssigneeID == nil || *t.AssigneeID != u.ID) {
		return false
	}
	return slices.Contains(ac.Roles, u.Role)
}

func allowedActions(u *User, t *Ticket) []ActionInfo {
	out := []ActionInfo{}
	for _, ac := range workflow {
		if canDo(u, t, ac) {
			out = append(out, ActionInfo{ac.Name, ac.Label, ac.NeedNote, ac.NeedAmount})
		}
	}
	return out
}

func (a *App) handleTransition(w http.ResponseWriter, r *http.Request) {
	t, ok := a.ticketForUser(w, r)
	if !ok {
		return
	}
	u := currentUser(r)
	var body struct {
		Action string   `json:"action"`
		Note   string   `json:"note"`
		Amount *float64 `json:"amount"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "ข้อมูลไม่ถูกต้อง")
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	idx := slices.IndexFunc(workflow, func(ac action) bool { return ac.Name == body.Action })
	if idx < 0 {
		writeErr(w, 400, "ไม่รู้จักคำสั่งนี้")
		return
	}
	ac := workflow[idx]
	if !canDo(u, t, ac) {
		writeErr(w, 403, "ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน หรือไม่มีสิทธิ์")
		return
	}
	if ac.NeedNote && body.Note == "" {
		writeErr(w, 422, "กรุณาระบุเหตุผล/ข้อความถึงผู้ยื่น")
		return
	}
	ctx := r.Context()

	// ก่อนส่งเรื่อง: ตรวจความครบถ้วนและคำนวณธง
	var report *Analysis
	if ac.Name == "submit" || ac.Name == "forward" || ac.Name == "approve" {
		var err error
		if report, err = a.analyze(ctx, t); err != nil {
			serverErr(w, err)
			return
		}
	}
	if ac.Name == "submit" {
		var problems []string
		if t.Hospital == "" || t.TreatmentDate == nil || t.AmountRequested <= 0 {
			problems = append(problems, "กรอกสถานพยาบาล วันที่รักษา และยอดเงินให้ครบ")
		}
		for _, d := range report.MissingDocs {
			problems = append(problems, "ยังไม่ได้แนบ: "+docLabel(d))
		}
		if len(problems) > 0 {
			writeErr(w, 422, "ยังส่งเรื่องไม่ได้", problems...)
			return
		}
	}
	if ac.NeedAmount {
		if body.Amount == nil || *body.Amount < 0 || *body.Amount > t.AmountRequested {
			writeErr(w, 422, "ยอดอนุมัติต้องไม่ติดลบและไม่เกินยอดที่ขอเบิก")
			return
		}
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()

	// UPDATE แบบมีเงื่อนไขสถานะเดิม กันสองคนกดพร้อมกัน
	q := `UPDATE tickets SET status = $2, updated_at = now()`
	args := []any{t.ID, ac.To, t.Status}
	switch ac.Name {
	case "submit":
		flags, _ := json.Marshal(report.Flags)
		q += fmt.Sprintf(`, submitted_at = COALESCE(submitted_at, now()), sla_due = now() + interval '%d hours', flags = $4, priority = $5, assignee_id = NULL`, a.cfg.SLAHours)
		args = append(args, flags, report.Priority)
	case "claim":
		q += `, assignee_id = $4`
		args = append(args, u.ID)
	case "request_info":
		q += `, sla_due = NULL`
	case "forward":
		flags, _ := json.Marshal(report.Flags)
		q += `, flags = $4`
		args = append(args, flags)
	case "approve":
		q += `, amount_approved = $4`
		args = append(args, *body.Amount)
	case "reject", "pay":
		q += `, closed_at = now(), sla_due = NULL`
	}
	if ac.To == "approved" {
		q += `, sla_due = NULL`
	}
	q += ` WHERE id = $1 AND status = $3`
	res, err := tx.ExecContext(ctx, q, args...)
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, 409, "มีคนเปลี่ยนสถานะเรื่องนี้ไปแล้ว กรุณาโหลดใหม่")
		return
	}
	note := body.Note
	if ac.Name == "approve" {
		note = strings.TrimSpace(fmt.Sprintf("อนุมัติ %.2f บาท %s", *body.Amount, note))
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO status_history (ticket_id, from_status, to_status, actor_id, note) VALUES ($1,$2,$3,$4,$5)`,
		t.ID, t.Status, ac.To, u.ID, note); err != nil {
		serverErr(w, err)
		return
	}
	// ข้อความที่ผู้ยื่นต้องเห็น (ขอข้อมูลเพิ่ม / ไม่อนุมัติ / ส่งกลับ) เก็บเป็น comment ด้วย
	if body.Note != "" && ac.Name != "submit" {
		internal := ac.Name == "return" || ac.Name == "forward"
		if _, err := tx.ExecContext(ctx, `INSERT INTO comments (ticket_id, author_id, body, internal) VALUES ($1,$2,$3,$4)`,
			t.ID, u.ID, "["+ac.Label+"] "+body.Note, internal); err != nil {
			serverErr(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	a.audit(r, u.ID, "ticket."+ac.Name, &t.ID, t.Status+"→"+ac.To)
	t, _ = a.loadTicket(ctx, t.ID)
	writeJSON(w, 200, t)
}

var docLabels = map[string]string{
	"receipt":             "ใบเสร็จรับเงิน",
	"medical_certificate": "ใบรับรองแพทย์",
	"expense_summary":     "ใบสรุปค่าใช้จ่าย",
	"relationship_proof":  "เอกสารแสดงความสัมพันธ์กับผู้ป่วย",
	"other":               "เอกสารอื่น ๆ",
}

func docLabel(d string) string {
	if l, ok := docLabels[d]; ok {
		return l
	}
	return d
}

// ใช้ในการคาดการณ์เวลา: ถ้ายังไม่มีข้อมูลในอดีต ใช้ค่าเริ่มต้นนี้
const defaultCycle = 7 * 24 * time.Hour
