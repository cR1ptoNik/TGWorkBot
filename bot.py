import json
import os
import re
import shutil
import sqlite3
import tempfile
import logging
import asyncio
from datetime import datetime, timezone, timedelta
# Configure structured logging for system events and database tracking
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[
        logging.FileHandler("bot_activity.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("ShiftBotLogger")

try:
    from PIL import Image, ImageFilter, ImageEnhance, ImageOps
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    Image = None
    logger.warning("Pillow package not found. Install via: pip install Pillow")


# Load environment variables from .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Configure structured logging for system events and database tracking
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[
        logging.FileHandler("bot_activity.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("ShiftBotLogger")

try:
    import pytesseract  # type: ignore
    PYTESSERACT_AVAILABLE = True
except ImportError:
    PYTESSERACT_AVAILABLE = False
    logger.warning("pytesseract package not found. Image OCR will rely on external/fallback parser.")

try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
    from telegram.ext import (
        ApplicationBuilder,
        CommandHandler,
        ContextTypes,
        CallbackQueryHandler,
        MessageHandler,
        filters,
    )
except ImportError:
    logger.error("python-telegram-bot is required. Install via: pip install python-telegram-bot")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "YOUR_TELEGRAM_BOT_TOKEN_HERE")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://your-domain.com")
DEBUG_OCR = os.environ.get("DEBUG_OCR", "False").lower() in ("true", "1", "yes")

if "ais-dev" in WEBAPP_URL or "your-public-tunnel" in WEBAPP_URL:
    logger.warning(f"WEBAPP_URL set to fallback/dev URL: '{WEBAPP_URL}'. Set WEBAPP_URL in .env to your Cloudflare Tunnel URL so Telegram WebApp opens directly on VPS!")
else:
    logger.info(f"Telegram WebApp URL initialized as: '{WEBAPP_URL}'")
DATA_FILE = "shift_attendance.json"
ROLES_FILE = "bot_roles.json"
SCHEDULE_FILE = "schedule_config.json"
DB_FILE = "shift_attendance.db"
TIMEZONE_OFFSET_HOURS = int(os.environ.get("TZ_OFFSET", "3"))  # Default MSK (UTC+3)

TIME_PATTERN = r"\b\d{1,2}[:.]\d{2}(?::\d{2})?\b"
ROLE_KEYS = ("admin", "user")
SURNAME_LOGIN_PATTERN = re.compile(r"\b([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9\-]{2,}\.\w+)\b")
SURNAME_WORD_PATTERN = re.compile(r"\b([A-Za-zА-Яа-яЁё]{3,})\b")
SKIP_WORDS = {"RMAS", "Mobile", "Grade", "IM", "Check", "In", "Out", "Close", "SDI", "M", "Video", "Приход", "Уход"}


# --- Schedule Configuration Helpers ---

def load_schedule_config() -> dict:
    default_config = {
        "shift_start": "09:00",
        "shift_end": "18:00",
        "tz_offset_hours": TIMEZONE_OFFSET_HOURS,
        "remind_before_start_minutes": 5,
        "remind_after_end_minutes": 5,
        "enabled": True
    }
    if not os.path.exists(SCHEDULE_FILE):
        atomic_save_file(SCHEDULE_FILE, default_config)
        return default_config
    try:
        with open(SCHEDULE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            default_config.update(data)
            return default_config
    except Exception as e:
        logger.error(f"Failed loading schedule config: {e}")
        return default_config

def save_schedule_config(data: dict):
    atomic_save_file(SCHEDULE_FILE, data)
    log_audit_event("INFO", "SCHEDULE_UPDATED", f"Updated shift schedule to Start={data.get('shift_start')}, End={data.get('shift_end')}")


# --- Database & Persistence Logging Layer ---

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    logger.info("Initializing SQLite database tables...")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Table for shift records
        cursor.execute("""
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
        """)
        # Table for structured system logs & audit trail
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                level TEXT NOT NULL,
                user_id INTEGER,
                event_type TEXT NOT NULL,
                message TEXT NOT NULL,
                details TEXT
            )
        """)
        # Table for tracking sent automatic reminders
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sent_reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                reminder_type TEXT NOT NULL,
                telegram_user_id INTEGER NOT NULL,
                sent_at TEXT NOT NULL,
                UNIQUE(date, reminder_type, telegram_user_id)
            )
        """)
        conn.commit()
    logger.info("Database initialized successfully.")

def log_audit_event(level: str, event_type: str, message: str, user_id: int | None = None, details: str | None = None):
    now_str = get_current_time().isoformat(sep=" ", timespec="seconds")
    if level == "ERROR":
        logger.error(f"[{event_type}] {message} | User: {user_id}")
    elif level == "WARNING":
        logger.warning(f"[{event_type}] {message} | User: {user_id}")
    else:
        logger.info(f"[{event_type}] {message} | User: {user_id}")
        
    try:
        with get_db_connection() as conn:
            conn.cursor().execute(
                "INSERT INTO system_audit_logs (timestamp, level, user_id, event_type, message, details) VALUES (?, ?, ?, ?, ?, ?)",
                (now_str, level, user_id, event_type, message, details)
            )
            conn.commit()
    except Exception as e:
        logger.error(f"Failed to insert log event into SQLite: {e}")

def save_shift_record_to_db(record: dict):
    try:
        with get_db_connection() as conn:
            conn.cursor().execute(
                """INSERT INTO shift_records 
                   (chat_id, telegram_user_id, action, surname, time, time_line, raw_text, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    record.get("chat_id"),
                    record.get("telegram_user_id"),
                    record.get("action"),
                    record.get("surname"),
                    record.get("time"),
                    record.get("time_line"),
                    record.get("raw_text"),
                    record.get("source", "telegram_ocr"),
                    record.get("created_at")
                )
            )
            conn.commit()
        action_label = str(record.get('action') or 'in').upper()
        surname_label = str(record.get('surname') or 'Unknown')
        time_label = str(record.get('time') or '')
        uid = record.get("telegram_user_id")
        log_audit_event("INFO", "DB_RECORD_SAVED", f"Recorded {action_label} for {surname_label} at {time_label}", user_id=uid if isinstance(uid, int) else None)
        
        sync_db_to_json()
        return True
    except Exception as e:
        uid = record.get("telegram_user_id")
        log_audit_event("ERROR", "DB_RECORD_SAVE_FAILED", f"Error saving shift record: {e}", user_id=uid if isinstance(uid, int) else None)
        return False

def sync_db_to_json():
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM shift_records ORDER BY id ASC")
            rows = cursor.fetchall()
            records = [dict(r) for r in rows]
            
        atomic_save_file(DATA_FILE, {"records": records, "updated_at": get_current_time().isoformat()})
    except Exception as e:
        logger.error(f"Sync to JSON failed: {e}")

def atomic_save_file(file_path: str, data: dict):
    dir_name = os.path.dirname(os.path.abspath(file_path))
    with tempfile.NamedTemporaryFile("w", dir=dir_name, delete=False, encoding="utf-8") as tf:
        json.dump(data, tf, ensure_ascii=False, indent=2)
        temp_name = tf.name
    os.replace(temp_name, file_path)


# --- Helper Timezone Functions ---

def get_current_time() -> datetime:
    tz = timezone(timedelta(hours=TIMEZONE_OFFSET_HOURS))
    return datetime.now(tz)


# --- OCR & Text Parsing Logic ---

def find_tesseract_cmd():
    if not PYTESSERACT_AVAILABLE:
        return None
    env = os.environ.get("TESSERACT_CMD")
    if env and os.path.exists(env):
        return env
    w = shutil.which("tesseract")
    if w:
        return w
    for p in (r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe", "/usr/bin/tesseract"):
        if os.path.exists(p):
            return p
    return None

TESSERACT_CMD = find_tesseract_cmd()
if TESSERACT_CMD and PYTESSERACT_AVAILABLE:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD


def load_roles():
    if not os.path.exists(ROLES_FILE):
        return {"admin": {}, "user": {}}
    try:
        with open(ROLES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        result = {"admin": {}, "user": {}}
        # Convert legacy creator role to admin if present
        legacy_creator = data.get("creator", {})
        if isinstance(legacy_creator, dict):
            for k, v in legacy_creator.items():
                if str(v).isdigit():
                    result["admin"][str(k)] = int(v)

        for key in ("admin", "user"):
            raw = data.get(key, {})
            if isinstance(raw, dict):
                for k, v in raw.items():
                    if str(v).isdigit():
                        result[key][str(k)] = int(v)
        return result
    except Exception as e:
        logger.error(f"Failed to load roles from file: {e}")
        return {"admin": {}, "user": {}}

def save_roles(data):
    atomic_save_file(ROLES_FILE, data)
    log_audit_event("INFO", "ROLES_UPDATED", "Bot user roles were updated.")

def get_role(user_id: int | None):
    if user_id is None:
        return "none"
    roles = load_roles()
    for role_name in ("admin", "user"):
        for surname, role_user_id in roles.get(role_name, {}).items():
            if role_user_id == user_id:
                return role_name
    return "none"

def has_admin_access(user_id: int | None):
    role = get_role(user_id)
    return role == "admin"

def get_registered_users_map():
    """Returns mapping of surname -> {user_id, role} for all registered staff"""
    roles = load_roles()
    result = {}
    for role_name in ("admin", "user"):
        for surname, uid in roles.get(role_name, {}).items():
            result[surname] = {"telegram_user_id": uid, "role": role_name}
    return result

def get_registered_user_ids():
    roles = load_roles()
    ids = set()
    for role_name in ("admin", "user"):
        ids.update(int(v) for v in roles.get(role_name, {}).values())
    return ids


def preprocess_image(image: Image.Image) -> Image.Image:
    try:
        img = image.convert("RGB")
        w, h = img.size
        if max(w, h) < 1500:
            resample_filter = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', 1)
            img = img.resize((w * 2, h * 2), resample_filter)
        gray = img.convert("L")
        gray = gray.filter(ImageFilter.MedianFilter(size=3))
        gray = ImageEnhance.Contrast(gray).enhance(1.4)
        return gray
    except Exception as e:
        logger.error(f"Image preprocessing warning: {e}")
        return image

def get_time_color(img_rgb: Image.Image, left: int, top: int, width: int, height: int) -> str:
    try:
        # Expand box slightly to catch nearby icons or colored text borders
        expand = int(height * 0.5)
        l = max(0, left - expand)
        t = max(0, top - expand)
        r = min(img_rgb.width, left + width + expand)
        b = min(img_rgb.height, top + height + expand)
        
        box = img_rgb.crop((l, t, r, b))
        hsv_box = box.convert("HSV")
        
        # In HSV (PIL): H (0-255), S (0-255), V (0-255)
        # Green hue: ~85 (range 40-110)
        # Red hue: ~0 or ~255 (range 0-20 or 230-255)
        green_pixels = 0
        red_pixels = 0
        total_colored = 0
        
        for pixel in hsv_box.getdata():
            h, s, v = pixel
            if s > 40 and v > 40:  # Not white, black, or gray
                total_colored += 1
                if 40 <= h <= 110:
                    green_pixels += 1
                elif h <= 20 or h >= 230:
                    red_pixels += 1
                    
        if total_colored > 0:
            if green_pixels > red_pixels and green_pixels > total_colored * 0.2:
                return "green"
            if red_pixels > green_pixels and red_pixels > total_colored * 0.2:
                return "red"
        return "unknown"
    except Exception as e:
        logger.error(f"Color extraction error: {e}")
        return "unknown"



def run_tesseract(image: Image.Image) -> str:
    if not TESSERACT_CMD or not PYTESSERACT_AVAILABLE:
        return ""
    try:
        proc = preprocess_image(image)
        cfg = r'--oem 3 --psm 6'
        text = pytesseract.image_to_string(proc, lang='eng+rus', config=cfg)
        if DEBUG_OCR:
            logger.debug(f"[OCR Raw Output]\n{text}")
        return text
    except Exception as e:
        logger.error(f"Tesseract OCR execution error: {e}")
        return ""


def extract_time_lines(raw_text: str, ocr_data: dict = None, img_rgb: Image.Image = None):
    results = []
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
    
    # Pre-calculate colors for words from ocr_data
    word_colors = []
    if ocr_data and img_rgb:
        for i in range(len(ocr_data.get('text', []))):
            text = ocr_data['text'][i]
            if not text.strip():
                continue
            if re.search(TIME_PATTERN, text):
                color = get_time_color(
                    img_rgb, 
                    ocr_data['left'][i], 
                    ocr_data['top'][i], 
                    ocr_data['width'][i], 
                    ocr_data['height'][i]
                )
                word_colors.append({"text": text, "color": color})

    for idx, l in enumerate(lines):
        matches = re.findall(TIME_PATTERN, l)
        for m in matches:
            norm = m.replace(".", ":")
            parts = norm.split(":")
            if len(parts) == 2:
                norm = f"{int(parts[0]):02d}:{int(parts[1]):02d}:00"
            elif len(parts) == 3:
                norm = f"{int(parts[0]):02d}:{int(parts[1]):02d}:{int(parts[2]):02d}"
                
            # Try to match with word_colors
            color = "unknown"
            for wc in word_colors:
                if m in wc["text"] or wc["text"] in m:
                    color = wc["color"]
                    break
                    
            results.append({"time": norm, "line": l, "line_index": idx, "color": color})
    return results


def looks_like_status_bar(line: str) -> bool:
    low = line.lower()
    return any(k in low for k in ("battery", "wifi", "lte", "5g", "4g", "%", "volte"))


def choose_time_line(time_lines: list, action: str):
    if not time_lines:
        now_str = get_current_time().strftime("%H:%M:%S")
        return now_str, f"Fallback Time: {now_str}"

    def parse_to_seconds(ts: str, line: str):
        if looks_like_status_bar(line):
            return None
        m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", ts)
        if not m:
            return None
        try:
            h = int(m.group(1))
            minute = int(m.group(2))
            sec = int(m.group(3)) if m.group(3) else 0
            return h * 3600 + minute * 60 + sec
        except Exception:
            return None

    filtered = [it for it in time_lines if not looks_like_status_bar(it["line"])]
    candidates = filtered if filtered else time_lines
    
    parsed = []
    for it in candidates:
        total = parse_to_seconds(it["time"], it.get("line", ""))
        if total is None:
            continue
        parsed.append((total, it))
        
    if parsed:
        # Prefer full HH:MM:SS timestamps over HH:MM if available
        full_sec = [p for p in parsed if len(p[1]["time"].split(":")) == 3]
        target = full_sec if full_sec else parsed
        
        # Color based selection
        expected_color = "green" if action == "in" else "red"
        color_matches = [p for p in target if p[1].get("color") == expected_color]
        
        if color_matches:
            target = color_matches
            
        if action == "in":
            # For Check In (Приход), prefer topmost/earliest if multiple match
            sel = min(target, key=lambda x: (x[1].get("line_index", 0), x[0]))
        else:
            # For Check Out (Уход), prefer bottommost/latest if multiple match
            sel = max(target, key=lambda x: (x[1].get("line_index", 0), x[0]))
            
        total = sel[0]
        h = total // 3600
        mm = (total % 3600) // 60
        ss = total % 60
        return f"{h:02}:{mm:02}:{ss:02}", sel[1]["line"]
        
    sel = time_lines[-1]
    return sel["time"], sel["line"]


def extract_surname_from_text(text: str, user_id: int | None = None):
    # 1. Search text for any registered surname/login first
    roles = load_roles()
    for role_name in ("admin", "user"):
        for reg_s in roles.get(role_name, {}).keys():
            clean_s = reg_s.split('.')[0]
            if len(clean_s) >= 3 and clean_s.lower() in text.lower():
                return reg_s

    # 2. Match RMAS Mobile header login pattern (e.g. "ivanov.a C941s" or "petrov.s C941s")
    rmas_match = re.search(r"RMAS\s+Mobile[^\n]*\n\s*([a-zA-Z0-9_\.\-]+)", text, re.IGNORECASE)
    if rmas_match:
        found_login = rmas_match.group(1).strip()
        if len(found_login) >= 3 and found_login.lower() not in {"mobile", "check", "grade", "in", "out"}:
            return found_login

    # 3. Match login pattern like surname.i or username handle
    m = SURNAME_LOGIN_PATTERN.search(text)
    if m:
        return m.group(1)

    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for line in lines[:8]:
        candidates = [w for w in SURNAME_WORD_PATTERN.findall(line) if w not in SKIP_WORDS and not w.isupper()]
        if candidates:
            return candidates[0]

    # 4. Fallback to sender's registered surname ONLY if no username was found in screenshot text
    if user_id:
        reg_s = get_surname_for_user(user_id)
        if reg_s:
            return reg_s

    return None


def parse_text(time_lines: list, full_text: str, action: str, user_id: int | None = None) -> dict:
    t, tl = choose_time_line(time_lines, action)
    return {
        "time": t,
        "time_line": tl,
        "surname": extract_surname_from_text(full_text, user_id),
        "time_lines": time_lines,
        "raw_text": full_text.strip()
    }


# --- Telegram Bot Handler Logic ---

async def reply_text(update: Update, text: str, reply_markup=None):
    if update.callback_query is not None and update.callback_query.message is not None:
        await update.callback_query.edit_message_text(text, reply_markup=reply_markup)
    elif update.message is not None:
        await update.message.reply_text(text, reply_markup=reply_markup)


async def send_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_user:
        return
    uid = update.effective_user.id
    if uid not in get_registered_user_ids():
        log_audit_event("WARNING", "UNREGISTERED_ACCESS", f"Unregistered user {uid} pressed start / main menu", user_id=uid)
        await reply_text(update, "Вы не зарегистрированы")
        return

    webapp_user_url = f"{WEBAPP_URL}?tg_id={uid}" if uid else WEBAPP_URL

    buttons = [
        [InlineKeyboardButton("📱 Открыть WebApp (Графики и Статистика)", web_app=WebAppInfo(url=webapp_user_url))],
        [InlineKeyboardButton("⚙️ Админка", callback_data="admin_open")],
    ]
    await reply_text(
        update,
        "📸 **Отправьте скриншот рабочего приложения** для автоматической отметки смены.\n\n"
        "🟢 Зеленое время на скриншоте = **Приход**\n"
        "🔴 Красное время на скриншоте = **Уход**",
        reply_markup=InlineKeyboardMarkup(buttons)
    )


async def send_admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_user:
        return
    uid = update.effective_user.id
    if uid not in get_registered_user_ids():
        await reply_text(update, "Вы не зарегистрированы")
        return
    if not has_admin_access(uid):
        await reply_text(update, "❌ У вас нет доступа к панели администратора.")
        return

    webapp_admin_url = f"{WEBAPP_URL}?tg_id={uid}"

    buttons = [
        [InlineKeyboardButton("📱 Открыть WebApp Админку", web_app=WebAppInfo(url=webapp_admin_url))],
        [InlineKeyboardButton("📋 Кто сделал отметку сегодня", callback_data="admin_today")],
        [InlineKeyboardButton("⚠️ Кто НЕ сделал отметку сегодня", callback_data="admin_missing")],
        [InlineKeyboardButton("👥 Список сотрудников", callback_data="admin_users")],
        [InlineKeyboardButton("⏰ Настройки смены и напоминаний", callback_data="schedule_info")],
        [InlineKeyboardButton("➕ Назначить / Изменить роль", callback_data="manage_roles")],
        [InlineKeyboardButton("⬅️ Главное меню", callback_data="back_to_main")],
    ]
    await reply_text(update, "⚙️ Панель администратора:", reply_markup=InlineKeyboardMarkup(buttons))


async def show_today_marked(update: Update, context: ContextTypes.DEFAULT_TYPE):
    today = get_current_time().date().isoformat()
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT surname, action, time FROM shift_records WHERE created_at LIKE ? ORDER BY created_at ASC", (f"{today}%",))
            records = cursor.fetchall()
    except Exception as e:
        logger.error(f"Error fetching today records: {e}")
        records = []

    if not records:
        text = f"📅 Сегодня ({today}) ещё никто не сделал отметку."
    else:
        grouped = {}
        for rec in records:
            surname = rec["surname"] or "неизвестно"
            grouped.setdefault(surname, {"in": None, "out": None})
            if rec["action"] == "in":
                grouped[surname]["in"] = rec["time"] or "—"
            else:
                grouped[surname]["out"] = rec["time"] or "—"

        rows = []
        for surname, times in grouped.items():
            in_time = times.get("in") or "—"
            out_time = times.get("out") or "—"
            rows.append(f"• {surname} | 🟢 Приход: {in_time} | 🔴 Уход: {out_time}")
        text = f"📊 Отметки сотрудников за {today}:\n\n" + "\n".join(rows)

    buttons = [[InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]]
    await reply_text(update, text, reply_markup=InlineKeyboardMarkup(buttons))


async def show_missing_marked(update: Update, context: ContextTypes.DEFAULT_TYPE):
    today = get_current_time().date().isoformat()
    users_map = get_registered_users_map()
    if not users_map:
        await reply_text(update, "⚠️ Нет зарегистрированных сотрудников.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]]))
        return

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT surname, action FROM shift_records WHERE created_at LIKE ?", (f"{today}%",))
            records = cursor.fetchall()
    except Exception as e:
        logger.error(f"Error fetching missing records: {e}")
        records = []

    checked_in = set()
    checked_out = set()
    for rec in records:
        s = rec["surname"]
        if rec["action"] == "in":
            checked_in.add(s)
        elif rec["action"] == "out":
            checked_out.add(s)

    missing_in = [s for s in users_map if s not in checked_in]
    missing_out = [s for s in users_map if s not in checked_out]

    msg = f"⚠️ Статус отметок на {today}:\n\n"
    msg += "🟢 НЕ отметили приход:\n"
    if missing_in:
        msg += "\n".join([f"• {s}" for s in missing_in]) + "\n\n"
    else:
        msg += "✅ Все сотрудники отметили приход!\n\n"

    msg += "🔴 НЕ отметили уход:\n"
    if missing_out:
        msg += "\n".join([f"• {s}" for s in missing_out])
    else:
        msg += "✅ Все сотрудники отметили уход!"

    buttons = [[InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]]
    await reply_text(update, msg, reply_markup=InlineKeyboardMarkup(buttons))


async def show_users_list(update: Update, context: ContextTypes.DEFAULT_TYPE):
    roles = load_roles()
    admins = roles.get("admin", {})
    users = roles.get("user", {})

    msg = "👥 Список зарегистрированных сотрудников:\n\n"
    msg += "⭐ Администраторы:\n"
    if admins:
        for surname, uid in admins.items():
            msg += f"• {surname} (ID: {uid})\n"
    else:
        msg += "• Нет\n"

    msg += "\n👤 Сотрудники:\n"
    if users:
        for surname, uid in users.items():
            msg += f"• {surname} (ID: {uid})\n"
    else:
        msg += "• Нет\n"

    buttons = [[InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]]
    await reply_text(update, msg, reply_markup=InlineKeyboardMarkup(buttons))


async def show_schedule_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = load_schedule_config()
    msg = (
        "⏰ Настройки смены и напоминаний:\n\n"
        f"• Начало смены: {cfg.get('shift_start')}\n"
        f"• Окончание смены: {cfg.get('shift_end')}\n"
        f"• Напоминание до прихода: за {cfg.get('remind_before_start_minutes')} минут\n"
        f"• Напоминание после ухода: через {cfg.get('remind_after_end_minutes')} минут\n"
        f"• Авто-уведомления: {'🟢 Включены' if cfg.get('enabled') else '🔴 Выключены'}\n\n"
        "Для изменения расписания нажмите кнопку ниже."
    )
    buttons = [
        [InlineKeyboardButton("✏️ Изменить время смены", callback_data="edit_shift_time")],
        [InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]
    ]
    await reply_text(update, msg, reply_markup=InlineKeyboardMarkup(buttons))


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not q or not q.from_user:
        return
    user_id = q.from_user.id
    if user_id not in get_registered_user_ids():
        await q.answer("Вы не зарегистрированы", show_alert=True)
        if q.message:
            await q.edit_message_text("Вы не зарегистрированы")
        return

    await q.answer()
    chat_data = context.chat_data if context.chat_data is not None else {}

    if q.data in {"action_in", "action_out"}:
        chat_data["pending_action"] = "in" if q.data == "action_in" else "out"
        if q.message:
            await q.edit_message_text(
                f"Вы выбрали: {'🟢 Приход' if q.data == 'action_in' else '🔴 Уход'}.\n\n"
                f"Пожалуйста, отправьте скриншот рабочего приложения.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад в главное меню", callback_data="back_to_main")]])
            )
        return
    if q.data == "admin_open":
        if has_admin_access(user_id):
            await send_admin_menu(update, context)
        elif q.message:
            await q.edit_message_text("❌ У вас нет доступа к админке.")
        return
    if q.data == "admin_today":
        await show_today_marked(update, context)
        return
    if q.data == "admin_missing":
        await show_missing_marked(update, context)
        return
    if q.data == "admin_users":
        await show_users_list(update, context)
        return
    if q.data == "schedule_info":
        await show_schedule_info(update, context)
        return
    if q.data == "edit_shift_time":
        if has_admin_access(user_id):
            if q.message:
                await q.edit_message_text(
                    "Отправьте время смены в формате:\n<старт> <финиш>\n"
                    "Пример: 09:00 18:00",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]])
                )
            chat_data["awaiting_shift_time"] = True
        elif q.message:
            await q.edit_message_text("❌ Нет прав для изменения расписания.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="back_to_main")]]))
        return
    if q.data == "back_to_main":
        await send_main_menu(update, context)
        return
    if q.data == "back_to_admin":
        if has_admin_access(user_id):
            await send_admin_menu(update, context)
        elif q.message:
            await q.edit_message_text("❌ У вас нет доступа к админке.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="back_to_main")]]))
        return
    if q.data == "manage_roles":
        if has_admin_access(user_id):
            if q.message:
                await q.edit_message_text(
                    "Отправьте сообщение с данными формата:\n<фамилия> <роль> <telegram_id>\nРоли: admin, user\nПример: Иванов admin 123456789",
                    reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад в админку", callback_data="back_to_admin")]])
                )
            chat_data["awaiting_role_command"] = True
        elif q.message:
            await q.edit_message_text("❌ Только администраторы могут управлять ролями.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Назад", callback_data="back_to_main")]]))
        return


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text or not update.effective_user:
        return
    user_id = update.effective_user.id
    if user_id not in get_registered_user_ids():
        await update.message.reply_text("Вы не зарегистрированы")
        return

    text = update.message.text.strip()
    chat_data = context.chat_data if context.chat_data is not None else {}

    # Handle Shift Schedule Edit Command
    if chat_data.get("awaiting_shift_time"):
        if not has_admin_access(update.effective_user.id):
            await update.message.reply_text("❌ Только администраторы могут менять время смены.")
            chat_data.pop("awaiting_shift_time", None)
            return
        parts = text.split()
        if len(parts) == 2 and re.match(r"^\d{1,2}:\d{2}$", parts[0]) and re.match(r"^\d{1,2}:\d{2}$", parts[1]):
            cfg = load_schedule_config()
            cfg["shift_start"] = parts[0]
            cfg["shift_end"] = parts[1]
            save_schedule_config(cfg)
            chat_data.pop("awaiting_shift_time", None)
            await update.message.reply_text(f"✅ Расписание успешно обновлено!\nНачало: {parts[0]}, Окончание: {parts[1]}")
            await send_admin_menu(update, context)
        else:
            await update.message.reply_text("❌ Неверный формат. Введите <старт> <финиш>, например: 09:00 18:00")
        return

    # Handle Role Management Command
    if chat_data.get("awaiting_role_command"):
        if not has_admin_access(update.effective_user.id):
            await update.message.reply_text("❌ Только администраторы могут управлять ролями.")
            chat_data.pop("awaiting_role_command", None)
            return
        parts = text.split()
        if len(parts) != 3:
            await update.message.reply_text("Формат: <фамилия> <роль> <telegram_id>\nРоли: admin, user")
            return
        surname = parts[0]
        role = parts[1].lower()
        if role not in {"admin", "user"}:
            await update.message.reply_text("Роль должна быть 'admin' или 'user'.")
            return
        try:
            target_id = int(parts[2])
        except ValueError:
            await update.message.reply_text("Telegram ID должен быть числом.")
            return

        roles = load_roles()
        for r in ("admin", "user"):
            if surname in roles.get(r, {}):
                del roles[r][surname]

        if role not in roles:
            roles[role] = {}
        roles[role][surname] = target_id
        save_roles(roles)

        chat_data.pop("awaiting_role_command", None)
        log_audit_event("INFO", "ROLE_ASSIGNED", f"Assigned role {role} to {surname} ({target_id})", user_id=update.effective_user.id)
        await update.message.reply_text(f"✅ Роль для {surname} успешно обновлена: {role}")
        await send_admin_menu(update, context)
        return


async def handle_image(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_user or not update.message or not update.effective_chat:
        return
    user_id = update.effective_user.id
    if user_id not in get_registered_user_ids():
        log_audit_event("WARNING", "UNREGISTERED_ACCESS", f"User ID {user_id} attempted upload", user_id=user_id)
        await update.message.reply_text("❌ Вы не зарегистрированы в системе. Обратитесь к администратору.")
        return

    msg = update.message
    file = None
    if msg.photo:
        file = await msg.photo[-1].get_file()
    elif msg.document and msg.document.mime_type and msg.document.mime_type.startswith("image"):
        file = await msg.document.get_file()

    if not file:
        await update.message.reply_text("❌ Не удалось получить изображение. Пожалуйста, отправьте скриншот еще раз.")
        return

    await update.message.reply_text("🔍 Обрабатываю скриншот, извлекаю время...")

    surname = get_surname_for_user(user_id)
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
        temp_path = tf.name

    img_rgb = None
    try:
        await file.download_to_drive(temp_path)
        img = Image.open(temp_path)
        
        # Color extraction requires the RGB version of the image before grayscale
        img_rgb = img.convert("RGB")
        w, h = img_rgb.size
        if max(w, h) < 1500:
            resample_filter = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', 1)
            img_rgb = img_rgb.resize((w * 2, h * 2), resample_filter)
            
        raw_text = run_tesseract(img)
        
        # Also run image_to_data for color extraction
        ocr_data = None
        if TESSERACT_CMD and PYTESSERACT_AVAILABLE:
            try:
                proc = preprocess_image(img)
                cfg = r'--oem 3 --psm 6'
                ocr_data = pytesseract.image_to_data(proc, lang='eng+rus', config=cfg, output_type=pytesseract.Output.DICT)
            except Exception as e:
                logger.error(f"Error running image_to_data: {e}")

    except Exception as e:
        logger.error(f"Error processing uploaded image: {e}")
        raw_text = ""
        ocr_data = None
        img_rgb = None
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    time_lines = extract_time_lines(raw_text, ocr_data, img_rgb)

    # Automatic Action Determination based on Green vs Red Color Logic
    action = None
    has_red_time = any(tl.get("color") == "red" for tl in time_lines)
    has_green_time = any(tl.get("color") == "green" for tl in time_lines)

    lower_text = raw_text.lower()
    if has_red_time or "check out" in lower_text or "уход" in lower_text:
        action = "out"
    elif has_green_time or "check in" in lower_text or "приход" in lower_text:
        action = "in"

    if not action:
        today = get_current_time().date().isoformat()
        try:
            with get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT action FROM shift_records WHERE telegram_user_id = ? AND created_at LIKE ? ORDER BY created_at DESC LIMIT 1",
                    (user_id, f"{today}%")
                )
                last_record = cursor.fetchone()
                if last_record and last_record["action"] == "in":
                    action = "out"
                else:
                    action = "in"
        except Exception:
            action = "in"

    parsed = parse_text(time_lines, raw_text, action, user_id)
    time_value = parsed.get("time")

    if not time_value:
        await update.message.reply_text(
            "⚠️ Не удалось распознать точное время на скриншоте.\n"
            "Убедитесь, что время на скриншоте четко видно."
        )
        return

    final_surname = parsed.get("surname") or get_surname_for_user(user_id) or f"User_{user_id}"

    record = {
        "chat_id": update.effective_chat.id,
        "telegram_user_id": user_id,
        "action": action,
        "surname": final_surname,
        "time": time_value,
        "time_line": parsed.get("time_line", ""),
        "raw_text": parsed.get("raw_text", ""),
        "source": "telegram_ocr",
        "created_at": get_current_time().isoformat(sep=" ", timespec="seconds")
    }

    if save_shift_record_to_db(record):
        action_label = "🟢 Приход" if action == "in" else "🔴 Уход"
        await update.message.reply_text(
            f"✅ Запись успешно зафиксирована и сохранена в БД!\n\n"
            f"📌 Тип: {action_label}\n"
            f"👤 ФИО / Логин: {record['surname']}\n"
            f"⏰ Время: {record['time']}\n"
            f"🗓 Дата: {record['created_at']}"
        )
    else:
        await update.message.reply_text("❌ Ошибка при сохранении записи в базу данных.")

    await send_main_menu(update, context)


def get_surname_for_user(user_id: int):
    roles = load_roles()
    for role_name in ("admin", "user"):
        for surname, uid in roles.get(role_name, {}).items():
            if uid == user_id:
                return surname
    return None


async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.effective_user or not update.message:
        return
    user_id = update.effective_user.id
    if user_id not in get_registered_user_ids():
        await update.message.reply_text("Вы не зарегистрированы")
        return

    if has_admin_access(user_id):
        await send_admin_menu(update, context)
    else:
        await update.message.reply_text("❌ У вас нет доступа к панели администратора.")


# --- Automatic Reminders Engine ---

async def reminder_scheduler_loop(bot):
    """
    Background worker checking every 30s for shift start/end reminders:
    - Shift start window: remind users who haven't checked in today
    - Shift end window: remind users who haven't checked out today
    """
    logger.info("Starting automatic shift reminder scheduler loop...")
    while True:
        try:
            await asyncio.sleep(30)
            cfg = load_schedule_config()
            if not cfg.get("enabled", True):
                continue

            now = get_current_time()
            today_str = now.strftime("%Y-%m-%d")

            start_str = cfg.get("shift_start", "09:00")
            end_str = cfg.get("shift_end", "18:00")
            remind_before = int(cfg.get("remind_before_start_minutes", 5))
            remind_after = int(cfg.get("remind_after_end_minutes", 5))

            try:
                sh, sm = map(int, start_str.split(":"))
                start_dt = now.replace(hour=sh, minute=sm, second=0, microsecond=0)
                remind_start_dt = start_dt - timedelta(minutes=remind_before)
            except Exception:
                start_dt = now.replace(hour=9, minute=0, second=0, microsecond=0)
                remind_start_dt = start_dt - timedelta(minutes=5)

            try:
                eh, em = map(int, end_str.split(":"))
                end_dt = now.replace(hour=eh, minute=em, second=0, microsecond=0)
                remind_end_dt = end_dt + timedelta(minutes=remind_after)
            except Exception:
                end_dt = now.replace(hour=18, minute=0, second=0, microsecond=0)
                remind_end_dt = end_dt + timedelta(minutes=5)

            users_map = get_registered_users_map()
            if not users_map:
                continue

            # --- Check Start Reminder Window (from 5 mins before start up to 60 mins after start) ---
            if remind_start_dt <= now <= (start_dt + timedelta(minutes=60)):
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT telegram_user_id FROM shift_records WHERE action = 'in' AND created_at LIKE ?", (f"{today_str}%",))
                    checked_in_ids = {r["telegram_user_id"] for r in cursor.fetchall() if r["telegram_user_id"]}

                    for surname, udata in users_map.items():
                        uid = udata["telegram_user_id"]
                        if uid not in checked_in_ids:
                            # Check if reminder already sent today
                            cursor.execute("SELECT id FROM sent_reminders WHERE date=? AND reminder_type='start' AND telegram_user_id=?", (today_str, uid))
                            if not cursor.fetchone():
                                try:
                                    await bot.send_message(
                                        chat_id=uid,
                                        text=(
                                            f"⏰ Напоминание!\n"
                                            f"До начала вашей смены осталось {remind_before} минут (старт в {start_str}).\n"
                                            f"Вы ещё не сделали отметку прихода!\n\n"
                                            f"Пожалуйста, отправьте скриншот рабочего приложения для отметки прихода."
                                        )
                                    )
                                    cursor.execute(
                                        "INSERT OR IGNORE INTO sent_reminders (date, reminder_type, telegram_user_id, sent_at) VALUES (?, 'start', ?, ?)",
                                        (today_str, uid, now.isoformat())
                                    )
                                    conn.commit()
                                    log_audit_event("INFO", "REMINDER_SENT_START", f"Sent start shift reminder to {surname} ({uid})")
                                except Exception as err:
                                    logger.error(f"Failed sending start reminder to {uid}: {err}")

            # --- Check End Reminder Window (from end reminder time up to 120 mins after end) ---
            if remind_end_dt <= now <= (end_dt + timedelta(minutes=120)):
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT telegram_user_id FROM shift_records WHERE action = 'out' AND created_at LIKE ?", (f"{today_str}%",))
                    checked_out_ids = {r["telegram_user_id"] for r in cursor.fetchall() if r["telegram_user_id"]}

                    for surname, udata in users_map.items():
                        uid = udata["telegram_user_id"]
                        if uid not in checked_out_ids:
                            cursor.execute("SELECT id FROM sent_reminders WHERE date=? AND reminder_type='end' AND telegram_user_id=?", (today_str, uid))
                            if not cursor.fetchone():
                                try:
                                    await bot.send_message(
                                        chat_id=uid,
                                        text=(
                                            f"⏰ Напоминание!\n"
                                            f"Смена завершилась в {end_str}.\n"
                                            f"Вы ещё не сделали отметку ухода!\n\n"
                                            f"Пожалуйста, отправьте скриншот рабочего приложения для отметки ухода."
                                        )
                                    )
                                    cursor.execute(
                                        "INSERT OR IGNORE INTO sent_reminders (date, reminder_type, telegram_user_id, sent_at) VALUES (?, 'end', ?, ?)",
                                        (today_str, uid, now.isoformat())
                                    )
                                    conn.commit()
                                    log_audit_event("INFO", "REMINDER_SENT_END", f"Sent end shift reminder to {surname} ({uid})")
                                except Exception as err:
                                    logger.error(f"Failed sending end reminder to {uid}: {err}")

        except Exception as e:
            logger.error(f"Error in reminder scheduler loop: {e}")


async def post_init(application):
    asyncio.create_task(reminder_scheduler_loop(application.bot))


def main():
    init_db()
    logger.info(f"Starting Telegram Bot with token prefix: {BOT_TOKEN[:10]}...")
    
    app = ApplicationBuilder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", lambda u, c: send_main_menu(u, c)))
    app.add_handler(CommandHandler("help", lambda u, c: send_main_menu(u, c)))
    app.add_handler(CommandHandler("admin", admin_command))
    app.add_handler(CallbackQueryHandler(button_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(filters.PHOTO | filters.Document.IMAGE, handle_image))

    logger.info("Bot is running with automatic reminder scheduler active.")
    app.run_polling()


if __name__ == "__main__":
    main()
