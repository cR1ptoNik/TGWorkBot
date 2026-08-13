import React, { useState, useEffect } from 'react';
import { Clock, Bell, CheckCircle2, Save } from 'lucide-react';
import { ScheduleConfig } from '../types';
import { apiFetch } from '../lib/api';

export const ScheduleManager: React.FC = () => {
  const [schedule, setSchedule] = useState<ScheduleConfig>({
    shift_start: '09:00',
    shift_end: '18:00',
    tz_offset_hours: 3,
    remind_before_start_minutes: 5,
    remind_after_end_minutes: 5,
    enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/schedule')
      .then((res) => res.json())
      .then((data) => {
        if (data) setSchedule(data);
      })
      .catch((err) => console.error('Failed fetching schedule:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      const data = await res.json();
      if (data.success) {
        setMsg('Shift schedule and auto-reminder settings saved successfully!');
      }
    } catch (e: any) {
      setMsg(`Error saving schedule: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-slate-400">Загрузка настроек графика...</div>;
  }

  return (
    <div id="schedule-manager-card" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-600" />
            График смен и авто-напоминания
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Автоматические уведомления в Telegram отправляются до начала и после окончания смены, если отметка отсутствует.
          </p>
        </div>
        <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${schedule.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
          {schedule.enabled ? 'Напоминания активны' : 'Отключены'}
        </span>
      </div>

      {msg && (
        <div className="p-3 mb-4 bg-cyan-50 border border-cyan-200 text-slate-800 rounded text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-600 shrink-0" />
          {msg}
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
            Время начала смены (ЧЧ:ММ)
          </label>
          <input
            type="text"
            value={schedule.shift_start}
            onChange={(e) => setSchedule({ ...schedule, shift_start: e.target.value })}
            placeholder="09:00"
            className="w-full px-3 py-2 border border-slate-200 rounded font-mono text-slate-900 focus:outline-hidden focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
            Время конца смены (ЧЧ:ММ)
          </label>
          <input
            type="text"
            value={schedule.shift_end}
            onChange={(e) => setSchedule({ ...schedule, shift_end: e.target.value })}
            placeholder="18:00"
            className="w-full px-3 py-2 border border-slate-200 rounded font-mono text-slate-900 focus:outline-hidden focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
            Напомнить до начала (минут)
          </label>
          <input
            type="number"
            value={schedule.remind_before_start_minutes}
            onChange={(e) => setSchedule({ ...schedule, remind_before_start_minutes: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-slate-200 rounded font-mono text-slate-900 focus:outline-hidden focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
            Напомнить после конца (минут)
          </label>
          <input
            type="number"
            value={schedule.remind_after_end_minutes}
            onChange={(e) => setSchedule({ ...schedule, remind_after_end_minutes: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-slate-200 rounded font-mono text-slate-900 focus:outline-hidden focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
            Часовой пояс (смещение от UTC, часов)
          </label>
          <input
            type="number"
            value={schedule.tz_offset_hours}
            onChange={(e) => setSchedule({ ...schedule, tz_offset_hours: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-slate-200 rounded font-mono text-slate-900 focus:outline-hidden focus:border-cyan-500"
          />
        </div>

        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer py-2">
            <input
              type="checkbox"
              checked={schedule.enabled}
              onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
              className="w-4 h-4 text-cyan-600 rounded border-slate-300 focus:ring-cyan-500"
            />
            <span className="text-xs font-bold text-slate-700">Включить авто-напоминания в Telegram</span>
          </label>
        </div>

        <div className="md:col-span-2 lg:col-span-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="py-2.5 px-5 bg-slate-900 hover:bg-slate-800 text-white font-bold uppercase text-xs rounded tracking-wider flex items-center gap-2 transition-colors shadow-xs"
          >
            <Save className="w-4 h-4 text-cyan-400" />
            {saving ? 'Сохранение...' : 'Сохранить настройки графика'}
          </button>
        </div>
      </form>
    </div>
  );
};
