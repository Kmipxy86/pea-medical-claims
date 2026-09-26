package main

import (
	"context"
	"crypto/rsa"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const (
	sessionCookie = "session"
	sessionTTL    = 8 * time.Hour
)

type User struct {
	ID           int64   `json:"id"`
	Email        string  `json:"email"`
	Name         string  `json:"name"`
	Picture      string  `json:"picture"`
	EmployeeCode string  `json:"employeeCode"`
	Role         string  `json:"role"`
	Active       bool    `json:"active"`
	CreatedAt    string  `json:"createdAt,omitempty"`
	LastLoginAt  *string `json:"lastLoginAt,omitempty"`
}

func (u *User) IsStaff() bool { return u.Role != "employee" }

type ctxKey struct{}

func currentUser(r *http.Request) *User { return r.Context().Value(ctxKey{}).(*User) }

// ---------------------------------------------------------------------------
// ตรวจ Google ID token (ลายเซ็น RS256 จาก JWKS ของ Google)
// ---------------------------------------------------------------------------

type googleVerifier struct {
	clientID string
	mu       sync.Mutex
	keys     map[string]*rsa.PublicKey
	expires  time.Time
	client   *http.Client
}

func newGoogleVerifier(clientID string) *googleVerifier {
	return &googleVerifier{clientID: clientID, client: &http.Client{Timeout: 10 * time.Second}}
}

type googleClaims struct {
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	HostedDomain  string `json:"hd"`
	jwt.RegisteredClaims
}

func (g *googleVerifier) key(kid string) (*rsa.PublicKey, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if k, ok := g.keys[kid]; ok && time.Now().Before(g.expires) {
		return k, nil
	}
	resp, err := g.client.Get("https://www.googleapis.com/oauth2/v3/certs")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return nil, err
	}
	keys := map[string]*rsa.PublicKey{}
	for _, k := range jwks.Keys {
		n, err1 := base64.RawURLEncoding.DecodeString(k.N)
		e, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil {
			continue
		}
		keys[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}
	}
	g.keys, g.expires = keys, time.Now().Add(time.Hour)
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	return nil, errors.New("unknown key id")
}

func (g *googleVerifier) Verify(token string) (*googleClaims, error) {
	if g.clientID == "" {
		return nil, errors.New("ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID")
	}
	claims := &googleClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return g.key(kid)
	},
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithAudience(g.clientID),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	if claims.Issuer != "accounts.google.com" && claims.Issuer != "https://accounts.google.com" {
		return nil, errors.New("issuer ไม่ถูกต้อง")
	}
	if !claims.EmailVerified || claims.Email == "" {
		return nil, errors.New("อีเมลยังไม่ได้ยืนยันกับ Google")
	}
	return claims, nil
}

// ---------------------------------------------------------------------------
// Session: JWT (HS256) เก็บใน httpOnly cookie
// ---------------------------------------------------------------------------

func (a *App) issueSession(w http.ResponseWriter, userID int64) error {
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(userID, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(sessionTTL)),
		Issuer:    "pea-medical-claims",
	})
	s, err := tok.SignedString(a.cfg.JWTSecret)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: s, Path: "/", HttpOnly: true,
		Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
		MaxAge: int(sessionTTL.Seconds()),
	})
	return nil
}

func (a *App) userFromRequest(r *http.Request) (*User, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil, err
	}
	claims := &jwt.RegisteredClaims{}
	_, err = jwt.ParseWithClaims(c.Value, claims, func(t *jwt.Token) (any, error) { return a.cfg.JWTSecret, nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("pea-medical-claims"), jwt.WithExpirationRequired())
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil {
		return nil, err
	}
	u, err := a.getUser(r.Context(), id)
	if err != nil {
		return nil, err
	}
	if !u.Active {
		return nil, errors.New("บัญชีถูกระงับ")
	}
	return u, nil
}

// auth บังคับให้ต้องเข้าระบบ และกัน CSRF ด้วย header X-Requested-With ในคำขอที่แก้ไขข้อมูล
func (a *App) auth(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Header.Get("X-Requested-With") != "fetch" {
			writeErr(w, http.StatusForbidden, "missing CSRF header")
			return
		}
		u, err := a.userFromRequest(r)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "กรุณาเข้าสู่ระบบ")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

func (a *App) role(h http.HandlerFunc, roles ...string) http.Handler {
	return a.auth(func(w http.ResponseWriter, r *http.Request) {
		if !slices.Contains(roles, currentUser(r).Role) {
			writeErr(w, http.StatusForbidden, "ไม่มีสิทธิ์เข้าถึง")
			return
		}
		h(w, r)
	})
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (a *App) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{
		"googleClientId": a.cfg.GoogleClientID,
		"devLogin":       a.cfg.DevLogin,
		"allowedDomain":  a.cfg.AllowedDomain,
		"ocrEnabled":     a.cfg.AnthropicKey != "",
	})
}

