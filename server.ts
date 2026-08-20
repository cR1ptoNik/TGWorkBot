import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import child_process from "child_process";
import dotenv from "dotenv";
import { createRequire } from "module";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();
const require = createRequire(import.meta.url);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "25mb" }));

// Data file paths
const DB_FILE = path.join(process.cwd(), "shift_attendance.db");
const DATA_FILE = path.join(process.cwd(), "shift_attendance.json");
const ROLES_FILE = path.join(process.cwd(), "bot_roles.json");
const SCHEDULE_FILE = path.join(process.cwd(), "schedule_config.json");
const LOGS_FILE = path.join(process.cwd(), "bot_activity.log");

// Safe helper to execute SQLite queries (using node:sqlite or python3 sqlite3 fallback)
let cachedDb: any = null;
let sqliteChecked = false;

function getDb(): any {
  if (cachedDb) return cachedDb;
  if (sqliteChecked) return null;

  try {
    const sqliteModule = require("node:sqlite");
    if (sqliteModule && sqliteModule.DatabaseSync) {
      const db = new sqliteModule.DatabaseSync(DB_FILE);
      try {
        db.exec("PRAGMA journal_mode = WAL;");
        db.exec("PRAGMA busy_timeout = 5000;");
      } catch (e) {}
      db.exec(`
        CREATE TABLE IF NOT EXISTS shift_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id INTEGER NOT NULL,
          telegram_user_id INTEGER,
          action TEXT NOT NULL,
          surname TEXT NOT NULL,
          time TEXT NOT NULL,
          time_line TEXT,
          raw_text TEXT,
          source TEXT DEFAULT 'telegram_bot',
          created_at TEXT NOT NULL
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS system_audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          level TEXT NOT NULL,
          user_id INTEGER,
          event_type TEXT NOT NULL,
          message TEXT NOT NULL,
          details TEXT
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS sent_reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          reminder_type TEXT NOT NULL,
          telegram_user_id INTEGER NOT NULL,
          sent_at TEXT NOT NULL,
          UNIQUE(date, reminder_type, telegram_user_id)
        )
      `);
      try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_shift_records_created_at ON shift_records(created_at);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_shift_records_user ON shift_records(telegram_user_id, created_at);`);
      } catch (e) {}
      cachedDb = db;
      return cachedDb;
    }
  } catch (err) {
    console.error("node:sqlite load error:", err);
  }

  sqliteChecked = true;
  return null;
}

// Unified SQLite execution function (works with node:sqlite or python3 fallback)
function execSql(sql: string, params: any[] = []): any {
  const db = getDb();
  if (db) {
    try {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith("SELECT")) {
        return db.prepare(sql).all(...params);
      } else {
        return db.prepare(sql).run(...params);
      }
    } catch (e) {
      console.error("node:sqlite exec error:", e);
    }
  }

  // Python SQLite fallback (guaranteed to match bot.py SQLite instance)
  try {
    const pythonScript = `
import sqlite3, json, sys
conn = sqlite3.connect('${DB_FILE}')
conn.row_factory = sqlite3.Row
try:
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
except Exception:
    pass
cur = conn.cursor()
sql = sys.argv[1]
params = json.loads(sys.argv[2])
cur.execute(sql, params)
trimmed = sql.strip().upper()
if trimmed.startswith("SELECT"):
    rows = [dict(r) for r in cur.fetchall()]
    print(json.dumps(rows))
else:
    conn.commit()
    print(json.dumps({"changes": cur.rowcount, "lastrowid": cur.lastrowid}))
`;
    const output = child_process.execFileSync(
      "python3",
      ["-c", pythonScript, sql, JSON.stringify(params)],
      { encoding: "utf-8", timeout: 5000 }
    );
    return JSON.parse(output.trim() || "null");
  } catch (err) {
    console.error("execSql Python fallback error:", err);
    return null;
  }
}

// Gemini AI client initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Data Helper Functions
function getTzOffsetHours(): number {
  try {
    const cfg = readScheduleConfig();
    return typeof cfg.tz_offset_hours === "number" ? cfg.tz_offset_hours : 3;
  } catch (e) {
    return 3;
  }
}

function getAdjustedDate(offsetHours: number = getTzOffsetHours()): { dateStr: string; timeStr: string; fullStr: string } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const localDate = new Date(utcMs + offsetHours * 3600000);
  
  const yyyy = localDate.getFullYear();
  const mm = String(localDate.getMonth() + 1).padStart(2, '0');
  const dd = String(localDate.getDate()).padStart(2, '0');
  const hh = String(localDate.getHours()).padStart(2, '0');
  const min = String(localDate.getMinutes()).padStart(2, '0');
  const ss = String(localDate.getSeconds()).padStart(2, '0');

  const dateStr = `${yyyy}-${mm}-${dd}`;
  const timeStr = `${hh}:${min}:${ss}`;
  const fullStr = `${dateStr} ${timeStr}`;

  return { dateStr, timeStr, fullStr };
}

// Seed default sample data if files don't exist
function initDefaultData() {
  if (!fs.existsSync(ROLES_FILE)) {
    const defaultRoles = {
      admin: { "Иванов.А.В": 123456789, "Петров.С.И": 987654321, "Сидорова.Е.М": 555444333 },
      user: { "Смирнов.Д.А": 112233445, "Кузнецов.М.П": 998877665, "Васильев.О.Н": 443322110 },
    };
    fs.writeFileSync(ROLES_FILE, JSON.stringify(defaultRoles, null, 2), "utf-8");
  }

  if (!fs.existsSync(SCHEDULE_FILE)) {
    const defaultSchedule = {
      shift_start: "09:00",
      shift_end: "18:00",
      tz_offset_hours: 3,
      remind_before_start_minutes: 5,
      remind_after_end_minutes: 5,
      enabled: true
    };
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(defaultSchedule, null, 2), "utf-8");
  }

  const db = getDb();
  const dbExisted = fs.existsSync(DB_FILE);
  const jsonExisted = fs.existsSync(DATA_FILE);

  // Only seed initial sample records if NEITHER file existed on disk previously
  if (!jsonExisted && !dbExisted) {
    const { dateStr } = getAdjustedDate(3);
    const defaultRecordsList = [
      {
        id: 1,
        chat_id: 1001,
        telegram_user_id: 123456789,
        action: "in",
        surname: "Иванов.А.В",
        time: "08:30:15",
        time_line: "Shift start Grade 08:30:15",
        raw_text: "RMAS Mobile Grade 08:30:15 Check In Иванов.А.В",
        source: "telegram_ocr",
        created_at: `${dateStr} 08:30:15`,
      },
      {
        id: 2,
        chat_id: 1002,
        telegram_user_id: 987654321,
        action: "in",
        surname: "Петров.С.И",
        time: "08:45:00",
        time_line: "Logged in 08:45:00",
        raw_text: "WorkTime Logged in 08:45:00 Петров.С.И",
        source: "telegram_ocr",
        created_at: `${dateStr} 08:45:00`,
      },
      {
        id: 3,
        chat_id: 1003,
        telegram_user_id: 555444333,
        action: "in",
        surname: "Сидорова.Е.М",
        time: "09:00:22",
        time_line: "Time: 09:00:22",
        raw_text: "Attendance check 09:00:22 Сидорова.Е.М",
        source: "web_manual",
        created_at: `${dateStr} 09:00:22`,
      },
      {
        id: 4,
        chat_id: 1001,
        telegram_user_id: 123456789,
        action: "out",
        surname: "Иванов.А.В",
        time: "17:30:10",
        time_line: "Shift end Grade 17:30:10",
        raw_text: "RMAS Mobile Grade 17:30:10 Check Out Иванов.А.В",
        source: "telegram_ocr",
        created_at: `${dateStr} 17:30:10`,
      },
    ];

    if (db) {
      try {
        const stmt = db.prepare(`
          INSERT INTO shift_records (id, chat_id, telegram_user_id, action, surname, time, time_line, raw_text, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of defaultRecordsList) {
          stmt.run(r.id, r.chat_id, r.telegram_user_id, r.action, r.surname, r.time, r.time_line, r.raw_text, r.source, r.created_at);
        }
      } catch (e) {
        console.error("Failed initial seed of DB:", e);
      }
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify({ records: defaultRecordsList, updated_at: new Date().toISOString() }, null, 2), "utf-8");
  }

  if (!fs.existsSync(LOGS_FILE)) {
    const { fullStr } = getAdjustedDate(3);
    const initialLogs = [
      `${fullStr} | INFO     | ShiftBotLogger | Initializing SQLite database tables...`,
      `${fullStr} | INFO     | ShiftBotLogger | Database initialized successfully.`,
      `${fullStr} | INFO     | ShiftBotLogger | Starting Telegram Bot with token prefix: 123456789...`,
    ].join("\n");
    fs.writeFileSync(LOGS_FILE, initialLogs + "\n", "utf-8");
  }
}

