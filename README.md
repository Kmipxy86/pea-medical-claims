# ระบบเบิกค่ารักษาพยาบาล — Intelligent Ticket Management

เว็บแอปรับเรื่องและติดตามสถานะการเบิกค่ารักษาพยาบาล ใช้ได้ทั้งบน PC และโทรศัพท์
พนักงานถ่ายรูปใบเสร็จแล้วยื่นเรื่องได้จากมือถือ ส่วนเจ้าหน้าที่ตรวจเอกสารคู่กับข้อมูลในหน้าเดียวบน PC
ระบบช่วยตรวจความครบถ้วน สิทธิ์ วงเงิน และความผิดปกติให้ แต่ **การอนุมัติทำโดยคนเสมอ**

| PC — คิวงานเจ้าหน้าที่ | PC — ตรวจเรื่อง |
|---|---|
| ![](docs/screenshots/pc-queue.png) | ![](docs/screenshots/pc-review.png) |

| มือถือ — ยื่นเรื่อง | มือถือ — ติดตามสถานะ |
|---|---|
| <img src="docs/screenshots/mobile-new-claim.png" width="280"> | <img src="docs/screenshots/mobile-tracking.png" width="280"> |

## ความสามารถ

- **เข้าระบบด้วย Google Sign-in** จำกัดเฉพาะโดเมนองค์กรได้ ใช้ session เป็น JWT ใน httpOnly cookie มีบทบาท 5 แบบ
- **ยื่นเรื่องจากมือถือ** ถ่ายใบเสร็จแล้วให้ AI อ่านข้อมูลมากรอกให้ (เปิดใช้ได้ตามต้องการ) ระบบบอกเอกสารที่ขาดก่อนส่ง
- **ติดตามสถานะ** เป็น timeline แบบติดตามพัสดุ พร้อมวันที่คาดว่าจะได้รับเงิน และแชตกับเจ้าหน้าที่
- **คิวงานเจ้าหน้าที่** เรียงตาม SLA และคะแนนความสำคัญ กรองได้ตามสถานะ เรื่องที่รับไว้ ธง AI และ OPD/IPD
- **ตรวจอัตโนมัติ (Intelligent checks)**
  - เอกสารครบตามกฎสิทธิ์หรือไม่
  - วงเงินคงเหลือ และยอดที่คาดว่าเบิกได้
  - ไฟล์ซ้ำ (SHA-256) และใบเสร็จซ้ำ (เลขที่ใบเสร็จ หรือ รพ.+วันที่+ยอด)
  - ยอดที่กรอกไม่ตรงกับผลอ่านใบเสร็จ
  - วันที่รักษาอยู่ในอนาคต หรือยื่นเกินกำหนด
- **Workflow** ร่าง → รอตรวจ → กำลังตรวจ → (ขอข้อมูลเพิ่ม) → รออนุมัติ → อนุมัติ → จ่ายแล้ว / ไม่อนุมัติ
  ป้องกันการกดซ้ำพร้อมกัน และแบ่งแยกหน้าที่ (ห้ามตรวจหรืออนุมัติเรื่องของตัวเอง)
- **Dashboard** ตัวเลขรวม SLA เวลาเฉลี่ย และยอดรายเดือน
- **Admin** กำหนดบทบาทผู้ใช้ กฎวงเงินและเอกสารที่ต้องแนบ และดู audit log
- **PDPA** บันทึกทุกการเปิดดูเรื่องและไฟล์ แยกความเห็นภายในออกจากข้อความถึงผู้ยื่น
  ไฟล์แนบดาวน์โหลดได้ผ่าน API ที่ตรวจสิทธิ์เท่านั้น และ Dashboard ไม่มีข้อมูลรายบุคคล

## สถาปัตยกรรม

