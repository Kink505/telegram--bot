import os, re
from openpyxl import Workbook, load_workbook
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, ContextTypes, filters

# ================== CONFIG ==================
BOT_TOKEN = os.getenv("BOT_TOKEN")  # WAJIB pakai ENV untuk Railway
BASE_DIR = "data_sps"
os.makedirs(BASE_DIR, exist_ok=True)

# ================== UTIL ==================
def user_dir(uid):
    p = os.path.join(BASE_DIR, str(uid))
    os.makedirs(p, exist_ok=True)
    return p

def pw_path(uid): return os.path.join(user_dir(uid), "pw.txt")
def active_path(uid): return os.path.join(user_dir(uid), "active.txt")
def cookie_mode_path(uid): return os.path.join(user_dir(uid), "cookie_mode.txt")

def get_pw(uid):
    return open(pw_path(uid)).read().strip() if os.path.exists(pw_path(uid)) else None

def set_pw(uid, pw):
    open(pw_path(uid), "w").write(pw)

def set_cookie_mode(uid, on=True):
    if on:
        open(cookie_mode_path(uid), "w").write("1")
    else:
        if os.path.exists(cookie_mode_path(uid)):
            os.remove(cookie_mode_path(uid))

def is_cookie_mode(uid):
    return os.path.exists(cookie_mode_path(uid))

def list_sheets(uid):
    return [f for f in os.listdir(user_dir(uid)) if f.endswith(".xlsx")]

def get_active(uid):
    return open(active_path(uid)).read().strip() if os.path.exists(active_path(uid)) else None

def set_active(uid, name):
    open(active_path(uid), "w").write(name)

def new_sheet(uid):
    idx = len(list_sheets(uid)) + 1
    name = f"sheet_{idx}.xlsx"
    path = os.path.join(user_dir(uid), name)
    wb = Workbook()
    ws = wb.active
    ws.delete_rows(1, ws.max_row)  # mulai dari A1
    wb.save(path)
    set_active(uid, name)
    return name

def ensure_sheet(uid):
    name = get_active(uid) or new_sheet(uid)
    path = os.path.join(user_dir(uid), name)
    if not os.path.exists(path):
        wb = Workbook()
        ws = wb.active
        ws.delete_rows(1, ws.max_row)
        wb.save(path)
    return path

# ================== HELP ==================
HELP_TEXT = """📖 HELP

/start
➜ Tampilkan help

/set <password>
➜ Set password default

/new
➜ Buat spreadsheet baru

/list
➜ Lihat daftar spreadsheet

/pilih <nama.xlsx>
➜ Pilih spreadsheet aktif

/hapus <nama.xlsx>
➜ Hapus spreadsheet

/get
➜ Kirim spreadsheet aktif

/c
➜ Mode cookies manual (STAY ON)
/c off
➜ Matikan mode cookies manual

FORMAT INPUT:
1) id|mail|kode
2) id|pw|mail|kode
3) Paste Facebook (3 baris):
   link fb (id=...)
   email
   kode
4) Paste Cookies (auto):
   cookies (ada c_user)

KOLOM:
A = ID / Cookies(manual)
B = Password
C = Mail / Cookies(auto)
D = Kode
"""

# ================== COMMANDS ==================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(HELP_TEXT)

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(HELP_TEXT)

async def set_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("❌ Contoh: /set woilah")
        return
    set_pw(update.effective_user.id, context.args[0])
    await update.message.reply_text("✅ Password diset")

async def new_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    name = new_sheet(update.effective_user.id)
    await update.message.reply_text(f"🆕 Spreadsheet aktif: {name}")

async def list_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    sheets = list_sheets(update.effective_user.id)
    await update.message.reply_text(
        "📂 DAFTAR SPREADSHEET:\n" + ("\n".join(sheets) if sheets else "- kosong")
    )

async def pilih_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not context.args:
        await update.message.reply_text("❌ /pilih sheet_x.xlsx")
        return
    name = context.args[0]
    if name not in list_sheets(uid):
        await update.message.reply_text("❌ Spreadsheet tidak ditemukan")
        return
    set_active(uid, name)
    await update.message.reply_text(f"✅ Aktif: {name}")

async def hapus_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if not context.args:
        await update.message.reply_text("❌ /hapus sheet_x.xlsx")
        return
    path = os.path.join(user_dir(uid), context.args[0])
    if not os.path.exists(path):
        await update.message.reply_text("❌ Tidak ditemukan")
        return
    os.remove(path)
    await update.message.reply_text("🗑 Spreadsheet dihapus")

async def get_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_document(open(ensure_sheet(update.effective_user.id), "rb"))

async def cookie_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if context.args and context.args[0].lower() == "off":
        set_cookie_mode(uid, False)
        await update.message.reply_text("❌ MODE COOKIES DIMATIKAN")
    else:
        set_cookie_mode(uid, True)
        await update.message.reply_text(
            "🍪 MODE COOKIES MANUAL AKTIF (STAY ON)\n"
            "Paste cookies berkali-kali.\n"
            "Matikan dengan: /c off"
        )

# ================== HANDLE DATA ==================
async def handle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    pw = get_pw(uid)  # boleh None
    path = ensure_sheet(uid)
    text = update.message.text.strip()
    lines = text.splitlines()

    # COOKIES MANUAL (/c) — BOLEH TANPA PW, STAY ON
    if is_cookie_mode(uid):
        row = [text, pw if pw else "", "", ""]

    # MODE LAIN WAJIB PW
    else:
        if not pw:
            await update.message.reply_text("❌ Set password dulu: /set pw")
            return

        # COOKIES AUTO (ada c_user)
        if "c_user=" in text:
            m = re.search(r"c_user=(\d+)", text)
            if not m:
                await update.message.reply_text("❌ c_user tidak ditemukan")
                return
            row = [m.group(1), pw, text, ""]

        # FB 3 BARIS
        elif len(lines) == 3 and "facebook.com" in lines[0]:
            m = re.search(r"id=(\d+)", lines[0])
            if not m:
                await update.message.reply_text("❌ ID Facebook tidak ditemukan")
                return
            row = [m.group(1), pw, lines[1], lines[2]]

        # NORMAL
        else:
            p = text.split("|")
            if len(p) == 3:
                row = [p[0], pw, p[1], p[2]]
            elif len(p) == 4:
                row = [p[0], p[1], p[2], p[3]]
            else:
                await update.message.reply_text("❌ Format salah. /help")
                return

    wb = load_workbook(path)
    ws = wb.active
    ws.append(row)
    wb.save(path)
    await update.message.reply_text("✅ Data masuk")

# ================== RUN ==================
if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN belum diset di Environment Variable")

app = ApplicationBuilder().token(BOT_TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(CommandHandler("help", help_cmd))
app.add_handler(CommandHandler("set", set_cmd))
app.add_handler(CommandHandler("new", new_cmd))
app.add_handler(CommandHandler("list", list_cmd))
app.add_handler(CommandHandler("pilih", pilih_cmd))
app.add_handler(CommandHandler("hapus", hapus_cmd))
app.add_handler(CommandHandler("get", get_cmd))
app.add_handler(CommandHandler("c", cookie_cmd))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle))

print("🤖 BOT AKTIF — SIAP DEPLOY RAILWAY")
app.run_polling()
