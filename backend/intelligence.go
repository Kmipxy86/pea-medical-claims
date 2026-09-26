package main

// ส่วน "Intelligent" ของระบบ: ตรวจความครบถ้วน ตรวจสิทธิ์/วงเงิน ตรวจความผิดปกติ
// จัดลำดับความสำคัญ และคาดการณ์วันที่จะได้รับเงิน
// ทุกอย่างเป็น "คำแนะนำ" ให้เจ้าหน้าที่ — การอนุมัติทำโดยคนเสมอ

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"slices"
	"time"

	"github.com/lib/pq"
)

const lateSubmissionDays = 365 // ยื่นเกินกี่วันหลังรักษาถึงจะขึ้นธงเตือน (ปรับตามระเบียบจริง)

type Flag struct {
	Code    string `json:"code"`
	Level   string `json:"level"` // danger | warn | info
	Message string `json:"message"`
}

type Entitlement struct {
	AnnualLimit  float64 `json:"annualLimit"`
	Used         float64 `json:"used"`
	Remaining    float64 `json:"remaining"`
	ReimbursePct float64 `json:"reimbursePct"`
	Estimate     float64 `json:"estimate"`
}

type Analysis struct {
	Flags        []Flag       `json:"flags"`
	RequiredDocs []string     `json:"requiredDocs"`
	MissingDocs  []string     `json:"missingDocs"`
	Entitlement  *Entitlement `json:"entitlement"`
	Priority     int          `json:"priority"`
	ETA          *time.Time   `json:"eta"`
}