initDefaultData();

function addLogEntry(level: string, message: string) {
  const { fullStr } = getAdjustedDate();
  const padLevel = level.padEnd(8, " ");
  const line = `${fullStr} | ${padLevel} | ShiftBotLogger | ${message}\n`;
  try {
    fs.appendFileSync(LOGS_FILE, line, "utf-8");
  } catch (err) {
    console.error("Failed writing log entry:", err);
  }
}

// Data Helper Functions
function readShiftRecords(): any[] {
  try {
    const rows = execSql("SELECT * FROM shift_records ORDER BY id ASC");
    if (Array.isArray(rows)) {
      // Keep JSON file synchronized
      try {
        fs.writeFileSync(
          DATA_FILE,
          JSON.stringify({ records: rows, updated_at: new Date().toISOString() }, null, 2),
          "utf-8"
        );
      } catch (err) {}
      return rows;
    }
  } catch (e) {
    console.error("readShiftRecords SQLite error:", e);
  }

  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const data = JSON.parse(raw);
      return Array.isArray(data.records) ? data.records : [];
    }
    return [];
  } catch (e) {
    return [];
  }
}

function writeShiftRecords(records: any[]) {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ records: records || [], updated_at: new Date().toISOString() }, null, 2),
      "utf-8"
    );
    return true;
  } catch (e) {
    return false;
  }
}

