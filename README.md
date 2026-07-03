# מערכת איסוף חשבוניות אוטומטית

## תיאור

מערכת Python אוטומטית לאיסוף חשבוניות, קבלות ואישורי תשלום מתיבת דואר אלקטרוני דרך פרוטוקול IMAP מאובטח (SSL). המערכת מסננת הודעות לפי מילות מפתח, שומרת קבצים מצורפים בתיקיות מאורגנות לפי שנה וחודש, ומייצאת את כל הנתונים לקבצי CSV ו-JSON.

---

## דרישות מערכת

- Python 3.10 ומעלה
- חיבור לאינטרנט
- חשבון Gmail (או כל ספק דואר התומך ב-IMAP)
- **סיסמת אפליקציה** (App Password) — ראה הוראות בהמשך

---

## התקנה

### 1. הורד את הפרויקט

```bash
git clone https://github.com/YOUR_USERNAME/invoice-fetcher.git
cd invoice-fetcher
```

### 2. התקן תלויות

```bash
pip install -r requirements.txt
```

### 3. הגדר פרטי גישה

```bash
cp .env.example .env
```

ערוך את קובץ `.env` עם פרטי החשבון שלך (ראה סעיף **הגדרות** למטה).

---

## הגדרות

ערוך את קובץ `.env`:

| משתנה | תיאור | ברירת מחדל |
|---|---|---|
| `IMAP_SERVER` | כתובת שרת ה-IMAP | `imap.gmail.com` |
| `IMAP_PORT` | פורט IMAP (SSL) | `993` |
| `EMAIL_ADDRESS` | כתובת הדואר האלקטרוני שלך | — חובה — |
| `EMAIL_PASSWORD` | סיסמת האפליקציה | — חובה — |
| `DAYS_BACK` | כמה ימים אחורה לסרוק | `30` |
| `UNREAD_ONLY` | לסנן רק הודעות שלא נקראו | `true` |
| `OUTPUT_DIR` | תיקיית הפלט | `output` |

### הגדרת Gmail — סיסמת אפליקציה

> **חשוב:** אין להשתמש בסיסמה הרגילה של Gmail. יש להשתמש בסיסמת אפליקציה ייעודית.