```
เบราว์เซอร์ (PC / มือถือ)
      │  https://…/        https://…/api/*
      ▼
┌──────────────┐  rewrite /api  ┌──────────────┐     ┌────────────┐
│ Next.js 15   │ ─────────────▶ │ Go API       │ ──▶ │ PostgreSQL │
│ (frontend)   │                │ (backend)    │     └────────────┘
└──────────────┘                │  ├ uploads/ (ไฟล์แนบ)
                                │  ├ Google JWKS (ตรวจ ID token)
                                │  └ Claude API (อ่านใบเสร็จ — ไม่บังคับ)
                                └──────────────┘
```

เบราว์เซอร์เรียก `/api` ที่โดเมนเดียวกับหน้าเว็บ แล้ว Next.js ส่งต่อไป Go backend
cookie ของการเข้าระบบจึงเป็น first-party และไม่ต้องเปิด CORS

| บทบาท | ทำอะไรได้ |
|---|---|
| `employee` พนักงาน | ยื่นเรื่องของตนเอง แนบไฟล์ ติดตามสถานะ และตอบข้อความ |
| `reviewer` เจ้าหน้าที่ตรวจสอบ | รับเรื่อง ขอข้อมูลเพิ่ม ส่งต่อผู้อนุมัติ หรือไม่อนุมัติ |
| `approver` ผู้อนุมัติ | อนุมัติ (กำหนดยอดได้) ส่งกลับให้ตรวจใหม่ หรือไม่อนุมัติ |
| `finance` การเงิน | บันทึกการจ่ายเงิน |
| `admin` ผู้ดูแลระบบ | ทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้ กฎสิทธิ์ และดู audit log |

## เริ่มใช้งานเร็วที่สุด (Docker)

```bash
cp .env.example .env          # แก้ JWT_SECRET และค่าอื่น ๆ
docker compose up --build
```

เปิด http://localhost:3000 โดยค่าเริ่มต้น `DEV_LOGIN=true` จะมีฟอร์ม **"เข้าระบบแบบทดสอบ"** ให้เลือกบทบาทได้เลย
จึงลองครบทุกบทบาทได้โดยยังไม่ต้องตั้งค่า Google

## ตั้งค่า Google Sign-in

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) แล้วสร้างหรือเลือก Project
2. ไปที่ **APIs & Services → OAuth consent screen**
   - ถ้าใช้ Google Workspace ขององค์กร ให้เลือก *Internal*
   - กรอกชื่อแอปและอีเมลติดต่อ
3. ไปที่ **Credentials → Create credentials → OAuth client ID** แล้วเลือกชนิด **Web application**
4. ที่ **Authorized JavaScript origins** ใส่ `http://localhost:3000` และโดเมนจริง เช่น `https://claims.example.com`
   (ไม่ต้องใส่ redirect URI เพราะใช้แบบ popup)
5. นำ Client ID ไปใส่ใน `.env`

```env
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
ALLOWED_EMAIL_DOMAIN=your-org.co.th   # ไม่บังคับ
ADMIN_EMAILS=you@your-org.co.th       # คนแรกที่จะเป็นผู้ดูแลระบบ
DEV_LOGIN=false
COOKIE_SECURE=true                    # เมื่อใช้ HTTPS
```

ผู้ใช้ใหม่จะได้บทบาท `employee` เมื่อเข้าระบบครั้งแรก จากนั้นผู้ดูแลระบบไปกำหนดบทบาทในหน้า **ตั้งค่าระบบ**

## พัฒนาในเครื่อง (ไม่ใช้ Docker)

ต้องมี Go 1.24+, Node 22+ และ PostgreSQL 16

```bash
# ฐานข้อมูล
createuser claims -P        # รหัสผ่าน: claims
createdb claims -O claims

# backend  (สร้างตารางอัตโนมัติจาก backend/migrations/)
cd backend
JWT_SECRET=$(openssl rand -base64 48) DEV_LOGIN=true go run .

# frontend (อีกหน้าต่างหนึ่ง)
cd frontend
npm install
npm run dev                 # http://localhost:3000
```

ทดสอบ: `cd backend && go test ./...` และ `cd frontend && npm run build`