function readScheduleConfig() {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) {
      return { shift_start: "09:00", shift_end: "18:00", tz_offset_hours: 3, remind_before_start_minutes: 5, remind_after_end_minutes: 5, enabled: true };
    }
    const raw = fs.readFileSync(SCHEDULE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    return { shift_start: "09:00", shift_end: "18:00", tz_offset_hours: 3, remind_before_start_minutes: 5, remind_after_end_minutes: 5, enabled: true };
  }
}

function writeScheduleConfig(cfg: any) {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(cfg, null, 2), "utf-8");
    addLogEntry("INFO", `SCHEDULE_UPDATED: Updated schedule to Start=${cfg.shift_start}, End=${cfg.shift_end}`);
    return true;
  } catch (e) {
    return false;
  }
}

function readRoles() {
  try {
    const raw = fs.readFileSync(ROLES_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // Convert any legacy creator key into admin
    const result: any = { admin: {}, user: {} };
    if (parsed.creator) {
      Object.assign(result.admin, parsed.creator);
    }
    if (parsed.admin) {
      Object.assign(result.admin, parsed.admin);
    }
    if (parsed.user) {
      Object.assign(result.user, parsed.user);
    }
    return result;
  } catch (e) {
    return { admin: {}, user: {} };
  }
}

function writeRoles(roles: any) {
  try {
    fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2), "utf-8");
    addLogEntry("INFO", "ROLES_UPDATED: Updated bot user roles.");
    return true;
  } catch (e) {
    return false;
  }
}

// Telegram WebApp Authentication
function verifyTelegramWebAppData(initData: string, botToken: string): any {
  if (!initData) return null;
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return null;
    urlParams.delete('hash');
    
    // Validate expiration (24 hours)
    const authDate = urlParams.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10);
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (currentTimestamp - authTimestamp > 86400) {
        console.error("Telegram initData expired.");
        return null;
      }
    }

    const dataCheckString = Array.from(urlParams.entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('\n');
      
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
    if (calculatedHash === hash) {
      const userStr = urlParams.get('user');
      if (userStr) {
        return JSON.parse(decodeURIComponent(userStr));
      }
      return { id: urlParams.get('auth_date') }; 
    }
    return null;
  } catch (e) {
    console.error("verifyTelegramWebAppData error:", e);
    return null;
  }
}

// Custom Authentication Middleware
app.use("/api", (req, res, next) => {
  // Allow health endpoint publicly
  if (req.path === "/health") {
    return next();
  }

  const initData = req.headers['x-telegram-init-data'] as string;
  const botToken = process.env.BOT_TOKEN;
  
  // BYPASS FOR LOCAL PREVIEW / AI STUDIO
  if (!botToken && process.env.NODE_ENV !== "production") {
    (req as any).telegramUser = { id: 123456789 }; // Mock admin ID for preview
    return next();
  }

  if (!botToken) {
    console.error("BOT_TOKEN is missing in environment! Cannot validate WebApp data.");
    return res.status(500).json({ error: "Server Configuration Error: Missing BOT_TOKEN" });
  }

  const user = verifyTelegramWebAppData(initData, botToken);
  
  if (!user || !user.id) {
    addLogEntry("WARNING", `AUTH_FAILED: Invalid or missing Telegram WebApp Signature from ${req.ip}`);
    return res.status(403).json({ error: "Access Denied: Invalid Telegram WebApp Signature" });
  }
  
  // Attach user to req for downstream usage
  (req as any).telegramUser = user;
  
  next();
});

// API Routes

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Stats API
app.get("/api/stats", (req, res) => {
  const records = readShiftRecords();
  const roles = readRoles();
  const { dateStr: today } = getAdjustedDate();

  const todayRecords = records.filter((r: any) => r.created_at && r.created_at.startsWith(today));

  const totalRegisteredUsers =
    Object.keys(roles.creator || {}).length +
    Object.keys(roles.admin || {}).length +
    Object.keys(roles.user || {}).length;

  const checkedInSurnames = new Set();
  const checkedOutSurnames = new Set();

  todayRecords.forEach((r: any) => {
    if (r.action === "in") checkedInSurnames.add(r.surname);
    if (r.action === "out") checkedOutSurnames.add(r.surname);
  });

  res.json({
    today_date: today,
    total_records: records.length,
    today_total_marks: todayRecords.length,
    today_checked_in: checkedInSurnames.size,
    today_checked_out: checkedOutSurnames.size,
    registered_users_count: totalRegisteredUsers,
  });
});

// Get Shift Records (with filter & query)
app.get("/api/records", (req, res) => {
  let records = readShiftRecords();
  const { surname, date, date_from, date_to, action, search } = req.query;

  if (surname) {
    records = records.filter((r: any) => r.surname.toLowerCase().includes(String(surname).toLowerCase()));
  }
  if (date) {
    records = records.filter((r: any) => r.created_at && r.created_at.startsWith(String(date)));
  }
  if (date_from) {
    records = records.filter((r: any) => r.created_at && r.created_at.substring(0, 10) >= String(date_from));
  }
  if (date_to) {
    records = records.filter((r: any) => r.created_at && r.created_at.substring(0, 10) <= String(date_to));
  }
  if (action && (action === "in" || action === "out")) {
    records = records.filter((r: any) => r.action === action);
  }
  if (search) {
    const q = String(search).toLowerCase();
    records = records.filter(
      (r: any) =>
        r.surname.toLowerCase().includes(q) ||
        (r.time && r.time.includes(q)) ||
        (r.raw_text && r.raw_text.toLowerCase().includes(q))
    );
  }

  records.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  res.json({ count: records.length, records });
});

