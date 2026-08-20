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
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
    except Exception:
        pass
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
        # Indices for optimal query performance
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_shift_records_created_at ON shift_records(created_at);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_shift_records_user ON shift_records(telegram_user_id, created_at);")
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

def sync_db_to_json():
    """Sync all SQLite shift records to JSON file"""
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM shift_records ORDER BY id ASC")
            rows = cursor.fetchall()
            records = [dict(r) for r in rows]
            
        atomic_save_file(DATA_FILE, {"records": records, "updated_at": get_current_time().isoformat()})
    except Exception as e:
        logger.error(f"Sync to JSON failed: {e}")

def save_shift_record_to_db(record: dict):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
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
            record_id = cursor.lastrowid

        action_label = str(record.get('action') or 'in').upper()
        surname_label = str(record.get('surname') or 'Unknown')
        time_label = str(record.get('time') or '')
        date_label = str(record.get('created_at') or '').split(' ')[0] or get_current_time().date().isoformat()
        uid = record.get("telegram_user_id")
        log_audit_event(
            "INFO",
            "DB_RECORD_SAVED",
            f"Recorded {action_label} for {surname_label} on {date_label} at {time_label} (ID: {record_id})",
            user_id=uid if isinstance(uid, int) else None
        )
        
        sync_db_to_json()
        return True
    except Exception as e:
        uid = record.get("telegram_user_id")
        log_audit_event("ERROR", "DB_RECORD_SAVE_FAILED", f"Error saving shift record: {e}", user_id=uid if isinstance(uid, int) else None)
        return False

def atomic_save_file(file_path: str, data: dict):
    dir_name = os.path.dirname(os.path.abspath(file_path))
    with tempfile.NamedTemporaryFile("w", dir=dir_name, delete=False, encoding="utf-8") as tf:
        json.dump(data, tf, ensure_ascii=False, indent=2)
        temp_name = tf.name
    os.replace(temp_name, file_path)


# --- Helper Timezone Functions ---

def get_current_time() -> datetime:
    try:
        config = load_schedule_config()
        tz_offset = config.get("tz_offset_hours", TIMEZONE_OFFSET_HOURS)
        tz = timezone(timedelta(hours=int(tz_offset)))
        return datetime.now(tz)
    except Exception:
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
        # Ignore top status bar entirely (first 7% of screen height)
        if top < img_rgb.height * 0.07:
            return "status_bar"

        # Crop the exact region around the text
        pad_x = max(6, int(width * 0.15))
        pad_y = max(4, int(height * 0.2))
        l = max(0, left - pad_x)
        t = max(0, top - pad_y)
        r = min(img_rgb.width, left + width + pad_x)
        b = min(img_rgb.height, top + height + pad_y)
        
        box = img_rgb.crop((l, t, r, b))
        
        green_pixels = 0
        red_pixels = 0
        total_pixels = 0
        
        rgb_data = list(box.getdata())
        
        for pixel in rgb_data:
            r_val, g_val, b_val = pixel[:3]
            total_pixels += 1
            
            # Bright Green text detection (e.g., #22c55e / #16a34a / #00c853)
            if g_val >= 90 and g_val > r_val + 25 and g_val > b_val + 20:
                green_pixels += 1
            # Bright Red / Crimson text detection (e.g., #ef4444 / #dc2626 / #d50000)
            elif r_val >= 110 and r_val > g_val + 35 and r_val > b_val + 30:
                red_pixels += 1
                
        if green_pixels >= 4 and green_pixels > red_pixels * 1.5:
            return "green"
        if red_pixels >= 4 and red_pixels > green_pixels * 1.5:
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
                word_colors.append({"text": text, "color": color, "left": ocr_data['left'][i], "top": ocr_data['top'][i]})

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
            
            # Contextual keywords in line
            low_l = l.lower()
            if color == "unknown":
                if any(k in low_l for k in ("check in", "приход", "вход", "старт", "начало")):
                    color = "green"
                elif any(k in low_l for k in ("check out", "уход", "выход", "финиш", "конец")):
                    color = "red"
                    
            results.append({"time": norm, "line": l, "line_index": idx, "color": color})
    return results


def looks_like_status_bar(line: str, line_index: int = 0) -> bool:
    low = line.lower()
    if line_index == 0:
        return True
    return any(k in low for k in ("battery", "wifi", "lte", "5g", "4g", "%", "volte", "sim"))


