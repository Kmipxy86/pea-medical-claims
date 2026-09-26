// Command api คือ backend ของระบบเบิกค่ารักษาพยาบาล (Intelligent Ticket Management)
package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

type Config struct {
	Port           string
	DatabaseURL    string
	JWTSecret      []byte
	GoogleClientID string
	AllowedDomain  string   // ถ้าตั้งไว้ รับเฉพาะอีเมลของโดเมนนี้ (เช่น pea.co.th)
	AdminEmails    []string // อีเมลที่ได้สิทธิ์ admin อัตโนมัติเมื่อเข้าระบบครั้งแรก
	DevLogin       bool     // เปิดปุ่มเข้าระบบแบบทดสอบ — ห้ามเปิดใน production
	CookieSecure   bool
	UploadDir      string
	MaxUploadMB    int64
	SLAHours       int
	AnthropicKey   string // ถ้าไม่ตั้ง ระบบจะปิดการอ่านใบเสร็จอัตโนมัติ
	AnthropicModel string
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func loadConfig() (Config, error) {
	c := Config{
		Port:           env("PORT", "8080"),
		DatabaseURL:    env("DATABASE_URL", "postgres://claims:claims@localhost:5432/claims?sslmode=disable"),
		JWTSecret:      []byte(env("JWT_SECRET", "")),
		GoogleClientID: env("GOOGLE_CLIENT_ID", ""),
		AllowedDomain:  strings.ToLower(env("ALLOWED_EMAIL_DOMAIN", "")),
		DevLogin:       env("DEV_LOGIN", "false") == "true",
		CookieSecure:   env("COOKIE_SECURE", "false") == "true",
		UploadDir:      env("UPLOAD_DIR", "./uploads"),
		AnthropicKey:   env("ANTHROPIC_API_KEY", ""),
		AnthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5"),
	}
	for _, e := range strings.Split(env("ADMIN_EMAILS", ""), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			c.AdminEmails = append(c.AdminEmails, e)
		}
	}
	var err error
	if c.MaxUploadMB, err = strconv.ParseInt(env("MAX_UPLOAD_MB", "10"), 10, 64); err != nil {
		return c, fmt.Errorf("MAX_UPLOAD_MB: %w", err)
	}
	if c.SLAHours, err = strconv.Atoi(env("SLA_HOURS", "72")); err != nil {
		return c, fmt.Errorf("SLA_HOURS: %w", err)
	}
	if len(c.JWTSecret) < 32 {
		return c, errors.New("JWT_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร")
	}
	if c.GoogleClientID == "" && !c.DevLogin {
		return c, errors.New("ต้องตั้ง GOOGLE_CLIENT_ID (หรือเปิด DEV_LOGIN=true สำหรับทดสอบในเครื่อง)")
	}
	return c, nil
}

type App struct {
	cfg    Config
	db     *sql.DB
	google *googleVerifier
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(20)
	if err := waitForDB(db); err != nil {
		log.Fatal(err)
	}
	if err := migrate(db); err != nil {
		log.Fatal("migrate: ", err)
	}
	if err := os.MkdirAll(cfg.UploadDir, 0o750); err != nil {
		log.Fatal(err)
	}

	app := &App{cfg: cfg, db: db, google: newGoogleVerifier(cfg.GoogleClientID)}
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           app.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("API listening on :%s (dev login: %v)", cfg.Port, cfg.DevLogin)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func waitForDB(db *sql.DB) error {
	var err error
	for i := 0; i < 30; i++ {
		if err = db.Ping(); err == nil {
			return nil
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("เชื่อมต่อฐานข้อมูลไม่ได้: %w", err)
}

// migrate รันไฟล์ SQL ใน migrations/ ตามลำดับชื่อ ไฟล์ละครั้งเดียว
func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := migrationsFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		var exists bool
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)`, name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := migrationsFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations(name) VALUES ($1)`, name); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		log.Printf("applied migration %s", name)
	}
	return nil
}

func (a *App) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	// การเข้าระบบ
	mux.HandleFunc("GET /api/auth/config", a.handleAuthConfig)
	mux.HandleFunc("POST /api/auth/google", a.handleGoogleLogin)
	mux.HandleFunc("POST /api/auth/dev", a.handleDevLogin)
	mux.HandleFunc("POST /api/auth/logout", a.handleLogout)
	mux.Handle("GET /api/me", a.auth(a.handleMe))

	// ผู้ยื่นเรื่อง
	mux.Handle("GET /api/me/entitlements", a.auth(a.handleMyEntitlements))
	mux.Handle("GET /api/tickets", a.auth(a.handleListTickets))
	mux.Handle("POST /api/tickets", a.auth(a.handleCreateTicket))
	mux.Handle("GET /api/tickets/{id}", a.auth(a.handleGetTicket))
	mux.Handle("PATCH /api/tickets/{id}", a.auth(a.handleUpdateTicket))
	mux.Handle("POST /api/tickets/{id}/transition", a.auth(a.handleTransition))
	mux.Handle("POST /api/tickets/{id}/comments", a.auth(a.handleAddComment))
	mux.Handle("POST /api/tickets/{id}/attachments", a.auth(a.handleUpload))
	mux.Handle("GET /api/attachments/{id}", a.auth(a.handleDownload))
	mux.Handle("DELETE /api/attachments/{id}", a.auth(a.handleDeleteAttachment))

	// เจ้าหน้าที่
	mux.Handle("GET /api/queue", a.role(a.handleQueue, "reviewer", "approver", "finance", "admin"))
	mux.Handle("GET /api/stats", a.role(a.handleStats, "reviewer", "approver", "finance", "admin"))

	// ผู้ดูแลระบบ
	mux.Handle("GET /api/admin/users", a.role(a.handleListUsers, "admin"))
	mux.Handle("PATCH /api/admin/users/{id}", a.role(a.handleUpdateUser, "admin"))
	mux.Handle("GET /api/admin/rules", a.role(a.handleListRules, "admin", "reviewer", "approver"))
	mux.Handle("PUT /api/admin/rules/{id}", a.role(a.handleUpdateRule, "admin"))
	mux.Handle("GET /api/admin/audit", a.role(a.handleAudit, "admin"))

	return securityHeaders(mux)
}