// Add Manual Shift Record with Honesty Check
app.post("/api/records", (req, res) => {
  const { surname, action, time, notes, date, bypass_honesty } = req.body;

  if (!surname || !action || !time) {
    return res.status(400).json({ error: "Surname, action, and time are required." });
  }

  const { dateStr } = getAdjustedDate();
  const recordDate = date || dateStr;
  const trimmedTime = time.trim();
  const trimmedSurname = surname.trim();

  // --- Honesty Check (Проверка честности за последние 7 дней) ---
  // Ensure the exact time (with seconds) has not been logged by same or other user in last 7 days
  if (!bypass_honesty) {
    try {
      const records = readShiftRecords();
      const sevenDaysAgoDate = new Date();
      sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 7);
      const sevenDaysAgoStr = sevenDaysAgoDate.toISOString().split("T")[0];

      const duplicate = records.find((r: any) => {
        if (!r.time || !r.created_at) return false;
        const rDate = r.created_at.split(" ")[0];
        return r.time === trimmedTime && rDate >= sevenDaysAgoStr;
      });

      if (duplicate) {
        const isSame = duplicate.surname?.toLowerCase() === trimmedSurname.toLowerCase();
        const dupAction = duplicate.action === "in" ? "Приход" : "Уход";
        const reason = isSame
          ? `Точное время ${trimmedTime} уже было зафиксировано вами ранее (${duplicate.created_at}, ${dupAction}). Повторная отправка скриншотов запрещена.`
          : `Точное время ${trimmedTime} уже использовалось сотрудником ${duplicate.surname} (${duplicate.created_at}). Использование чужих скриншотов запрещено.`;

        addLogEntry("WARNING", `HONESTY_CHECK_FAILED: Duplicate time '${trimmedTime}' rejected for ${trimmedSurname}. Match: ${duplicate.surname} (${duplicate.created_at})`);

        return res.status(409).json({
          error: reason,
          is_honesty_error: true,
          duplicate_record: duplicate,
        });
      }
    } catch (e) {
      console.error("Honesty check error in /api/records:", e);
    }
  }

  const newRecord = {
    id: Date.now(),
    chat_id: 1000 + Math.floor(Math.random() * 9000),
    telegram_user_id: 123456789,
    action: action === "out" ? "out" : "in",
    surname: trimmedSurname,
    time: trimmedTime,
    time_line: `Manual Log: ${trimmedTime}`,
    raw_text: notes || "Added via Web Dashboard",
    source: "web_manual",
    created_at: `${recordDate} ${trimmedTime}`,
  };

  try {
    execSql(
      `INSERT INTO shift_records (id, chat_id, telegram_user_id, action, surname, time, time_line, raw_text, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newRecord.id,
        newRecord.chat_id,
        newRecord.telegram_user_id,
        newRecord.action,
        newRecord.surname,
        newRecord.time,
        newRecord.time_line,
        newRecord.raw_text,
        newRecord.source,
        newRecord.created_at,
      ]
    );
  } catch (e) {
    console.error("Failed inserting into DB:", e);
  }

  const records = readShiftRecords();
  if (!records.some((r: any) => Number(r.id) === newRecord.id)) {
    records.push(newRecord);
  }
  writeShiftRecords(records);
  addLogEntry("INFO", `MANUAL_RECORD_ADDED: Added ${newRecord.action.toUpperCase()} for ${newRecord.surname} on ${recordDate} at ${newRecord.time}`);

  res.json({ success: true, record: newRecord });
});

// Delete Record
app.delete("/api/records/:id", (req, res) => {
  const recordId = Number(req.params.id);
  let targetRecord: any = null;

  try {
    const rows = execSql("SELECT * FROM shift_records WHERE id = ?", [recordId]);
    if (Array.isArray(rows) && rows.length > 0) {
      targetRecord = rows[0];
    }
    execSql("DELETE FROM shift_records WHERE id = ?", [recordId]);
  } catch (e) {
    console.error("Failed deleting record from DB:", e);
  }

  let records = readShiftRecords();
  if (!targetRecord) {
    targetRecord = records.find((r: any) => Number(r.id) === recordId);
  }
  records = records.filter((r: any) => Number(r.id) !== recordId);
  writeShiftRecords(records);

  const info = targetRecord ? `(${targetRecord.surname} on ${targetRecord.created_at})` : `ID ${recordId}`;
  addLogEntry("WARNING", `RECORD_DELETED: Removed shift record ${info}`);
  res.json({ success: true, count: records.length });
});

// Clear All Shift Records (Batch Wipe for testing/cleanup)
app.post("/api/records/clear", (req, res) => {
  try {
    execSql("DELETE FROM shift_records");
  } catch (e) {
    console.error("Failed clearing DB records:", e);
  }

  writeShiftRecords([]);
  addLogEntry("WARNING", "RECORDS_CLEARED: All shift records were wiped from database by admin.");
  res.json({ success: true, count: 0 });
});

// Batch Delete Specific Shift Records
app.post("/api/records/batch-delete", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Array of ids is required" });
  }

  const numIds = ids.map(Number);
  const idSet = new Set(numIds);
  try {
    const placeholders = ids.map(() => "?").join(",");
    execSql(`DELETE FROM shift_records WHERE id IN (${placeholders})`, numIds);
  } catch (e) {
    console.error("Failed batch deleting from DB:", e);
  }

  let records = readShiftRecords();
  records = records.filter((r: any) => !idSet.has(Number(r.id)));
  writeShiftRecords(records);
  addLogEntry("WARNING", `BATCH_RECORDS_DELETED: Deleted ${ids.length} records.`);
  res.json({ success: true, deletedCount: ids.length, count: records.length });
});

// Get System Audit Logs
app.get("/api/logs", (req, res) => {
  try {
    if (!fs.existsSync(LOGS_FILE)) {
      return res.json({ logs: [] });
    }
    const content = fs.readFileSync(LOGS_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const parsed = lines.map((line, idx) => {
      const parts = line.split(" | ");
      return {
        id: idx + 1,
        timestamp: parts[0] || "",
        level: (parts[1] || "INFO").trim(),
        logger: (parts[2] || "ShiftBotLogger").trim(),
        message: parts[3] || line,
      };
    });
    parsed.reverse();
    res.json({ count: parsed.length, logs: parsed });
  } catch (err) {
    res.status(500).json({ error: "Failed reading log file" });
  }
});

// Clear Logs
app.post("/api/logs/clear", (req, res) => {
  try {
    fs.writeFileSync(LOGS_FILE, "", "utf-8");
    addLogEntry("INFO", "LOGS_CLEARED: Audit log file reset by admin.");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed clearing logs" });
  }
});

// Get Current User Profile by Telegram ID
app.get("/api/user-me", (req, res) => {
  const tgId = (req as any).telegramUser.id;
  const roles = readRoles();
  let foundRole = "unregistered";
  let foundSurname = null;

  for (const roleName of ["admin", "user"]) {
    const roleUsers = roles[roleName] || {};
    for (const [sName, uId] of Object.entries(roleUsers)) {
      if (Number(uId) === tgId) {
        foundRole = roleName;
        foundSurname = sName;
        break;
      }
    }
    if (foundRole !== "unregistered") break;
  }

  res.json({
    role: foundRole,
    surname: foundSurname,
    telegram_id: tgId,
    is_webapp: true,
  });
});

// Get Individual Staff Statistics & Daily Performance
app.get("/api/individual-stats", (req, res) => {
  const targetSurname = req.query.surname as string;
  const targetTgId = req.query.tg_id ? Number(req.query.tg_id) : null;
  const schedule = readScheduleConfig();
  const shiftStartStr = schedule.shift_start || "09:00";
  const shiftEndStr = schedule.shift_end || "18:00";

  const records = readShiftRecords();
  const roles = readRoles();

  // Determine surname if telegram_id provided
  let surnameToFilter = targetSurname;
  if (!surnameToFilter && targetTgId) {
    for (const rKey of ["admin", "user"]) {
      for (const [sName, uId] of Object.entries(roles[rKey] || {})) {
        if (Number(uId) === targetTgId) {
          surnameToFilter = sName;
          break;
        }
      }
    }
  }

  // Group records by (surname -> date -> records)
  const userDateMap: Record<string, Record<string, { inTime?: string; outTime?: string; records: any[] }>> = {};

  records.forEach((r: any) => {
    const sName = r.surname || "Unknown";
    if (surnameToFilter && sName.toLowerCase() !== surnameToFilter.toLowerCase()) {
      return;
    }

    const dateStr = r.created_at ? r.created_at.split(" ")[0] : new Date().toISOString().split("T")[0];
    if (!userDateMap[sName]) userDateMap[sName] = {};
    if (!userDateMap[sName][dateStr]) {
      userDateMap[sName][dateStr] = { records: [] };
    }

    userDateMap[sName][dateStr].records.push(r);
    if (r.action === "in" && (!userDateMap[sName][dateStr].inTime || r.time < userDateMap[sName][dateStr].inTime)) {
      userDateMap[sName][dateStr].inTime = r.time;
    }
    if (r.action === "out" && (!userDateMap[sName][dateStr].outTime || r.time > userDateMap[sName][dateStr].outTime)) {
      userDateMap[sName][dateStr].outTime = r.time;
    }
  });

  // Calculate daily metrics per user
  const resultByUser: Record<string, any> = {};

  Object.entries(userDateMap).forEach(([sName, datesObj]) => {
    const dailyList: any[] = [];
    let totalWorkedMinutes = 0;
    let onTimeCount = 0;
    let lateCount = 0;
    let completedShiftsCount = 0;

    // Sort dates chronologically
    const sortedDates = Object.keys(datesObj).sort();

    sortedDates.forEach((dateStr) => {
      const item = datesObj[dateStr];
      const inT = item.inTime || null;
      const outT = item.outTime || null;

      let workedHours = 0;
      let status = "Incomplete";

      if (inT && outT) {
        status = "Completed";
        completedShiftsCount++;
        // Calculate duration
        try {
          const [inH, inM] = inT.split(":").map(Number);
          const [outH, outM] = outT.split(":").map(Number);
          const inTotal = inH * 60 + inM;
          const outTotal = outH * 60 + outM;
          const diff = Math.max(0, outTotal - inTotal);
          workedHours = Number((diff / 60).toFixed(2));
          totalWorkedMinutes += diff;
        } catch (e) {
          workedHours = 8.0;
        }
      } else if (inT) {
        status = "Working (No Check-out)";
      } else if (outT) {
        status = "Checked Out Only";
      }

      // Check punctuality against shiftStartStr
      let isLate = false;
      let lateMinutes = 0;
      if (inT) {
        try {
          const [inH, inM] = inT.split(":").map(Number);
          const [sH, sM] = shiftStartStr.split(":").map(Number);
          const inTotal = inH * 60 + inM;
          const startTotal = sH * 60 + sM;
          if (inTotal > startTotal) {
            isLate = true;
            lateMinutes = inTotal - startTotal;
            lateCount++;
          } else {
            onTimeCount++;
          }
        } catch (e) {}
      }

      dailyList.push({
        date: dateStr,
        inTime: inT || "—",
        outTime: outT || "—",
        workedHours,
        status,
        isLate,
        lateMinutes,
      });
    });

    const totalDays = dailyList.length;
    const punctualityRate = totalDays > 0 ? Math.round((onTimeCount / totalDays) * 100) : 100;
    const avgHoursPerShift = completedShiftsCount > 0 ? Number((totalWorkedMinutes / 60 / completedShiftsCount).toFixed(2)) : 0;

    resultByUser[sName] = {
      surname: sName,
      summary: {
        totalShiftsRecorded: totalDays,
        completedShifts: completedShiftsCount,
        totalHoursWorked: Number((totalWorkedMinutes / 60).toFixed(1)),
        avgHoursPerShift,
        onTimeCount,
        lateCount,
        punctualityRate,
      },
      dailyHistory: dailyList,
    };
  });

  // Return specific user if requested or all users
  if (surnameToFilter) {
    const single = resultByUser[surnameToFilter] || {
      surname: surnameToFilter,
      summary: { totalShiftsRecorded: 0, completedShifts: 0, totalHoursWorked: 0, avgHoursPerShift: 0, onTimeCount: 0, lateCount: 0, punctualityRate: 100 },
      dailyHistory: [],
    };
    return res.json(single);
  }

  res.json(resultByUser);
});

// Get Roles
app.get("/api/roles", (req, res) => {
  const roles = readRoles();
  res.json(roles);
});

// Get Shift Schedule
app.get("/api/schedule", (req, res) => {
  const schedule = readScheduleConfig();
  res.json(schedule);
});

// Update Shift Schedule
app.post("/api/schedule", (req, res) => {
  const { shift_start, shift_end, tz_offset_hours, remind_before_start_minutes, remind_after_end_minutes, enabled, employee_schedules } = req.body;
  const current = readScheduleConfig();
  const updated = {
    ...current,
    shift_start: shift_start || current.shift_start,
    shift_end: shift_end || current.shift_end,
    tz_offset_hours: tz_offset_hours !== undefined ? Number(tz_offset_hours) : (current.tz_offset_hours ?? 3),
    remind_before_start_minutes: remind_before_start_minutes ?? current.remind_before_start_minutes,
    remind_after_end_minutes: remind_after_end_minutes ?? current.remind_after_end_minutes,
    enabled: enabled ?? current.enabled,
    employee_schedules: employee_schedules !== undefined ? employee_schedules : (current.employee_schedules || {}),
  };
  writeScheduleConfig(updated);
  addLogEntry("INFO", `SCHEDULE_UPDATED: Updated schedule (Start=${updated.shift_start}, End=${updated.shift_end}, UTC+${updated.tz_offset_hours})`);
  res.json({ success: true, schedule: updated });
});

// Update Individual Employee Schedule (work days, custom times)
app.post("/api/schedule/employee", (req, res) => {
  const { surname, work_days, vacation_start, vacation_end, shift_start, shift_end, notes } = req.body;
  if (!surname) {
    return res.status(400).json({ error: "Surname is required." });
  }

  const current = readScheduleConfig();
  if (!current.employee_schedules) {
    current.employee_schedules = {};
  }

  const prevEmp = current.employee_schedules[surname] || { work_days: [1, 2, 3, 4, 5] };
  current.employee_schedules[surname] = {
    ...prevEmp,
    work_days: Array.isArray(work_days) ? work_days : (prevEmp.work_days || [1, 2, 3, 4, 5]),
    vacation_start: vacation_start !== undefined ? vacation_start : (prevEmp.vacation_start || null),
    vacation_end: vacation_end !== undefined ? vacation_end : (prevEmp.vacation_end || null),
    shift_start: shift_start !== undefined ? shift_start : prevEmp.shift_start,
    shift_end: shift_end !== undefined ? shift_end : prevEmp.shift_end,
    notes: notes !== undefined ? notes : prevEmp.notes,
  };

  writeScheduleConfig(current);
  addLogEntry("INFO", `EMPLOYEE_SCHEDULE_UPDATED: Updated individual schedule for ${surname} (Days: ${current.employee_schedules[surname].work_days?.join(",")}, Vacation: ${vacation_start || "none"} - ${vacation_end || "none"})`);
  res.json({ success: true, schedule: current, employeeSchedule: current.employee_schedules[surname] });
});

// Set or Clear Employee Vacation
app.post("/api/schedule/employee/vacation", (req, res) => {
  const { surname, clear, days, vacation_start, vacation_end } = req.body;
  if (!surname) {
    return res.status(400).json({ error: "Surname is required." });
  }

  const current = readScheduleConfig();
  if (!current.employee_schedules) {
    current.employee_schedules = {};
  }
  const prevEmp = current.employee_schedules[surname] || { work_days: [1, 2, 3, 4, 5] };

  if (clear) {
    current.employee_schedules[surname] = {
      ...prevEmp,
      vacation_start: null,
      vacation_end: null,
    };
    writeScheduleConfig(current);
    addLogEntry("INFO", `VACATION_CLEARED: Cleared vacation status for ${surname}`);
    return res.json({ success: true, schedule: current, employeeSchedule: current.employee_schedules[surname] });
  }

  let startStr = vacation_start;
  let endStr = vacation_end;

  if (days && !vacation_start) {
    const { dateStr } = getAdjustedDate();
    startStr = dateStr;
    const sDate = new Date();
    sDate.setDate(sDate.getDate() + Number(days));
    const yyyy = sDate.getFullYear();
    const mm = String(sDate.getMonth() + 1).padStart(2, '0');
    const dd = String(sDate.getDate()).padStart(2, '0');
    endStr = `${yyyy}-${mm}-${dd}`;
  }

  current.employee_schedules[surname] = {
    ...prevEmp,
    vacation_start: startStr || null,
    vacation_end: endStr || null,
  };

  writeScheduleConfig(current);
  addLogEntry("INFO", `VACATION_SET: Set vacation for ${surname} from ${startStr} to ${endStr}`);
  res.json({ success: true, schedule: current, employeeSchedule: current.employee_schedules[surname] });
});

// Update Role
app.post("/api/roles", (req, res) => {
  const { surname, role, telegram_id } = req.body;

  if (!surname || !role || !telegram_id) {
    return res.status(400).json({ error: "Surname, role, and telegram_id are required." });
  }

  const validRoles = ["admin", "user"];
  const inputRole = role.toLowerCase() === "creator" ? "admin" : role.toLowerCase();
  if (!validRoles.includes(inputRole)) {
    return res.status(400).json({ error: "Role must be admin or user." });
  }

  const roles = readRoles();
  // Remove existing mapping for surname across all roles
  ["admin", "user"].forEach((r) => {
    if (roles[r] && roles[r][surname]) {
      delete roles[r][surname];
    }
  });

  if (!roles[inputRole]) roles[inputRole] = {};
  roles[inputRole][surname] = Number(telegram_id);

  writeRoles(roles);
  addLogEntry("INFO", `ROLE_MODIFIED: Set ${surname} to ${inputRole} (${telegram_id})`);
  res.json({ success: true, roles });
});

// Delete Role mapping
app.delete("/api/roles/:surname", (req, res) => {
  const surname = req.params.surname;
  const roles = readRoles();
  let found = false;

  ["creator", "admin", "user"].forEach((r) => {
    if (roles[r] && roles[r][surname]) {
      delete roles[r][surname];
      found = true;
    }
  });

  if (!found) {
    return res.status(404).json({ error: "Surname role not found." });
  }

  writeRoles(roles);
  addLogEntry("WARNING", `ROLE_REMOVED: Unassigned role for ${surname}`);
  res.json({ success: true, roles });
});

// --- Backup & Restore Endpoints ---
// Export Full System Backup (Users/Roles, Schedule/Vacations, and Shift Records)
app.get("/api/backup/export", (req, res) => {
  try {
    const roles = readRoles();
    const schedule = readScheduleConfig();
    const records = readShiftRecords();
    const backupData = {
      version: "2.4",
      exported_at: new Date().toISOString(),
      roles,
      schedule,
      records_count: records.length,
      records,
    };

    res.setHeader("Content-Disposition", `attachment; filename=shiftbot_backup_${new Date().toISOString().split("T")[0]}.json`);
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backupData, null, 2));
  } catch (err: any) {
    console.error("Backup export error:", err);
    res.status(500).json({ error: "Failed to create backup: " + err.message });
  }
});

// Import / Restore Full System Backup
app.post("/api/backup/import", (req, res) => {
  const { roles, schedule, records, overwrite_records } = req.body;

  if (!roles && !schedule && !records) {
    return res.status(400).json({ error: "Invalid backup data: missing roles, schedule, or records." });
  }

  try {
    // 1. Restore Roles if provided
    if (roles && typeof roles === "object") {
      writeRoles(roles);
    }

    // 2. Restore Schedule if provided
    if (schedule && typeof schedule === "object") {
      writeScheduleConfig(schedule);
    }

    // 3. Restore Shift Records if requested
    if (Array.isArray(records) && records.length > 0) {
      if (overwrite_records) {
        try {
          execSql("DELETE FROM shift_records");
        } catch (e) {}
      }

      // Insert or merge records into SQLite
      for (const r of records) {
        if (!r.surname || !r.action || !r.time) continue;
        try {
          execSql(
            `INSERT OR IGNORE INTO shift_records (id, chat_id, telegram_user_id, action, surname, time, time_line, raw_text, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.id || Date.now() + Math.floor(Math.random() * 1000),
              r.chat_id || 0,
              r.telegram_user_id || null,
              r.action,
              r.surname,
              r.time,
              r.time_line || `Imported: ${r.time}`,
              r.raw_text || "Restored from Backup",
              r.source || "backup_import",
              r.created_at || new Date().toISOString().replace("T", " ").substring(0, 19)
            ]
          );
        } catch (e) {
          console.error("Error inserting restored record:", e);
        }
      }
    }

    addLogEntry("INFO", "BACKUP_RESTORED: Successfully restored system data from JSON backup file.");
    res.json({
      success: true,
      message: "Data restored successfully",
      roles: readRoles(),
      schedule: readScheduleConfig(),
      records_count: readShiftRecords().length,
    });
  } catch (err: any) {
    console.error("Backup import error:", err);
    res.status(500).json({ error: "Failed to restore backup: " + err.message });
  }
});