## ตัวแปรสภาพแวดล้อม (backend)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `DATABASE_URL` | `postgres://claims:claims@localhost:5432/claims?sslmode=disable` | ฐานข้อมูล |
| `JWT_SECRET` | — (บังคับ ≥ 32 ตัวอักษร) | กุญแจเซ็น session |
| `GOOGLE_CLIENT_ID` | — | OAuth Client ID (บังคับ ถ้า `DEV_LOGIN=false`) |
| `ALLOWED_EMAIL_DOMAIN` | ว่าง | รับเฉพาะอีเมลโดเมนนี้ |
| `ADMIN_EMAILS` | ว่าง | อีเมลที่ได้สิทธิ์ admin อัตโนมัติ |
| `DEV_LOGIN` | `false` | เปิดการเข้าระบบแบบทดสอบ (**ห้ามเปิดใน production**) |
| `COOKIE_SECURE` | `false` | ตั้งเป็น `true` เมื่อใช้ HTTPS |
| `SLA_HOURS` | `72` | เวลาตรวจเรื่องตาม SLA |
| `MAX_UPLOAD_MB` | `10` | ขนาดไฟล์แนบสูงสุด |
| `UPLOAD_DIR` | `./uploads` | ที่เก็บไฟล์แนบ |
| `ANTHROPIC_API_KEY` | ว่าง | เปิดการอ่านใบเสร็จด้วย AI |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | โมเดลที่ใช้อ่านใบเสร็จ |

## ข้อควรระวังก่อนใช้งานจริง

- **กฎสิทธิ์และวงเงินใน migration เป็นตัวอย่างเท่านั้น** ต้องแก้ให้ตรงระเบียบสวัสดิการจริงในหน้า *ตั้งค่าระบบ*
- **การอ่านใบเสร็จด้วย AI** จะส่งรูปใบเสร็จไปประมวลผลนอกองค์กร ต้องได้รับอนุญาตตามนโยบาย PDPA/IT ก่อนตั้ง `ANTHROPIC_API_KEY`
  ถ้าไม่ตั้ง ระบบยังทำงานครบ เพียงแต่ผู้ยื่นต้องกรอกข้อมูลเอง
- **ความปลอดภัย**
  - ปิด `DEV_LOGIN`
  - เปิด HTTPS และ `COOKIE_SECURE=true`
  - สำรอง volume `pgdata` และ `uploads` สม่ำเสมอ
  - กำหนดระยะเวลาเก็บข้อมูลและ audit log ตามนโยบายองค์กร
- **สิ่งที่ยังไม่มี (ต่อยอดได้)**
  - แจ้งเตือนผ่าน LINE หรืออีเมล (ส่งแค่เลข Ticket และสถานะ ไม่ใส่ข้อมูลการรักษา)
  - จ่ายงานให้เจ้าหน้าที่อัตโนมัติตามภาระงาน
  - เก็บไฟล์บน object storage

## โครงสร้างโปรเจกต์

```
backend/                 Go API (net/http + lib/pq + golang-jwt)
  main.go                config, migration, routes
  auth.go                Google ID token, session cookie, middleware ตรวจสิทธิ์
  tickets.go             สร้าง/แก้ไข/ดูเรื่อง และข้อความ
  workflow.go            state machine ของสถานะ + สิทธิ์แต่ละขั้น
  intelligence.go        ตรวจเอกสาร สิทธิ์ วงเงิน ความผิดปกติ ลำดับความสำคัญ และ ETA
  attachments.go         อัปโหลด/ดาวน์โหลดไฟล์ และอ่านใบเสร็จด้วย Claude API
  staff.go               คิวงาน สถิติ และ admin
  migrations/            SQL schema
frontend/                Next.js 15 (App Router, TypeScript, CSS แบบ mobile-first)
  src/app/login          หน้าเข้าระบบ (Google + โหมดทดสอบ)
  src/app/(app)/claims   เรื่องของฉัน / ยื่นเรื่อง / ติดตามสถานะ
  src/app/(app)/queue    คิวงานและหน้าตรวจเรื่องของเจ้าหน้าที่
  src/app/(app)/dashboard, admin, profile
docker-compose.yml       db + backend + frontend
```