def choose_time_line(time_lines: list, action: str):
    if not time_lines:
        now_str = get_current_time().strftime("%H:%M:%S")
        return now_str, f"Fallback Time: {now_str}"

    def parse_to_seconds(ts: str):
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

    # Filter out status bar lines and filter out 2-part HH:MM if 3-part HH:MM:SS exists
    valid_items = []
    has_seconds = any(len(it["time"].split(":")) == 3 and not looks_like_status_bar(it.get("line", ""), it.get("line_index", 0)) for it in time_lines)

    for it in time_lines:
        if looks_like_status_bar(it.get("line", ""), it.get("line_index", 0)):
            continue
        if has_seconds and len(it["time"].split(":")) < 3:
            continue
        sec_val = parse_to_seconds(it["time"])
        if sec_val is not None:
            valid_items.append((sec_val, it))

    if not valid_items:
        # Fallback to all items if filtered became empty
        for it in time_lines:
            sec_val = parse_to_seconds(it["time"])
            if sec_val is not None:
                valid_items.append((sec_val, it))

    if valid_items:
        # Prioritize matching detected color first (green for in, red for out)
        target_color = "green" if action == "in" else "red"
        color_matched = [item for item in valid_items if item[1].get("color") == target_color]
        
        if color_matched:
            sel = color_matched[0]
        elif action == "in":
            # For Check In fallback: earliest timestamp
            sel = min(valid_items, key=lambda x: x[0])
        else:
            # For Check Out fallback: latest timestamp
            sel = max(valid_items, key=lambda x: x[0])

        total = sel[0]
        h = total // 3600
        mm = (total % 3600) // 60
        ss = total % 60
        return f"{h:02}:{mm:02}:{ss:02}", sel[1]["line"]

    sel = time_lines[-1]
    return sel["time"], sel["line"]


def get_known_employee_names() -> dict[str, str]:
    """Returns a map of normalized names (lower) to canonical names from roles and database."""
    name_map = {}
    roles = load_roles()
    for role_name in ("admin", "user"):
        for s in roles.get(role_name, {}).keys():
            name_map[s.strip().lower()] = s.strip()
            prefix = s.split('.')[0].strip().lower()
            if len(prefix) >= 3:
                name_map[prefix] = s.strip()
    
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT surname FROM shift_records WHERE surname IS NOT NULL AND surname != ''")
            for row in cursor.fetchall():
                s = row["surname"].strip()
                if s.lower() not in name_map:
                    name_map[s.lower()] = s
                    prefix = s.split('.')[0].strip().lower()
                    if len(prefix) >= 3 and prefix not in name_map:
                        name_map[prefix] = s
    except Exception as e:
        logger.error(f"Error fetching known employee names: {e}")
    return name_map


