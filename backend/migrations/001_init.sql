-- ระบบเบิกค่ารักษาพยาบาล: โครงสร้างข้อมูลเริ่มต้น

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    picture       TEXT NOT NULL DEFAULT '',
    employee_code TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'employee'
                  CHECK (role IN ('employee','reviewer','approver','finance','admin')),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- กฎสิทธิ์: วงเงินต่อปี ต่อความสัมพันธ์ของผู้ป่วย ต่อประเภทการรักษา
CREATE TABLE entitlement_rules (
    id              BIGSERIAL PRIMARY KEY,
    relation        TEXT NOT NULL CHECK (relation IN ('self','spouse','child','parent')),
    treatment_type  TEXT NOT NULL CHECK (treatment_type IN ('OPD','IPD')),
    annual_limit    NUMERIC(12,2) NOT NULL,
    reimburse_pct   NUMERIC(5,2)  NOT NULL DEFAULT 100,
    required_docs   TEXT[] NOT NULL DEFAULT ARRAY['receipt'],
    UNIQUE (relation, treatment_type)
);

-- ค่าตั้งต้นเป็นตัวอย่างเท่านั้น ให้ Admin แก้ให้ตรงระเบียบจริงในหน้า "ตั้งค่าสิทธิ์"
INSERT INTO entitlement_rules (relation, treatment_type, annual_limit, reimburse_pct, required_docs) VALUES
 ('self',   'OPD', 50000,  100, ARRAY['receipt']),
 ('self',   'IPD', 200000, 100, ARRAY['receipt','medical_certificate','expense_summary']),
 ('spouse', 'OPD', 30000,  100, ARRAY['receipt','relationship_proof']),
 ('spouse', 'IPD', 100000, 100, ARRAY['receipt','medical_certificate','expense_summary','relationship_proof']),
 ('child',  'OPD', 30000,  100, ARRAY['receipt','relationship_proof']),
 ('child',  'IPD', 100000, 100, ARRAY['receipt','medical_certificate','expense_summary','relationship_proof']),
 ('parent', 'OPD', 30000,  100, ARRAY['receipt','relationship_proof']),
 ('parent', 'IPD', 100000, 100, ARRAY['receipt','medical_certificate','expense_summary','relationship_proof']);

CREATE TABLE tickets (
    id               BIGSERIAL PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    requester_id     BIGINT NOT NULL REFERENCES users(id),
    patient_name     TEXT NOT NULL DEFAULT '',
    relation         TEXT NOT NULL DEFAULT 'self' CHECK (relation IN ('self','spouse','child','parent')),
    treatment_type   TEXT NOT NULL DEFAULT 'OPD' CHECK (treatment_type IN ('OPD','IPD')),
    hospital         TEXT NOT NULL DEFAULT '',
    receipt_no       TEXT NOT NULL DEFAULT '',
    treatment_date   DATE,
    amount_requested NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_ocr       NUMERIC(12,2),
    amount_approved  NUMERIC(12,2),
    status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','pending_review','in_review','need_info',
                                       'pending_approval','approved','rejected','paid')),
    assignee_id      BIGINT REFERENCES users(id),
    sla_due          TIMESTAMPTZ,
    flags            JSONB NOT NULL DEFAULT '[]',
    priority         INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at     TIMESTAMPTZ,
    closed_at        TIMESTAMPTZ
);
CREATE INDEX tickets_requester_idx ON tickets (requester_id);
CREATE INDEX tickets_status_idx    ON tickets (status);

CREATE TABLE attachments (
    id           BIGSERIAL PRIMARY KEY,
    ticket_id    BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    doc_type     TEXT NOT NULL CHECK (doc_type IN ('receipt','medical_certificate','expense_summary','relationship_proof','other')),
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    sha256       TEXT NOT NULL,
    storage_key  TEXT NOT NULL,
    ocr          JSONB,
    uploaded_by  BIGINT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_ticket_idx ON attachments (ticket_id);
CREATE INDEX attachments_sha_idx    ON attachments (sha256);

CREATE TABLE status_history (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    actor_id    BIGINT REFERENCES users(id),
    note        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX status_history_ticket_idx ON status_history (ticket_id);

CREATE TABLE comments (
    id         BIGSERIAL PRIMARY KEY,
    ticket_id  BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id  BIGINT NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    internal   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_ticket_idx ON comments (ticket_id);

-- บันทึกทุกการเปิดดูและแก้ไขข้อมูล (PDPA)
CREATE TABLE audit_log (
    id         BIGSERIAL PRIMARY KEY,
    actor_id   BIGINT REFERENCES users(id),
    action     TEXT NOT NULL,
    ticket_id  BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
    detail     TEXT NOT NULL DEFAULT '',
    ip         TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_ticket_idx ON audit_log (ticket_id);

CREATE SEQUENCE ticket_code_seq;