func (a *App) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Requested-With") != "fetch" {
		writeErr(w, http.StatusForbidden, "missing CSRF header")
		return
	}
	var body struct {
		Credential string `json:"credential"`
	}
	if err := readJSON(r, &body); err != nil || body.Credential == "" {
		writeErr(w, 400, "ไม่พบ credential จาก Google")
		return
	}
	claims, err := a.google.Verify(body.Credential)
	if err != nil {
		writeErr(w, 401, "ตรวจสอบบัญชี Google ไม่ผ่าน: "+err.Error())
		return
	}
	email := strings.ToLower(claims.Email)
	if d := a.cfg.AllowedDomain; d != "" && !strings.HasSuffix(email, "@"+d) {
		writeErr(w, 403, fmt.Sprintf("ระบบนี้รับเฉพาะบัญชี @%s", d))
		return
	}
	a.loginAs(w, r, email, claims.Name, claims.Picture, "")
}

// handleDevLogin ใช้ทดสอบในเครื่องเท่านั้น (DEV_LOGIN=true) — เลือก role ได้เอง
func (a *App) handleDevLogin(w http.ResponseWriter, r *http.Request) {
	if !a.cfg.DevLogin {
		writeErr(w, 404, "not found")
		return
	}
	if r.Header.Get("X-Requested-With") != "fetch" {
		writeErr(w, http.StatusForbidden, "missing CSRF header")
		return
	}
	var body struct {
		Email string `json:"email"`
		Name  string `json:"name"`
		Role  string `json:"role"`
	}
	if err := readJSON(r, &body); err != nil || !strings.Contains(body.Email, "@") {
		writeErr(w, 400, "กรอกอีเมลให้ถูกต้อง")
		return
	}
	if !validRole(body.Role) {
		body.Role = "employee"
	}
	if body.Name == "" {
		body.Name = strings.Split(body.Email, "@")[0]
	}
	a.loginAs(w, r, strings.ToLower(body.Email), body.Name, "", body.Role)
}

func (a *App) loginAs(w http.ResponseWriter, r *http.Request, email, name, picture, forceRole string) {
	role := "employee"
	if slices.Contains(a.cfg.AdminEmails, email) {
		role = "admin"
	}
	if forceRole != "" {
		role = forceRole
	}
	var id int64
	var active bool
	// ผู้ใช้ใหม่ได้ role ตามข้างบน ผู้ใช้เดิมคง role เดิม (ยกเว้น dev login ที่เลือก role เอง)
	err := a.db.QueryRowContext(r.Context(), `
		INSERT INTO users (email, name, picture, role, last_login_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (email) DO UPDATE SET
			name = COALESCE(NULLIF(EXCLUDED.name, ''), users.name),
			picture = COALESCE(NULLIF(EXCLUDED.picture, ''), users.picture),
			role = CASE WHEN $5 THEN EXCLUDED.role
			            WHEN users.email = ANY($6) THEN 'admin'
			            ELSE users.role END,
			last_login_at = now()
		RETURNING id, active`,
		email, name, picture, role, forceRole != "", pqArray(a.cfg.AdminEmails)).Scan(&id, &active)
	if err != nil {
		serverErr(w, err)
		return
	}
	if !active {
		writeErr(w, 403, "บัญชีนี้ถูกระงับการใช้งาน")
		return
	}
	if err := a.issueSession(w, id); err != nil {
		serverErr(w, err)
		return
	}
	a.audit(r, id, "login", nil, email)
	u, _ := a.getUser(r.Context(), id)
	writeJSON(w, 200, u)
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: a.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, currentUser(r))
}

func validRole(r string) bool {
	return slices.Contains([]string{"employee", "reviewer", "approver", "finance", "admin"}, r)
}

func (a *App) getUser(ctx context.Context, id int64) (*User, error) {
	u := &User{}
	var created time.Time
	var last sql.NullTime
	err := a.db.QueryRowContext(ctx, `SELECT id, email, name, picture, employee_code, role, active, created_at, last_login_at FROM users WHERE id=$1`, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.Picture, &u.EmployeeCode, &u.Role, &u.Active, &created, &last)
	if err != nil {
		return nil, err
	}
	u.CreatedAt = created.Format(time.RFC3339)
	if last.Valid {
		s := last.Time.Format(time.RFC3339)
		u.LastLoginAt = &s
	}
	return u, nil
}