def extract_and_verify_surname(text: str, user_id: int | None = None) -> tuple[str, str]:
    """
    Extracts employee surname/login from OCR text, validates it against the DB / registered roles,
    and if unrecognized, missing, or mismatched, performs a dedicated check and fallback to Telegram ID.

    Returns:
        (selected_surname, resolution_source)
        where resolution_source is:
        - 'ocr_verified': matched registered employee directly on screenshot
        - 'telegram_id_fallback': name on screenshot missing or not in DB, matched by Telegram ID
        - 'unregistered_ocr': candidate found on screen, but user not registered in DB
        - 'unknown': neither OCR nor Telegram ID matched
    """
    known_names = get_known_employee_names()
    registered_surname_for_sender = get_surname_for_user(user_id) if user_id else None

    # 1. Search text for any registered surname/login from DB or roles
    for norm_name, canonical_name in known_names.items():
        if len(norm_name) >= 3 and norm_name in text.lower():
            return canonical_name, "ocr_verified"

    # 2. Match RMAS Mobile header login pattern (e.g. "eremin.n C941s")
    rmas_match = re.search(r"RMAS\s+Mobile[^\n]*\n\s*([a-zA-Z0-9_\.\-]+)", text, re.IGNORECASE)
    if rmas_match:
        cand = rmas_match.group(1).strip()
        cand_lower = cand.lower()
        if len(cand) >= 3 and cand_lower not in {"mobile", "check", "grade", "in", "out", "str", "m.video"}:
            if cand_lower in known_names or cand_lower.split('.')[0] in known_names:
                canonical = known_names.get(cand_lower) or known_names.get(cand_lower.split('.')[0]) or cand
                return canonical, "ocr_verified"
            # Candidate on screenshot does NOT match any DB employee -> check Telegram ID
            if registered_surname_for_sender:
                log_audit_event(
                    "WARNING",
                    "OCR_NAME_MISMATCH",
                    f"OCR extracted '{cand}', which is not in DB. Fallback to Telegram ID {user_id} -> '{registered_surname_for_sender}'",
                    user_id=user_id
                )
                return registered_surname_for_sender, "telegram_id_fallback"
            return cand, "unregistered_ocr"

    # 3. Match login pattern like surname.i
    m = SURNAME_LOGIN_PATTERN.search(text)
    if m:
        cand = m.group(1).strip()
        cand_lower = cand.lower()
        if cand_lower not in {"str.khalturina", "m.video", "rmas.mobile"} and len(cand) >= 3:
            if cand_lower in known_names or cand_lower.split('.')[0] in known_names:
                canonical = known_names.get(cand_lower) or known_names.get(cand_lower.split('.')[0]) or cand
                return canonical, "ocr_verified"
            if registered_surname_for_sender:
                log_audit_event(
                    "WARNING",
                    "OCR_NAME_MISMATCH",
                    f"OCR matched '{cand}', not in DB. Fallback to Telegram ID {user_id} -> '{registered_surname_for_sender}'",
                    user_id=user_id
                )
                return registered_surname_for_sender, "telegram_id_fallback"

    # 4. Fallback check by Telegram User ID if name was not recognized on screenshot
    if registered_surname_for_sender:
        log_audit_event(
            "INFO",
            "OCR_NAME_FALLBACK_TG_ID",
            f"No recognizable employee name on screenshot. Assigned to Telegram ID {user_id} -> '{registered_surname_for_sender}'",
            user_id=user_id
        )
        return registered_surname_for_sender, "telegram_id_fallback"

    if user_id:
        return f"User_{user_id}", "unknown"
    return "Unknown", "unknown"