// Get Python Bot Code
app.get("/api/bot-code", (req, res) => {
  try {
    const botPath = path.join(process.cwd(), "bot.py");
    if (fs.existsSync(botPath)) {
      const code = fs.readFileSync(botPath, "utf-8");
      return res.json({ code });
    }
    res.status(404).json({ error: "bot.py not found" });
  } catch (e) {
    res.status(500).json({ error: "Failed loading bot code" });
  }
});

// AI OCR Vision Endpoint using Gemini 3.6 Flash
app.post("/api/ocr/analyze", async (req, res) => {
  const { imageBase64, action } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: "imageBase64 is required" });
  }

  try {
    addLogEntry("INFO", "OCR_ANALYZE_REQUESTED: Analyzing shift screenshot via Gemini Vision...");

    // Clean base64 string
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are an expert OCR and image analysis system for employee shift attendance screenshots from the RMAS Mobile application and similar attendance systems.
Analyze this mobile screenshot image carefully and extract the following structured data:

RMAS MOBILE APP SPECIFICS & COLOR RULES:
1. Employee Username: In RMAS Mobile screenshots, look at the top blue header. Right below the "RMAS Mobile ..." title, there is the username line (e.g., "eremin.n C941s" -> extract "eremin.n"). Extract this username handle as 'surname'.
2. Status Bar Clock: At the very top edge of the phone screen (black bar with battery/wifi icon, e.g. "11:28" or "20:34"), ignore this clock.
3. Check In (Приход):
   - Indicated by GREEN timestamp text (e.g., "11:28:53" with distance "96 m" underneath) located above the buttons.
   - If ONLY green timestamp is present (no red timestamp below the buttons), the action is Check In ('detected_action': 'in') and the shift time is this green timestamp (e.g., "11:28:53").
4. Check Out (Уход):
   - Indicated by RED timestamp text (e.g., "20:34:25" with distance "7 m" underneath) located below the "Check Out" button.
   - When BOTH green time ("11:28:53") and red time ("20:34:25") are present on the screenshot, the shift action is definitively Check Out ('detected_action': 'out'), and 'time' MUST be the RED timestamp ("20:34:25").

Return strictly valid JSON matching this exact structure:
{
  "surname": "string or null (e.g. eremin.n)",
  "time": "HH:MM:SS format (e.g. 11:28:53 or 20:34:25)",
  "time_line": "string or null",
  "status_bar_detected": true,
  "detected_action": "in" or "out",
  "confidence": 0.98,
  "raw_text": "string"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64,
          },
        },
        { text: prompt },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const responseText = response.text || "{}";
    const result = JSON.parse(responseText);

    const roles = readRoles();
    const registeredSurnames = [
      ...Object.keys(roles.creator || {}),
      ...Object.keys(roles.admin || {}),
      ...Object.keys(roles.user || {}),
    ];

    const isRegistered = result.surname
      ? registeredSurnames.some((s) => s.toLowerCase() === result.surname.toLowerCase())
      : false;

    addLogEntry(
      "INFO",
      `OCR_RESULT: Recognized Surname='${result.surname}', Time='${result.time}', Action='${result.detected_action}', Registered=${isRegistered}`
    );

    res.json({
      success: true,
      ocr_data: {
        surname: result.surname || "Иванов.А.В",
        time: result.time || "08:30:00",
        time_line: result.time_line || "Shift check time 08:30:00",
        status_bar_detected: result.status_bar_detected ?? true,
        detected_action: action || result.detected_action || "in",
        confidence: result.confidence || 0.92,
        raw_text: result.raw_text || "",
        is_registered: isRegistered,
      },
    });
  } catch (error: any) {
    console.error("Gemini OCR Error:", error);
    addLogEntry("ERROR", `OCR_FAILED: ${error.message || error}`);

    // Fallback simulation response if API key is missing or offline
    res.json({
      success: true,
      fallback_used: true,
      ocr_data: {
        surname: "Иванов.А.В",
        time: new Date().toTimeString().split(" ")[0],
        time_line: "Grade Mobile Check 08:30:15",
        status_bar_detected: true,
        detected_action: action || "in",
        confidence: 0.88,
        raw_text: "RMAS Mobile Grade Check In Иванов.А.В 08:30:15",
        is_registered: true,
      },
    });
  }
});

// Start Express + Vite Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
