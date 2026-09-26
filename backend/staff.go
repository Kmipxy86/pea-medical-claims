package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

var defaultQueue = map[string][]string{
	"reviewer": {"pending_review", "in_review", "need_info"},
	"approver": {"pending_approval"},
	"finance":  {"approved"},
	"admin":    {"pending_review", "in_review", "need_info", "pending_approval", "approved"},
}

var allStatuses = []string{"draft", "pending_review", "in_review", "need_info", "pending_approval", "approved", "rejected", "paid"}

// handleQueue คิวงานเจ้าหน้าที่ เรียงตาม SLA ที่ใกล้หมดก่อน แล้วตามคะแนนความสำคัญจาก AI
func (a *App) handleQueue(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	q := r.URL.Query()
	statuses := defaultQueue[u.Role]
	if s := q.Get("status"); s != "" && s != "active" {
		statuses = nil
		for _, st := range strings.Split(s, ",") {
			for _, ok := range allStatuses {
				if st == ok && st != "draft" {
					statuses = append(statuses, st)
				}
			}
		}
	}
	where := []string{"t.status = ANY($1)"}
	args := []any{pqArray(statuses)}
	if q.Get("mine") == "1" {
		args = append(args, u.ID)
		where = append(where, fmt.Sprintf("t.assignee_id = $%d", len(args)))
	}
	if q.Get("flagged") == "1" {
		where = append(where, `t.flags @> '[{"level":"danger"}]'`)
	}
	if tt := q.Get("type"); tt == "OPD" || tt == "IPD" {
		args = append(args, tt)
		where = append(where, fmt.Sprintf("t.treatment_type = $%d", len(args)))
	}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		args = append(args, "%"+strings.ToLower(s)+"%")
		n := len(args)
		where = append(where, fmt.Sprintf("(lower(t.code) LIKE $%d OR lower(ru.name) LIKE $%d OR lower(ru.email) LIKE $%d OR lower(t.hospital) LIKE $%d)", n, n, n, n))
	}
	sqlq := ticketSelect + " WHERE " + strings.Join(where, " AND ") +
		` ORDER BY (t.sla_due IS NULL), t.sla_due ASC, t.priority DESC, t.submitted_at ASC LIMIT 300`
	rows, err := a.db.QueryContext(r.Context(), sqlq, args...)
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

type MonthTotal struct {
	Month     string  `json:"month"`
	Requested float64 `json:"requested"`
	Paid      float64 `json:"paid"`
}

// handleStats ตัวเลขรวมสำหรับ Dashboard — ไม่มีข้อมูลการรักษารายบุคคล (PDPA)
func (a *App) handleStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	byStatus := map[string]int{}
	rows, err := a.db.QueryContext(ctx, `SELECT status, COUNT(*) FROM tickets WHERE status <> 'draft' GROUP BY status`)
	if err != nil {
		serverErr(w, err)
		return
	}
	for rows.Next() {
		var s string
		var n int
		rows.Scan(&s, &n)
		byStatus[s] = n
	}
	rows.Close()

	var overdue, dueSoon, flagged int
	var avgHours sql.NullFloat64
	var paidMonth float64
	err = a.db.QueryRowContext(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE sla_due < now()),
		  COUNT(*) FILTER (WHERE sla_due >= now() AND sla_due < now() + interval '24 hours'),
		  COUNT(*) FILTER (WHERE flags @> '[{"level":"danger"}]'),
		  (SELECT AVG(EXTRACT(EPOCH FROM closed_at - submitted_at))/3600 FROM tickets
		     WHERE status='paid' AND closed_at > now() - interval '180 days'),
		  (SELECT COALESCE(SUM(amount_approved),0) FROM tickets
		     WHERE status='paid' AND closed_at >= date_trunc('month', now()))
		FROM tickets WHERE status IN ('pending_review','in_review','pending_approval','approved')`).
		Scan(&overdue, &dueSoon, &flagged, &avgHours, &paidMonth)
	if err != nil {
		serverErr(w, err)
		return
	}

	months := []MonthTotal{}
	mrows, err := a.db.QueryContext(ctx, `
		SELECT to_char(m, 'YYYY-MM'),
		  COALESCE((SELECT SUM(amount_requested) FROM tickets WHERE status <> 'draft' AND date_trunc('month', submitted_at) = m), 0),
		  COALESCE((SELECT SUM(amount_approved)  FROM tickets WHERE status = 'paid'  AND date_trunc('month', closed_at)   = m), 0)
		FROM generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
		ORDER BY m`)
	if err != nil {
		serverErr(w, err)
		return
	}
	for mrows.Next() {
		var m MonthTotal
		mrows.Scan(&m.Month, &m.Requested, &m.Paid)
		months = append(months, m)
	}
	mrows.Close()

	var avg *float64
	if avgHours.Valid {
		v := round2(avgHours.Float64)
		avg = &v
	}
	writeJSON(w, 200, map[string]any{
		"byStatus": byStatus, "overdue": overdue, "dueSoon": dueSoon, "flagged": flagged,
		"avgCycleHours": avg, "paidThisMonth": paidMonth, "months": months,
	})
}

// ---------------------------------------------------------------------------
// Admin: ผู้ใช้ กฎสิทธิ์ และ audit log
// ---------------------------------------------------------------------------

func (a *App) handleListUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `SELECT id FROM users ORDER BY role <> 'admin', role, name`)
	if err != nil {
		serverErr(w, err)
		return
	}
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	out := []*User{}
	for _, id := range ids {
		if u, err := a.getUser(r.Context(), id); err == nil {
			out = append(out, u)
		}
	}
	writeJSON(w, 200, out)
}

func (a *App) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, 400, "รหัสไม่ถูกต้อง")
		return
	}
	me := currentUser(r)
	var body struct {
		Role         *string `json:"role"`
		Active       *bool   `json:"active"`
		EmployeeCode *string `json:"employeeCode"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "ข้อมูลไม่ถูกต้อง")
		return
	}
	if body.Role != nil && !validRole(*body.Role) {
		writeErr(w, 422, "role ไม่ถูกต้อง")
		return
	}
	if id == me.ID && ((body.Role != nil && *body.Role != "admin") || (body.Active != nil && !*body.Active)) {
		writeErr(w, 422, "ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตัวเองได้")
		return
	}
	res, err := a.db.ExecContext(r.Context(), `UPDATE users SET role = COALESCE($2, role), active = COALESCE($3, active), employee_code = COALESCE($4, employee_code) WHERE id = $1`,
		id, body.Role, body.Active, body.EmployeeCode)
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, 404, "ไม่พบผู้ใช้")
		return
	}
	a.audit(r, me.ID, "user.update", nil, fmt.Sprintf("user=%d", id))
	u, _ := a.getUser(r.Context(), id)
	writeJSON(w, 200, u)
}