def parse_text(time_lines: list, full_text: str, action: str, user_id: int | None = None) -> dict:
    t, tl = choose_time_line(time_lines, action)
    surname, resolution_source = extract_and_verify_surname(full_text, user_id)
    return {
        "time": t,
        "time_line": tl,
        "surname": surname,
        "resolution_source": resolution_source,
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
            cursor.execute(
                "SELECT surname, action, time, created_at FROM shift_records WHERE created_at LIKE ? ORDER BY created_at ASC",
                (f"{today}%",)
            )
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
        text = f"📊 Отметки сотрудников за {today} (всего записей: {len(records)}):\n\n" + "\n".join(rows)

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

    checked_in_set = set()
    checked_out_set = set()
    for rec in records:
        s = (rec["surname"] or "").strip()
        if rec["action"] == "in":
            checked_in_set.add(s)
        elif rec["action"] == "out":
            checked_out_set.add(s)

    def is_present(registered_name: str, target_set: set) -> bool:
        if registered_name in target_set:
            return True
        reg_clean = registered_name.lower().split(".")[0].strip()
        for item in target_set:
            item_clean = item.lower().split(".")[0].strip()
            if reg_clean and (reg_clean == item_clean or reg_clean in item_clean or item_clean in reg_clean):
                return True
        return False

    missing_in = [s for s in users_map if not is_present(s, checked_in_set)]
    missing_out = [s for s in users_map if not is_present(s, checked_out_set)]

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


def analyze_image_with_gemini(image_path: str) -> dict | None:
    """Analyze screenshot via Gemini Vision REST API (fast and robust fallback/primary analyzer)"""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        import base64
        import urllib.request
        with open(image_path, "rb") as f:
            b64_data = base64.b64encode(f.read()).decode("utf-8")
        
        prompt = """You are an expert OCR and attendance verification system for employee mobile screenshots (RMAS Mobile or similar).
Analyze the screenshot and return JSON strictly:
1. Username: In RMAS Mobile, look at top header line right under 'RMAS Mobile ...' (e.g. 'eremin.n C941s' -> extract 'eremin.n') as 'surname'.
2. Status bar clock: IGNORE phone status bar clock at the very top (black bar with battery/wifi).
3. Check In (Приход): Indicated by GREEN timestamp above the buttons.
4. Check Out (Уход): Indicated by RED timestamp below 'Check Out' button.
5. When BOTH green timestamp (e.g. 11:28:53) AND red timestamp (e.g. 20:34:25) are present, the action is Check Out ('detected_action': 'out') and the shift time MUST be the RED timestamp ('20:34:25').
6. When ONLY green timestamp is present (no red timestamp), the action is Check In ('detected_action': 'in') and shift time is this green timestamp.

Return JSON format only:
{
  "surname": "eremin.n",
  "time": "HH:MM:SS",
  "detected_action": "in" or "out",
  "raw_text": "..."
}"""

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        payload = {
            "contents": [
                {
                    "parts": [
                        {"inline_data": {"mime_type": "image/jpeg", "data": b64_data}},
                        {"text": prompt}
                    ]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json"
            }
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "ShiftBot/2.0"}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            candidates = res_data.get("candidates", [])
            if candidates:
                content = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "{}")
                parsed = json.loads(content)
                if parsed.get("time"):
                    return parsed
    except Exception as e:
        logger.warning(f"Gemini Vision API in bot: {e}")
    return None


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

    await update.message.reply_text("🔍 Обрабатываю скриншот, извлекаю отметку...")

    chat_data = context.chat_data if context.chat_data is not None else {}
    pending_action = chat_data.pop("pending_action", None)
    caption = (msg.caption or "").lower()
    if not pending_action:
        if any(w in caption for w in ("уход", "выход", "out", "конец", "финиш")):
            pending_action = "out"
        elif any(w in caption for w in ("приход", "вход", "in", "старт", "начало")):
            pending_action = "in"

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
        temp_path = tf.name

    gemini_result = None
    time_lines = []
    raw_text = ""
    img_rgb = None

    try:
        await file.download_to_drive(temp_path)

        # 1. Primary Analyzer: Gemini Vision (if API key present)
        gemini_result = analyze_image_with_gemini(temp_path)

        # 2. Local OCR / Image processing for fallback or validation
        img = Image.open(temp_path)
        img_rgb = img.convert("RGB")
        w, h = img_rgb.size
        if max(w, h) < 1500:
            resample_filter = getattr(getattr(Image, 'Resampling', Image), 'LANCZOS', 1)
            img_rgb = img_rgb.resize((w * 2, h * 2), resample_filter)
            
        raw_text = run_tesseract(img)
        
        ocr_data = None
        if TESSERACT_CMD and PYTESSERACT_AVAILABLE:
            try:
                proc = preprocess_image(img)
                cfg = r'--oem 3 --psm 6'
                ocr_data = pytesseract.image_to_data(proc, lang='eng+rus', config=cfg, output_type=pytesseract.Output.DICT)
            except Exception as e:
                logger.error(f"Error running image_to_data: {e}")

        time_lines = extract_time_lines(raw_text, ocr_data, img_rgb)

    except Exception as e:
        logger.error(f"Error processing uploaded image: {e}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    # Determine action and time
    action = pending_action
    time_value = None
    final_surname = None
    resolution_source = "unknown"
    time_line_str = ""

    if gemini_result and gemini_result.get("time"):
        time_value = gemini_result.get("time")
        detected_action = gemini_result.get("detected_action", "in")
        action = pending_action or detected_action
        cand_surname = gemini_result.get("surname", "")
        if cand_surname:
            final_surname, resolution_source = extract_and_verify_surname(cand_surname, user_id)
        raw_text = gemini_result.get("raw_text", raw_text)
        time_line_str = f"Gemini Vision: {time_value} ({action.upper()})"
    else:
        # Local OCR fallback
        has_seconds = any(len(tl["time"].split(":")) == 3 and not looks_like_status_bar(tl.get("line", ""), tl.get("line_index", 0)) for tl in time_lines)
        valid_shift_times = []
        for tl in time_lines:
            if looks_like_status_bar(tl.get("line", ""), tl.get("line_index", 0)):
                continue
            if has_seconds and len(tl["time"].split(":")) < 3:
                continue
            valid_shift_times.append(tl["time"])

        distinct_times = list(dict.fromkeys(valid_shift_times))

        # Action resolution in local fallback
        if not action:
            if any(tl.get("color") == "red" for tl in time_lines):
                action = "out"
            elif len(distinct_times) >= 2:
                action = "out"
            elif len(distinct_times) == 1:
                action = "in"
            else:
                lower_text = raw_text.lower()
                if any(k in lower_text for k in ("check out", "уход", "выход", "финиш", "завершить")):
                    action = "out"
                elif any(k in lower_text for k in ("check in", "приход", "вход", "старт", "начать")):
                    action = "in"
                else:
                    today = get_current_time().date().isoformat()
                    try:
                        with get_db_connection() as conn:
                            cursor = conn.cursor()
                            cursor.execute(
                                "SELECT action FROM shift_records WHERE telegram_user_id = ? AND created_at LIKE ? ORDER BY id DESC LIMIT 1",
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
        final_surname = parsed.get("surname")
        resolution_source = parsed.get("resolution_source", "unknown")
        time_line_str = parsed.get("time_line", "")

    if not time_value:
        await update.message.reply_text(
            "⚠️ Не удалось распознать точное время на скриншоте.\n"
            "Пожалуйста, убедитесь, что скриншот чёткий и не обрезан."
        )
        return

    if not final_surname or final_surname == "Unknown":
        final_surname = get_surname_for_user(user_id) or f"User_{user_id}"

    # --- Honesty Check (Проверка честности за последние 7 дней) ---
    # Check if exact timestamp with seconds (HH:MM:SS) has already been submitted by this employee or anyone else in last 7 days
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            seven_days_ago = (get_current_time().date() - timedelta(days=7)).isoformat()
            cursor.execute(
                """
                SELECT id, surname, action, time, created_at, telegram_user_id
                FROM shift_records
                WHERE time = ? AND created_at >= ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (time_value, f"{seven_days_ago} 00:00:00")
            )
            duplicate_record = cursor.fetchone()

            if duplicate_record:
                dup_surname = duplicate_record["surname"] or "Неизвестный сотрудник"
                dup_action = "🟢 Приход" if duplicate_record["action"] == "in" else "🔴 Уход"
                dup_created = duplicate_record["created_at"]
                is_same_person = (duplicate_record["telegram_user_id"] == user_id) or (duplicate_record["surname"] == final_surname)

                log_audit_event(
                    "WARNING",
                    "HONESTY_CHECK_FAILED",
                    f"Duplicate time '{time_value}' detected for user {final_surname} (ID: {user_id}). Previously used by {dup_surname} at {dup_created}.",
                    user_id=user_id
                )

                if is_same_person:
                    error_msg = (
                        f"⛔️ **Ошибка проверки честности!**\n\n"
                        f"Точное время **{time_value}** уже было зафиксировано вами ранее (**{dup_created}**, действие: {dup_action}).\n\n"
                        f"⚠️ Повторная отправка одного и того же скриншота запрещена!"
                    )
                else:
                    error_msg = (
                        f"⛔️ **Ошибка проверки честности!**\n\n"
                        f"Точное время **{time_value}** уже было отправлено другим сотрудником (**{dup_surname}**, {dup_created}).\n\n"
                        f"⚠️ Использование чужих скриншотов запрещено!"
                    )

                await update.message.reply_text(error_msg, parse_mode="Markdown")
                await send_main_menu(update, context)
                return
    except Exception as e:
        logger.error(f"Honesty check query error: {e}")

    record = {
        "chat_id": update.effective_chat.id,
        "telegram_user_id": user_id,
        "action": action,
        "surname": final_surname,
        "time": time_value,
        "time_line": time_line_str,
        "raw_text": raw_text.strip(),
        "source": "telegram_ocr",
        "created_at": get_current_time().isoformat(sep=" ", timespec="seconds")
    }

    if save_shift_record_to_db(record):
        action_label = "🟢 Приход" if action == "in" else "🔴 Уход"
        msg_text = (
            f"✅ Запись успешно зафиксирована и сохранена в БД!\n\n"
            f"📌 Тип: {action_label}\n"
            f"👤 ФИО / Логин: {record['surname']}\n"
            f"⏰ Время: {record['time']}\n"
            f"🗓 Дата: {record['created_at']}"
        )
        if resolution_source == "telegram_id_fallback":
            msg_text += (
                "\n\nℹ️ *Примечание:* Имя на скриншоте привязано к вашему профилю по Telegram ID."
            )
        await update.message.reply_text(msg_text, parse_mode="Markdown")
    else:
        await update.message.reply_text("❌ Ошибка при сохранении записи в базу данных.")

    await send_main_menu(update, context)


def get_surname_for_user(user_id: int):
    roles = load_roles()
    for role_name in ("admin", "user"):
        for surname, uid in roles.get(role_name, {}).items():
            if uid == user_id:
                return surname
    # Also check previous history in SQLite DB
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT surname FROM shift_records WHERE telegram_user_id = ? AND surname IS NOT NULL AND surname NOT LIKE 'User_%' ORDER BY id DESC LIMIT 1",
                (user_id,)
            )
            row = cursor.fetchone()
            if row and row["surname"]:
                return row["surname"]
    except Exception as e:
        logger.error(f"Error finding surname in DB history for tg_id {user_id}: {e}")
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


def is_employee_working_today(surname: str, cfg: dict, now: datetime) -> tuple[bool, str]:
    """
    Checks if employee should work today based on work_days schedule and vacation dates.
    Returns (is_working: bool, reason: str)
    """
    emp_schedules = cfg.get("employee_schedules", {})
    emp_cfg = emp_schedules.get(surname, {})
    
    # 1. Check vacation period
    vac_start = emp_cfg.get("vacation_start")
    vac_end = emp_cfg.get("vacation_end")
    today_str = now.strftime("%Y-%m-%d")
    
    if vac_start and vac_end:
        if vac_start <= today_str <= vac_end:
            return False, f"🏖 Отпуск (с {vac_start} по {vac_end})"
            
    # 2. Check work days of week (1 = Monday, 7 = Sunday)
    iso_weekday = now.isoweekday()
    work_days = emp_cfg.get("work_days")
    if work_days is None:
        work_days = [1, 2, 3, 4, 5]  # Default 5/2 (Mon-Fri)
    elif not isinstance(work_days, list):
        work_days = [1, 2, 3, 4, 5]
        
    if iso_weekday not in work_days:
        day_names = {1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Вс"}
        cur_day_name = day_names.get(iso_weekday, str(iso_weekday))
        return False, f"☕️ Выходной день ({cur_day_name})"
        
    return True, "Рабочий день"


# --- Automatic Reminders Engine ---

async def reminder_scheduler_loop(bot):
    """
    Background worker checking every 30s for shift start/end reminders:
    - Shift start window: remind users who haven't checked in today (skipping days off and vacations)
    - Shift end window: remind users who haven't checked out today (skipping days off and vacations)
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

                        # Check if employee works today or is on vacation/day off
                        is_working, status_reason = is_employee_working_today(surname, cfg, now)
                        if not is_working:
                            continue

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
                                    err_str = str(err).lower()
                                    if "forbidden" in err_str or "blocked" in err_str or "chat not found" in err_str:
                                        log_audit_event("WARNING", "USER_BLOCKED_BOT", f"User {uid} ({surname}) blocked the bot. Skipped start reminder.", user_id=uid)
                                    else:
                                        logger.error(f"Failed sending start reminder to {uid}: {err}")

            # --- Check End Reminder Window (from end reminder time up to 120 mins after end) ---
            if remind_end_dt <= now <= (end_dt + timedelta(minutes=120)):
                with get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT telegram_user_id FROM shift_records WHERE action = 'out' AND created_at LIKE ?", (f"{today_str}%",))
                    checked_out_ids = {r["telegram_user_id"] for r in cursor.fetchall() if r["telegram_user_id"]}

                    for surname, udata in users_map.items():
                        uid = udata["telegram_user_id"]

                        # Check if employee works today or is on vacation/day off
                        is_working, status_reason = is_employee_working_today(surname, cfg, now)
                        if not is_working:
                            continue

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
                                    err_str = str(err).lower()
                                    if "forbidden" in err_str or "blocked" in err_str or "chat not found" in err_str:
                                        log_audit_event("WARNING", "USER_BLOCKED_BOT", f"User {uid} ({surname}) blocked the bot. Skipped end reminder.", user_id=uid)
                                    else:
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