1. כנס לחשבון Google שלך ← [myaccount.google.com](https://myaccount.google.com)
2. עבור לסעיף **אבטחה** ← **אימות דו-שלבי** (ודא שמופעל)
3. בחר **סיסמאות לאפליקציות**
4. צור סיסמה חדשה לאפליקציה "Mail"
5. העתק את הסיסמה שנוצרה לשדה `EMAIL_PASSWORD` בקובץ `.env`

לאפשר IMAP ב-Gmail:
1. Gmail ← הגדרות ← **ראה את כל ההגדרות** ← לשונית **העברה ו-POP/IMAP**
2. הפעל **IMAP Access** ← שמור שינויים

---

## הפעלה

```bash
python main.py
```

לעצירה: `Ctrl+C` — המערכת תצא בצורה מסודרת.

---

## מבנה הפלט

```
output/
├── invoices/
│   ├── 2024/
│   │   ├── 01/
│   │   │   ├── חשבונית_ינואר.pdf
│   │   │   └── קבלה_0001.pdf
│   │   └── 02/
│   │       └── invoice_feb.pdf
│   └── 2025/
│       └── ...
├── logs/
│   └── invoice_fetcher.log       # לוג מלא של כל הפעולות
├── חשבוניות_2025-01-15.csv       # טבלת נתונים לפתיחה ב-Excel
└── חשבוניות_2025-01-15.json      # נתונים בפורמט JSON
```

### עמודות קובץ ה-CSV

| עמודה | תיאור |
|---|---|
| מזהה | UID הייחודי של ההודעה בשרת ה-IMAP |
| תאריך | תאריך שליחת ההודעה |
| שולח | כתובת הדואר של השולח |
| נושא | נושא ההודעה |
| נתיב_קובץ | נתיב מלא לקובץ שנשמר (אם קיים) |
| קובץ_מצורף | כן / לא |
| הערות | הערות נוספות (למשל "חשבונית בגוף ההודעה") |

---

## פתרון בעיות

| שגיאה | פתרון |
|---|---|
| `חסרים משתני סביבה חיוניים` | ודא שקובץ `.env` קיים ומלא, ושלא נשארו ערכי placeholder |
| `כשל בחיבור לשרת הדואר` | בדוק שה-IMAP מופעל ב-Gmail וסיסמת האפליקציה נכונה |
| `שגיאה בייצוא נתונים` | ודא שלתהליך יש הרשאות כתיבה לתיקיית `output/` |
| קבצים לא נשמרים | ודא שסוג הקובץ הוא PDF, PNG, JPEG או JPG |
| תווים לא קריאים ב-CSV | פתח את ה-CSV דרך **ייבוא** ב-Excel ובחר קידוד **UTF-8** |

---

## SaaS Troubleshooting — "Scan fails every time"

The SaaS app lives in `web/` (Next.js) and `worker/` (FastAPI). When a scan
fails consistently, walk these steps in order — the most common cause is the
Gmail OAuth grant losing the `gmail.readonly` scope on a re-sign-in.

### 1. Hit the readiness endpoint

Sign in and visit `/api/health/scan-readiness`. The JSON output tells you
which stage is broken:

```json
{
  "status": "not_ready",
  "env":    { "ok": true,  "vars": { ... } },
  "db":     { "ok": true,  "error": null },
  "worker": { "ok": true,  "url": "...", "error": null },
  "gmailConnection": {
    "present": true,
    "email": "you@gmail.com",
    "hasRefreshToken": true,
    "hasGmailScope": false,      // ← the typical failure
    "grantedScopes": ["openid", "email", "profile", ...],
    "error": "Gmail permission missing — reconnect and tick the Gmail box..."
  }
}
```

### 2. Diagnose by `status` value

| Stage broken | What it means | Fix |
|---|---|---|
| `env.ok: false` | Missing env var — see the `vars` map | Set the missing var in Vercel / Render / `.env` |
| `db.ok: false` | Neon DB unreachable, password rotated, or branch suspended | Verify `DATABASE_URL` in Vercel; wake the Neon branch |
| `worker.ok: false` | Render service sleeping, env stale, or crashed | Check `https://<worker>.onrender.com/health`; review Render logs |
| `gmailConnection.hasGmailScope: false` | OAuth grant dropped `gmail.readonly` (most common) | **Reconnect — see step 3** |
| `gmailConnection.hasRefreshToken: false` | Google didn't issue a refresh token | Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), then sign in again |

### 3. Reconnect Gmail (the right way)

If `hasGmailScope` is `false`, Google's consent screen previously rendered the
Gmail box **unchecked** or the user didn't re-consent. To recover:

1. Open <https://myaccount.google.com/permissions>
2. Find the OAuth app and click **Remove Access**
3. Sign out of the SaaS app and sign in again via `/login`
4. On Google's consent screen, **tick every requested checkbox**, especially
   _"View your email messages and settings"_ (gmail.readonly)
5. Hit `/api/health/scan-readiness` again — `hasGmailScope` should now be `true`

### 4. Why this happens

- Google's OAuth token endpoint returns `invalid_scope: Bad Request` for any
  refresh request that includes a `scope` parameter, regardless of value.
  The worker (`worker/main.py`) no longer sends it, but
  `google-auth.from_authorized_user_info` prefers `info["scopes"]` over the
  function arg, so the field must be omitted from the dict — not just the
  function call.
- Refreshing without a `scope` param returns a token with **the scopes
  originally granted by that refresh_token**, not the scopes requested at
  app config time. If the user reconnected without granting Gmail, the
  resulting token is missing Gmail.readonly and every Gmail API call
  returns `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`.
- `auth.ts` now overwrites the stored `scopes[]` on every sign-in (it used
  to only write on first connect), so the DB state matches reality and
  `/api/scans` rejects requests with missing Gmail scope before dispatching
  any worker traffic.

### 5. Local QA scripts

In `scripts/diagnostics/` (run from repo root):

| Script | Purpose |
|---|---|
| `node scripts/diagnostics/diag_db.mjs` | Test Neon connection, list tables |
| `node scripts/diagnostics/diag_state.mjs` | Dump last 10 scans + Gmail connection status (no secrets) |
| `node scripts/diagnostics/diag_oauth.mjs` + `python scripts/diagnostics/diag_oauth.py` | Reproduce the OAuth refresh path against live Google |
| `python scripts/diagnostics/diag_oauth_inspect.py` | Direct POST to Google's token endpoint to see exact granted scopes |

---

## מבנה הפרויקט

```
invoice-fetcher/
├── main.py                      # נקודת כניסה ראשית
├── requirements.txt
├── .env.example
├── config/
│   └── settings.py              # טעינת הגדרות
├── core/
│   ├── email_connector.py       # חיבור IMAP מאובטח
│   ├── email_filter.py          # סינון ופענוח הודעות
│   ├── attachment_handler.py    # שמירת קבצים מצורפים
│   ├── body_parser.py           # פענוח גוף ההודעה
│   └── data_exporter.py         # ייצוא CSV ו-JSON
├── utils/
│   └── logger.py                # לוגר צבעוני בעברית
└── output/                      # תיקיית הפלט (נוצרת אוטומטית)
```
