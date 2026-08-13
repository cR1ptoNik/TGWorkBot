import React, { useState, useEffect } from 'react';
import { Clock, ShieldAlert, CheckCircle2, Bot, Calendar, Sparkles, ArrowLeft } from 'lucide-react';
import { IndividualCharts } from './IndividualCharts';
import { apiFetch } from '../lib/api';

interface Props {
  surname: string;
  telegramId: number | null;
  role: string;
}

export const EmployeeWebAppView: React.FC<Props> = ({ surname, telegramId, role }) => {
  const [todayRecord, setTodayRecord] = useState<{ inTime?: string; outTime?: string; status: string } | null>(null);

  const handleCloseWebApp = () => {
    // @ts-ignore
    if (window.Telegram?.WebApp?.close) {
      // @ts-ignore
      window.Telegram.WebApp.close();
    }
  };

  useEffect(() => {
    apiFetch(`/api/individual-stats?surname=${encodeURIComponent(surname)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.dailyHistory && data.dailyHistory.length > 0) {
          const todayStr = new Date().toISOString().split('T')[0];
          const found = data.dailyHistory.find((item: any) => item.date === todayStr);
          if (found) {
            setTodayRecord(found);
          }
        }
      })
      .catch((err) => console.error('Error fetching employee today status:', err));
  }, [surname]);

  return (
    <div className="max-w-4xl w-full mx-auto space-y-6 p-4 md:p-6">
      {/* Employee Profile Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-cyan-950 text-white p-6 rounded-2xl shadow-md border border-slate-700 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-cyan-500/10 blur-2xl pointer-events-none"></div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                onClick={handleCloseWebApp}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-colors shadow-xs"
                title="Закрыть WebApp и вернуться в Telegram"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Закрыть WebApp (Назад)
              </button>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                <Sparkles className="w-3 h-3" />
                Staff Portal
              </div>
            </div>

            <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight break-words whitespace-normal">
              Привет, <span className="text-cyan-400">{surname || 'Сотрудник'}</span>! 👋
            </h1>
            <p className="text-xs text-slate-300 mt-1 whitespace-normal break-words">
              Ваш личный кабинет учета рабочего времени и аналитики смен.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/10 text-xs w-full sm:w-auto mt-4 sm:mt-0">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Telegram ID</div>
              <div className="font-mono font-bold text-white">{telegramId || '—'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Shift Status Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 min-w-0">
          <div className={`p-3 rounded-xl ${todayRecord?.inTime ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
              Статус смены на сегодня ({new Date().toISOString().split('T')[0]})
            </div>
            <div className="text-sm font-bold text-slate-900 mt-0.5 flex flex-wrap items-center gap-2 break-words">
              {todayRecord?.inTime ? (
                <>
                  <span className="text-emerald-600">🟢 Приход зафиксирован: {todayRecord.inTime}</span>
                  {todayRecord.outTime && <span className="text-rose-600">| 🔴 Уход: {todayRecord.outTime}</span>}
                </>
              ) : (
                <span className="text-slate-600 whitespace-normal break-words">⚪ Отметка на сегодня ещё не сделана</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full md:w-auto min-w-0">
          <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-start gap-2 w-full">
            <Bot className="w-4 h-4 text-cyan-600 shrink-0" />
            <span className="break-words whitespace-normal flex-1">Для отметки отправьте скриншот приложения прямо в чат бота.</span>
          </div>
        </div>
      </div>

      {/* Employee Personal Individual Charts */}
      <IndividualCharts initialSurname={surname} telegramId={telegramId} allowUserSelect={false} />
    </div>
  );
};
