import React, { useState } from 'react';
import { Copy, Download, Code, ShieldCheck, Database, FileText, Bug, CheckCircle2 } from 'lucide-react';

interface BotCodeReviewProps {
  botCode: string;
}

export const BotCodeReview: React.FC<BotCodeReviewProps> = ({ botCode }) => {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    navigator.clipboard.writeText(botCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadBotScript = () => {
    const blob = new Blob([botCode], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const fixes = [
    {
      title: 'Хранение данных и логирование в SQLite',
      icon: Database,
      badge: 'SQLite Добавлена',
      desc: 'Замена прямых чтения/записи JSON на транзакции SQLite (`shift_attendance.db`). Созданы таблицы `shift_records` и `system_audit_logs`.',
    },
    {
      title: 'Модуль логирования Python',
      icon: FileText,
      badge: 'Логирование настроено',
      desc: 'Настроен `logging.basicConfig` с `FileHandler("bot_activity.log")` и `StreamHandler()`. Временные метки, ошибки и действия пользователей систематически записываются.',
    },
    {
      title: 'Безопасность токена и переменные окружения',
      icon: ShieldCheck,
      badge: 'Защищено',
      desc: 'Обновлено чтение токена через `os.environ.get("BOT_TOKEN")` с защитным фоллбэком и логированием.',
    },
    {
      title: 'Часовой пояс и расчёт дат',
      icon: CheckCircle2,
      badge: 'Часовой пояс исправлен',
      desc: 'Используется настраиваемый `timezone(timedelta(hours=TIMEZONE_OFFSET_HOURS))` для точного соответствия дат смен локальному времени сотрудников.',
    },
    {
      title: 'Атомарные операции с файлами',
      icon: Bug,
      badge: 'Исправлены ошибки файлов',
      desc: 'Реализована атомарная запись (`atomic_save_file`) через временные файлы (`tempfile.NamedTemporaryFile` + `os.replace`) для предотвращения повреждения данных.',
    },
  ];

  return (
    <div id="bot-code-review-section" className="space-y-6">
      {/* Code Fixes Summary Cards */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2">
              <Code className="w-4 h-4 text-cyan-600" />
              Анализ кода и интеграция с базой данных
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Обзор кода вашего Telegram-бота (`python-telegram-bot`) с интеграцией SQLite.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="copy-bot-code-btn"
              onClick={copyCode}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Код скопирован' : 'Скопировать код'}
            </button>

            <button
              id="download-bot-code-btn"
              onClick={downloadBotScript}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white bg-cyan-500 rounded hover:bg-cyan-600 transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              Скачать bot.py
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fixes.map((fix, idx) => {
            const Icon = fix.icon;
            return (
              <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="p-1.5 bg-cyan-100 text-cyan-800 rounded">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    {fix.badge}
                  </span>
                </div>
                <h3 className="text-xs font-bold text-slate-900 mb-1">{fix.title}</h3>
                <p className="text-[11px] text-slate-600 leading-relaxed">{fix.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Code Editor Preview */}
      <div className="bg-[#0F172A] rounded-xl border border-slate-800 shadow-xl overflow-hidden text-slate-100">
        <div className="p-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
            <span className="text-slate-300 font-bold ml-2">bot.py — Python Telegram Bot with SQLite Logging</span>
          </span>
          <span>{botCode.split('\n').length} lines</span>
        </div>

        <pre className="p-4 font-mono text-xs text-slate-300 max-h-[600px] overflow-y-auto no-scrollbar leading-relaxed">
          <code>{botCode}</code>
        </pre>
      </div>
    </div>
  );
};