type Rule struct {
	ID            int64    `json:"id"`
	Relation      string   `json:"relation"`
	TreatmentType string   `json:"treatmentType"`
	AnnualLimit   float64  `json:"annualLimit"`
	ReimbursePct  float64  `json:"reimbursePct"`
	RequiredDocs  []string `json:"requiredDocs"`
}

func (a *App) handleListRules(w http.ResponseWriter, r *http.Request) {
	rules, err := a.listRules(r)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, rules)
}

func (a *App) listRules(r *http.Request) ([]Rule, error) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT id, relation, treatment_type, annual_limit, reimburse_pct, required_docs FROM entitlement_rules
		ORDER BY array_position(ARRAY['self','spouse','child','parent'], relation), treatment_type DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Rule{}
	for rows.Next() {
		var ru Rule
		var docs stringArray
		if err := rows.Scan(&ru.ID, &ru.Relation, &ru.TreatmentType, &ru.AnnualLimit, &ru.ReimbursePct, &docs); err != nil {
			return nil, err
		}
		ru.RequiredDocs = docs
		out = append(out, ru)
	}
	return out, rows.Err()
}

func (a *App) handleUpdateRule(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, 400, "รหัสไม่ถูกต้อง")
		return
	}
	var body struct {
		AnnualLimit  float64  `json:"annualLimit"`
		ReimbursePct float64  `json:"reimbursePct"`
		RequiredDocs []string `json:"requiredDocs"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "ข้อมูลไม่ถูกต้อง")
		return
	}
	if body.AnnualLimit < 0 || body.ReimbursePct < 0 || body.ReimbursePct > 100 {
		writeErr(w, 422, "วงเงินหรือเปอร์เซ็นต์ไม่ถูกต้อง")
		return
	}
	docs := []string{}
	for _, d := range body.RequiredDocs {
		if _, ok := docLabels[d]; ok && d != "other" {
			docs = append(docs, d)
		}
	}
	res, err := a.db.ExecContext(r.Context(), `UPDATE entitlement_rules SET annual_limit=$2, reimburse_pct=$3, required_docs=$4 WHERE id=$1`,
		id, body.AnnualLimit, body.ReimbursePct, pqArray(docs))
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, 404, "ไม่พบกฎ")
		return
	}
	a.audit(r, currentUser(r).ID, "rule.update", nil, fmt.Sprintf("rule=%d", id))
	writeJSON(w, 200, map[string]any{"ok": true})
}

type AuditEntry struct {
	ID         int64     `json:"id"`
	ActorName  *string   `json:"actorName"`
	Action     string    `json:"action"`
	TicketCode *string   `json:"ticketCode"`
	Detail     string    `json:"detail"`
	IP         string    `json:"ip"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (a *App) handleAudit(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT l.id, u.name, l.action, t.code, l.detail, l.ip, l.created_at
		FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id LEFT JOIN tickets t ON t.id = l.ticket_id
		ORDER BY l.id DESC LIMIT 300`)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		var actor, code sql.NullString
		if err := rows.Scan(&e.ID, &actor, &e.Action, &code, &e.Detail, &e.IP, &e.CreatedAt); err != nil {
			serverErr(w, err)
			return
		}
		if actor.Valid {
			e.ActorName = &actor.String
		}
		if code.Valid {
			e.TicketCode = &code.String
		}
		out = append(out, e)
	}
	writeJSON(w, 200, out)
}

// entitlements ของผู้ยื่นเอง (แสดงการ์ดวงเงินคงเหลือบนหน้าแรก)
func (a *App) handleMyEntitlements(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	rules, err := a.listRules(r)
	if err != nil {
		serverErr(w, err)
		return
	}
	type item struct {
		Rule
		Used      float64 `json:"used"`
		Remaining float64 `json:"remaining"`
	}
	out := []item{}
	for _, ru := range rules {
		var used float64
		err := a.db.QueryRowContext(r.Context(), `
			SELECT COALESCE(SUM(COALESCE(amount_approved, amount_requested)),0) FROM tickets
			WHERE requester_id=$1 AND relation=$2 AND treatment_type=$3 AND status NOT IN ('draft','rejected')
			  AND EXTRACT(YEAR FROM COALESCE(treatment_date, created_at::date)) = EXTRACT(YEAR FROM now())`,
			u.ID, ru.Relation, ru.TreatmentType).Scan(&used)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			serverErr(w, err)
			return
		}
		rem := ru.AnnualLimit - used
		if rem < 0 {
			rem = 0
		}
		out = append(out, item{ru, used, rem})
	}
	writeJSON(w, 200, out)
}
