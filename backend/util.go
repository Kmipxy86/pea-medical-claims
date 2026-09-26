package main

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

type apiError struct {
	Error   string   `json:"error"`
	Details []string `json:"details,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string, details ...string) {
	writeJSON(w, status, apiError{Error: msg, Details: details})
}

func serverErr(w http.ResponseWriter, err error) {
	log.Printf("internal error: %v", err)
	writeErr(w, http.StatusInternalServerError, "เกิดข้อผิดพลาดในระบบ")
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	return nil
}

func pathID(r *http.Request) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid id")
	}
	return id, nil
}

func pqArray(s []string) driver.Valuer { return pq.Array(s) }

func clientIP(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		return strings.TrimSpace(strings.Split(f, ",")[0])
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	return host
}

// audit บันทึกการกระทำลง audit_log (ไม่ให้ความผิดพลาดของ log ทำให้คำขอล้ม)
func (a *App) audit(r *http.Request, actorID int64, action string, ticketID *int64, detail string) {
	_, err := a.db.ExecContext(r.Context(),
		`INSERT INTO audit_log (actor_id, action, ticket_id, detail, ip) VALUES ($1,$2,$3,$4,$5)`,
		actorID, action, ticketID, detail, clientIP(r))
	if err != nil {
		log.Printf("audit: %v", err)
	}
}

func securityHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Cache-Control", "no-store")
		h.ServeHTTP(w, r)
	})
}

type stringArray = pq.StringArray