func (a *App) analyze(ctx context.Context, t *Ticket) (*Analysis, error) {
	rep := &Analysis{Flags: []Flag{}, RequiredDocs: []string{}, MissingDocs: []string{}}

	// 1) เอกสารที่ต้องมี ตามกฎสิทธิ์
	var required pq.StringArray
	var limit, pct float64
	err := a.db.QueryRowContext(ctx, `SELECT required_docs, annual_limit, reimburse_pct FROM entitlement_rules WHERE relation=$1 AND treatment_type=$2`,
		t.Relation, t.TreatmentType).Scan(&required, &limit, &pct)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	rep.RequiredDocs = append(rep.RequiredDocs, required...)

	have := map[string]bool{}
	rows, err := a.db.QueryContext(ctx, `SELECT DISTINCT doc_type FROM attachments WHERE ticket_id=$1`, t.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d string
		rows.Scan(&d)
		have[d] = true
	}
	rows.Close()
	for _, d := range required {
		if !have[d] {
			rep.MissingDocs = append(rep.MissingDocs, d)
		}
	}
	if len(rep.MissingDocs) > 0 {
		names := make([]string, len(rep.MissingDocs))
		for i, d := range rep.MissingDocs {
			names[i] = docLabel(d)
		}
		rep.Flags = append(rep.Flags, Flag{"missing_docs", "warn", "ขาดเอกสาร: " + joinThai(names)})
	}

	// 2) สิทธิ์และวงเงินคงเหลือในปีของวันที่รักษา
	if limit > 0 {
		year := time.Now().Year()
		if t.TreatmentDate != nil {
			if d, err := time.Parse("2006-01-02", *t.TreatmentDate); err == nil {
				year = d.Year()
			}
		}
		var used float64
		err := a.db.QueryRowContext(ctx, `
			SELECT COALESCE(SUM(COALESCE(amount_approved, amount_requested)), 0) FROM tickets
			WHERE requester_id=$1 AND relation=$2 AND treatment_type=$3 AND id<>$4
			  AND status NOT IN ('draft','rejected')
			  AND EXTRACT(YEAR FROM COALESCE(treatment_date, created_at::date)) = $5`,
			t.RequesterID, t.Relation, t.TreatmentType, t.ID, year).Scan(&used)
		if err != nil {
			return nil, err
		}
		remaining := math.Max(0, limit-used)
		est := math.Min(t.AmountRequested*pct/100, remaining)
		rep.Entitlement = &Entitlement{AnnualLimit: limit, Used: used, Remaining: remaining, ReimbursePct: pct, Estimate: round2(est)}
		if t.AmountRequested*pct/100 > remaining {
			rep.Flags = append(rep.Flags, Flag{"over_limit", "warn",
				fmt.Sprintf("ยอดเกินวงเงินคงเหลือ (เหลือ %s บาท)", money(remaining))})
		}
	}

	// 3) ความผิดปกติ
	if t.AmountOCR != nil && math.Abs(*t.AmountOCR-t.AmountRequested) >= 1 {
		rep.Flags = append(rep.Flags, Flag{"amount_mismatch", "danger",
			fmt.Sprintf("ยอดที่กรอก (%s) ไม่ตรงกับยอดที่อ่านได้จากใบเสร็จ (%s)", money(t.AmountRequested), money(*t.AmountOCR))})
	}
	var dupFiles int
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT o.ticket_id) FROM attachments a
		JOIN attachments o ON o.sha256 = a.sha256 AND o.ticket_id <> a.ticket_id
		JOIN tickets ot ON ot.id = o.ticket_id AND ot.status NOT IN ('draft','rejected')
		WHERE a.ticket_id = $1`, t.ID).Scan(&dupFiles); err != nil {
		return nil, err
	}
	if dupFiles > 0 {
		rep.Flags = append(rep.Flags, Flag{"duplicate_file", "danger", fmt.Sprintf("ไฟล์แนบเหมือนกับไฟล์ในเรื่องอื่น %d เรื่อง", dupFiles)})
	}
	if t.Hospital != "" && (t.ReceiptNo != "" || t.TreatmentDate != nil) {
		var dupCodes pq.StringArray
		if err := a.db.QueryRowContext(ctx, `
			SELECT COALESCE(array_agg(code), '{}') FROM tickets
			WHERE id <> $1 AND status NOT IN ('draft','rejected') AND lower(hospital) = lower($2)
			  AND ( ($3 <> '' AND receipt_no = $3)
			     OR (treatment_date = $4::date AND amount_requested = $5) )`,
			t.ID, t.Hospital, t.ReceiptNo, t.TreatmentDate, t.AmountRequested).Scan(&dupCodes); err != nil {
			return nil, err
		}
		if len(dupCodes) > 0 {
			rep.Flags = append(rep.Flags, Flag{"duplicate_receipt", "danger", "ใบเสร็จอาจซ้ำกับ " + joinThai(dupCodes)})
		}
	}
	if t.TreatmentDate != nil {
		if d, err := time.Parse("2006-01-02", *t.TreatmentDate); err == nil {
			if d.After(time.Now().Add(24 * time.Hour)) {
				rep.Flags = append(rep.Flags, Flag{"future_date", "danger", "วันที่รักษาอยู่ในอนาคต"})
			} else if time.Since(d) > lateSubmissionDays*24*time.Hour {
				rep.Flags = append(rep.Flags, Flag{"late_submission", "warn", fmt.Sprintf("ยื่นเกิน %d วันหลังวันที่รักษา", lateSubmissionDays)})
			}
		}
	}

	// 4) ลำดับความสำคัญ: ยอดเงินสูง + มีธงอันตราย ให้ขึ้นก่อน (SLA ใช้เรียงอีกชั้นในคิว)
	p := int(math.Min(30, t.AmountRequested/2000))
	for _, f := range rep.Flags {
		if f.Level == "danger" {
			p += 20
		}
	}
	if t.TreatmentType == "IPD" {
		p += 10
	}
	rep.Priority = p

	// 5) คาดการณ์วันได้รับเงิน จากเวลาเฉลี่ยของเรื่องที่ปิดแล้ว 180 วันล่าสุด
	if !slices.Contains([]string{"draft", "paid", "rejected"}, t.Status) {
		var avgSec sql.NullFloat64
		var n int
		a.db.QueryRowContext(ctx, `
			SELECT AVG(EXTRACT(EPOCH FROM closed_at - submitted_at)), COUNT(*) FROM tickets
			WHERE status='paid' AND submitted_at IS NOT NULL AND closed_at > now() - interval '180 days'`).Scan(&avgSec, &n)
		cycle := defaultCycle
		if n >= 3 && avgSec.Valid {
			cycle = time.Duration(avgSec.Float64) * time.Second
		}
		start := time.Now()
		if t.SubmittedAt != nil {
			start = *t.SubmittedAt
		}
		eta := start.Add(cycle)
		if eta.Before(time.Now()) {
			eta = time.Now().Add(24 * time.Hour)
		}
		rep.ETA = &eta
	}
	return rep, nil
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func money(f float64) string {
	s := fmt.Sprintf("%.2f", f)
	intPart, dec := s[:len(s)-3], s[len(s)-3:]
	neg := false
	if len(intPart) > 0 && intPart[0] == '-' {
		neg, intPart = true, intPart[1:]
	}
	var out []byte
	for i, c := range []byte(intPart) {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, c)
	}
	if neg {
		return "-" + string(out) + dec
	}
	return string(out) + dec
}

func joinThai(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	s := ""
	for i, it := range items {
		if i == len(items)-1 {
			s += " และ " + it
		} else if i > 0 {
			s += ", " + it
		} else {
			s += it
		}
	}
	return s
}
