import React, { useState, useEffect } from 'react';
import {
  Clock,
  Bell,
  CheckCircle2,
  Save,
  Globe,
  Calendar,
  Palmtree,
  Sparkles,
  Check,
  X,
  AlertCircle,
  Users,
  Shield,
  Coffee,
  Briefcase
} from 'lucide-react';
import { ScheduleConfig, RoleMap, EmployeeScheduleItem } from '../types';
import { apiFetch, triggerHaptic } from '../lib/api';

const TIMEZONE_PRESETS = [
  { label: 'UTC+2 (Калининград)', offset: 2 },
  { label: 'UTC+3 (Москва, СПб, Минск)', offset: 3 },
  { label: 'UTC+4 (Самара, Баку, Тбилиси)', offset: 4 },
  { label: 'UTC+5 (Екатеринбург, Ташкент)', offset: 5 },
  { label: 'UTC+6 (Омск, Астана, Алматы)', offset: 6 },
  { label: 'UTC+7 (Новосибирск, Красноярск)', offset: 7 },
  { label: 'UTC+8 (Иркутск, Улан-Батор)', offset: 8 },
  { label: 'UTC+9 (Якутск, Чита, Токио)', offset: 9 },
  { label: 'UTC+10 (Владивосток, Хабаровск)', offset: 10 },
  { label: 'UTC+11 (Магадан, Сахалин)', offset: 11 },
  { label: 'UTC+12 (Камчатка, Чукотка)', offset: 12 },
  { label: 'UTC+0 (Гринвич / Лондон)', offset: 0 },
  { label: 'UTC+1 (Берлин, Париж, Варшава)', offset: 1 },
];

const DAYS_OF_WEEK = [
  { id: 1, short: 'Пн', full: 'Понедельник', weekend: false },
  { id: 2, short: 'Вт', full: 'Вторник', weekend: false },
  { id: 3, short: 'Ср', full: 'Среда', weekend: false },
  { id: 4, short: 'Чт', full: 'Четверг', weekend: false },
  { id: 5, short: 'Пт', full: 'Пятница', weekend: false },
  { id: 6, short: 'Сб', full: 'Суббота', weekend: true },
  { id: 7, short: 'Вс', full: 'Воскресенье', weekend: true },
];

interface ScheduleManagerProps {
  onScheduleUpdated?: () => void;
}

export const ScheduleManager: React.FC<ScheduleManagerProps> = ({ onScheduleUpdated }) => {
  const [schedule, setSchedule] = useState<ScheduleConfig>({
    shift_start: '09:00',
    shift_end: '18:00',
    tz_offset_hours: 3,
    remind_before_start_minutes: 5,
    remind_after_end_minutes: 5,
    enabled: true,
    employee_schedules: {},
  });

  const [roles, setRoles] = useState<RoleMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingEmployee, setSavingEmployee] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [currentLocalTime, setCurrentLocalTime] = useState<string>('');

  // Vacation Modal State
  const [vacationModalUser, setVacationModalUser] = useState<string | null>(null);
  const [vacationStartDate, setVacationStartDate] = useState<string>('');
  const [vacationEndDate, setVacationEndDate] = useState<string>('');

  const loadData = async () => {
    try {
      const [schedRes, rolesRes] = await Promise.all([
        apiFetch('/api/schedule'),
        apiFetch('/api/roles'),
      ]);

      if (schedRes.ok) {
        const sData = await schedRes.json();
        if (sData) setSchedule(sData);
      }
      if (rolesRes.ok) {
        const rData = await rolesRes.json();
        if (rData) setRoles(rData);
      }
    } catch (err) {
      console.error('Failed loading schedule or roles data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Live clock calculation based on timezone
  useEffect(() => {
    const updateTime = () => {
      const offset = typeof schedule.tz_offset_hours === 'number' ? schedule.tz_offset_hours : 3;
      const now = new Date();
      const utc = now.getTime() + now.getTimezoneOffset() * 60000;
      const targetDate = new Date(utc + offset * 3600000);
      setCurrentLocalTime(
        targetDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
          ` (${targetDate.toLocaleDateString('ru-RU')})`
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [schedule.tz_offset_hours]);

  // Today's ISO date (YYYY-MM-DD) and ISO day of week (1..7) based on timezone
  const getTodayContext = () => {
    const offset = typeof schedule.tz_offset_hours === 'number' ? schedule.tz_offset_hours : 3;
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const targetDate = new Date(utc + offset * 3600000);
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    const jsDay = targetDate.getDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    return { todayStr, isoDay, dateObj: targetDate };
  };

  const { todayStr, isoDay } = getTodayContext();

  // Save General Schedule Settings
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGeneral(true);
    setMsg(null);
    try {
      const res = await apiFetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      const data = await res.json();
      if (data.success) {
        triggerHaptic('success');
        setMsg(`Общие настройки графика компании сохранены!`);
        if (onScheduleUpdated) onScheduleUpdated();
      }
    } catch (e: any) {
      triggerHaptic('error');
      setMsg(`Ошибка сохранения: ${e.message}`);
    } finally {
      setSavingGeneral(false);
    }
  };

  // Toggle single day checkbox for employee
  const handleToggleDay = (surname: string, dayId: number) => {
    const currentEmpSchedules = { ...(schedule.employee_schedules || {}) };
    const empConfig = currentEmpSchedules[surname] || { work_days: [1, 2, 3, 4, 5] };
    const currentDays = empConfig.work_days || [1, 2, 3, 4, 5];

    let updatedDays: number[];
    if (currentDays.includes(dayId)) {
      updatedDays = currentDays.filter((d) => d !== dayId);
    } else {
      updatedDays = [...currentDays, dayId].sort((a, b) => a - b);
    }

    const updatedEmpConfig: EmployeeScheduleItem = {
      ...empConfig,
      work_days: updatedDays,
    };

    const newSchedule = {
      ...schedule,
      employee_schedules: {
        ...currentEmpSchedules,
        [surname]: updatedEmpConfig,
      },
    };

    setSchedule(newSchedule);
    saveEmployeeSchedule(surname, updatedEmpConfig);
  };

  // Preset buttons (5/2, 2/2, All days, Clear)
  const handleApplyPreset = (surname: string, presetType: '5_2' | '2_2' | 'all' | 'clear') => {
    const currentEmpSchedules = { ...(schedule.employee_schedules || {}) };
    const empConfig = currentEmpSchedules[surname] || { work_days: [1, 2, 3, 4, 5] };

    let newDays: number[] = [];
    if (presetType === '5_2') newDays = [1, 2, 3, 4, 5];
    if (presetType === '2_2') newDays = [1, 2, 5, 6];
    if (presetType === 'all') newDays = [1, 2, 3, 4, 5, 6, 7];
    if (presetType === 'clear') newDays = [];

    const updatedEmpConfig: EmployeeScheduleItem = {
      ...empConfig,
      work_days: newDays,
    };

    const newSchedule = {
      ...schedule,
      employee_schedules: {
        ...currentEmpSchedules,
        [surname]: updatedEmpConfig,
      },
    };

    setSchedule(newSchedule);
    saveEmployeeSchedule(surname, updatedEmpConfig);
  };

  // API Call to save single employee schedule
  const saveEmployeeSchedule = async (surname: string, empConfig: EmployeeScheduleItem) => {
    setSavingEmployee(surname);
    try {
      const res = await apiFetch('/api/schedule/employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surname,
          work_days: empConfig.work_days,
          vacation_start: empConfig.vacation_start,
          vacation_end: empConfig.vacation_end,
          shift_start: empConfig.shift_start,
          shift_end: empConfig.shift_end,
        }),
      });
      if (res.ok) {
        triggerHaptic('success');
        if (onScheduleUpdated) onScheduleUpdated();
      }
    } catch (err) {
      console.error('Failed saving employee schedule:', err);
    } finally {
      setSavingEmployee(null);
    }
  };

  // Open Vacation Modal for employee
  const handleOpenVacationModal = (surname: string) => {
    const empConfig = schedule.employee_schedules?.[surname];
    setVacationModalUser(surname);
    if (empConfig?.vacation_start && empConfig?.vacation_end) {
      setVacationStartDate(empConfig.vacation_start);
      setVacationEndDate(empConfig.vacation_end);
    } else {
      setVacationStartDate(todayStr);
      // Default to 14 days ahead
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + 14);
      const yyyy = nextDate.getFullYear();
      const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
      const dd = String(nextDate.getDate()).padStart(2, '0');
      setVacationEndDate(`${yyyy}-${mm}-${dd}`);
    }
  };

  // Set Vacation Preset (e.g. +7 days, +14 days, +28 days)
  const handleSetVacationPresetDays = (days: number) => {
    const start = vacationStartDate || todayStr;
    const sDate = new Date(start);
    sDate.setDate(sDate.getDate() + days - 1);
    const yyyy = sDate.getFullYear();
    const mm = String(sDate.getMonth() + 1).padStart(2, '0');
    const dd = String(sDate.getDate()).padStart(2, '0');
    setVacationEndDate(`${yyyy}-${mm}-${dd}`);
  };

  // Save Vacation Dates
  const handleSaveVacationModal = async () => {
    if (!vacationModalUser) return;
    if (!vacationStartDate || !vacationEndDate) {
      alert('Пожалуйста, укажите дату начала и окончания отпуска.');
      return;
    }
    if (vacationStartDate > vacationEndDate) {
      alert('Дата начала отпуска не может быть позже даты окончания.');
      return;
    }

    try {
      const res = await apiFetch('/api/schedule/employee/vacation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surname: vacationModalUser,
          vacation_start: vacationStartDate,
          vacation_end: vacationEndDate,
        }),
      });
      if (res.ok) {
        triggerHaptic('success');
        const data = await res.json();
        if (data.schedule) setSchedule(data.schedule);
        setVacationModalUser(null);
        if (onScheduleUpdated) onScheduleUpdated();
      }
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    }
  };

  // 1-Click Clear/End Vacation
  const handleClearVacation = async (surname: string) => {
    try {
      const res = await apiFetch('/api/schedule/employee/vacation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surname,
          clear: true,
        }),
      });
      if (res.ok) {
        triggerHaptic('success');
        const data = await res.json();
        if (data.schedule) setSchedule(data.schedule);
        if (onScheduleUpdated) onScheduleUpdated();
      }
    } catch (err) {
      console.error('Failed clearing vacation:', err);
    }
  };

  // Compile list of all employees from roles
  const allEmployees: Array<{ surname: string; role: 'admin' | 'user'; telegramId: number }> = [];
  if (roles) {
    if (roles.admin) {
      Object.entries(roles.admin).forEach(([sName, id]) => {
        allEmployees.push({ surname: sName, role: 'admin', telegramId: Number(id) });
      });
    }
    if (roles.user) {
      Object.entries(roles.user).forEach(([sName, id]) => {
        allEmployees.push({ surname: sName, role: 'user', telegramId: Number(id) });
      });
    }
  }

  // Helper to get status of employee for today
  const getEmployeeStatus = (surname: string) => {
    const empConfig = schedule.employee_schedules?.[surname] || { work_days: [1, 2, 3, 4, 5] };
    const vacStart = empConfig.vacation_start;
    const vacEnd = empConfig.vacation_end;
    const workDays = empConfig.work_days || [1, 2, 3, 4, 5];

    const isVacation = Boolean(vacStart && vacEnd && vacStart <= todayStr && todayStr <= vacEnd);
    const isWorkDay = workDays.includes(isoDay);

    return {
      isVacation,
      isWorkDay,
      vacStart,
      vacEnd,
      workDays,
    };
  };

  if (loading) {
    return <div className="p-6 text-xs text-slate-400">Загрузка данных расписания и сотрудников...</div>;
  }

  return (
    <div className="space-y-6">
      {/* 1. General Company Shift Settings Card */}
      <div id="general-schedule-card" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-600" />
              Общие параметры смен и часовой пояс
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Базовые рабочие часы компании и часовой пояс для точного подсчёта времени и отправки напоминаний.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-cyan-50 border border-cyan-200 text-cyan-900 px-3 py-1 rounded text-xs font-mono font-bold flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
              <span>{currentLocalTime || '...'}</span>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${
                schedule.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {schedule.enabled ? 'Напоминания активны' : 'Отключены'}
            </span>
          </div>
        </div>

        {msg && (
          <div className="p-3 mb-4 bg-cyan-50 border border-cyan-200 text-slate-800 rounded text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-600 shrink-0" />
            {msg}
          </div>
        )}

        <form onSubmit={handleSaveGeneral} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">
              Время начала смены по умолчанию
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
              Время конца смены по умолчанию
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
            <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1 flex items-center justify-between">
              <span>Часовой пояс компании</span>
              <span className="text-cyan-600 font-mono font-bold">
                UTC{schedule.tz_offset_hours >= 0 ? `+${schedule.tz_offset_hours}` : schedule.tz_offset_hours}
              </span>
            </label>
            <select
              value={schedule.tz_offset_hours}
              onChange={(e) => setSchedule({ ...schedule, tz_offset_hours: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-slate-200 rounded text-slate-900 focus:outline-hidden focus:border-cyan-500 bg-white"
            >
              {TIMEZONE_PRESETS.map((tz) => (
                <option key={tz.offset} value={tz.offset}>
                  {tz.label}
                </option>
              ))}
            </select>
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

          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer py-2">
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
                className="w-4 h-4 text-cyan-600 rounded border-slate-300 focus:ring-cyan-500"
              />
              <span className="text-xs font-bold text-slate-700">Включить общие авто-напоминания</span>
            </label>
          </div>

          <div className="md:col-span-2 lg:col-span-3 pt-2 flex items-center justify-between">
            <button
              type="submit"
              disabled={savingGeneral}
              className="py-2.5 px-5 bg-slate-900 hover:bg-slate-800 text-white font-bold uppercase text-xs rounded tracking-wider flex items-center gap-2 transition-colors shadow-xs"
            >
              <Save className="w-4 h-4 text-cyan-400" />
              {savingGeneral ? 'Сохранение...' : 'Сохранить общие настройки'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. Individual Employee Schedules & Vacations Card */}
      <div id="individual-schedule-card" className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-600" />
              Индивидуальные смены и отпуска сотрудников
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Отмечайте галочками рабочие дни для каждого сотрудника. В выходные дни и во время отпуска бот не будет присылать уведомления.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium">
              Всего сотрудников: <strong className="text-slate-800">{allEmployees.length}</strong>
            </span>
          </div>
        </div>

        {allEmployees.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
            <p className="text-xs text-slate-500 font-medium">
              Нет зарегистрированных сотрудников. Добавьте сотрудников во вкладке «Роли и доступ».
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {allEmployees.map((emp) => {
              const status = getEmployeeStatus(emp.surname);
              const isSaving = savingEmployee === emp.surname;

              return (
                <div
                  key={emp.surname}
                  id={`employee-schedule-row-${emp.surname}`}
                  className={`p-4 rounded-xl border transition-all duration-200 ${
                    status.isVacation
                      ? 'bg-amber-50/50 border-amber-200'
                      : status.isWorkDay
                      ? 'bg-white border-slate-200 hover:border-cyan-300 shadow-2xs'
                      : 'bg-slate-50/60 border-slate-200'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Employee Info & Status Badge */}
                    <div className="min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900">{emp.surname}</span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            emp.role === 'admin' ? 'bg-cyan-100 text-cyan-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {emp.role === 'admin' ? 'Админ' : 'Сотрудник'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-mono text-slate-400">TG ID: {emp.telegramId}</span>
                        {/* Realtime today status pill */}
                        {status.isVacation ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                            <Palmtree className="w-3 h-3 text-amber-600" />
                            В отпуске
                          </span>
                        ) : status.isWorkDay ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <Briefcase className="w-3 h-3 text-emerald-600" />
                            Сегодня смена
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                            <Coffee className="w-3 h-3 text-slate-500" />
                            Сегодня выходной
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Day-of-week Checkboxes with Labels */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                          Рабочие дни недели:
                        </span>
                        {/* Quick Presets for this user */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleApplyPreset(emp.surname, '5_2')}
                            className="px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:text-cyan-700 bg-slate-100 hover:bg-cyan-50 rounded transition-colors"
                            title="Понедельник — Пятница"
                          >
                            5/2 (Пн–Пт)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyPreset(emp.surname, '2_2')}
                            className="px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:text-cyan-700 bg-slate-100 hover:bg-cyan-50 rounded transition-colors"
                            title="Сменный график 2/2"
                          >
                            2/2
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyPreset(emp.surname, 'all')}
                            className="px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:text-cyan-700 bg-slate-100 hover:bg-cyan-50 rounded transition-colors"
                            title="Все 7 дней"
                          >
                            Все
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyPreset(emp.surname, 'clear')}
                            className="px-2 py-0.5 text-[10px] font-bold text-slate-400 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded transition-colors"
                            title="Снять все дни"
                          >
                            Очистить
                          </button>
                        </div>
                      </div>

                      {/* Checkboxes Row */}
                      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                        {DAYS_OF_WEEK.map((day) => {
                          const isChecked = status.workDays.includes(day.id);
                          const isToday = day.id === isoDay;

                          return (
                            <label
                              key={day.id}
                              className={`relative flex flex-col items-center justify-center p-2 rounded-lg border cursor-pointer select-none transition-all ${
                                isChecked
                                  ? day.weekend
                                    ? 'bg-indigo-50/80 border-indigo-300 text-indigo-900 font-bold'
                                    : 'bg-cyan-50/80 border-cyan-400 text-cyan-950 font-bold'
                                  : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                              } ${isToday ? 'ring-2 ring-cyan-500 ring-offset-1' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleDay(emp.surname, day.id)}
                                className="sr-only"
                              />
                              <div className="flex items-center gap-1">
                                <span className="text-xs">{day.short}</span>
                                {isChecked && <Check className="w-3 h-3 text-cyan-600 shrink-0" />}
                              </div>
                              <span className="text-[9px] uppercase tracking-tighter mt-0.5 opacity-70">
                                {day.weekend ? 'вых' : 'раб'}
                              </span>
                              {isToday && (
                                <span className="absolute -top-1.5 -right-1 bg-cyan-600 text-white text-[8px] font-extrabold px-1 rounded-full shadow-2xs">
                                  сегодня
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Vacation Controls */}
                    <div className="lg:w-72 flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-slate-200 pt-3 lg:pt-0 lg:pl-4">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">
                        Отпуск сотрудника:
                      </span>

                      {status.vacStart && status.vacEnd ? (
                        <div className="space-y-2">
                          <div className="bg-amber-100/70 border border-amber-300 text-amber-950 px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between">
                            <div>
                              <div className="font-bold flex items-center gap-1 text-[11px]">
                                <Palmtree className="w-3.5 h-3.5 text-amber-700" />
                                {status.vacStart} — {status.vacEnd}
                              </div>
                              <div className="text-[10px] text-amber-800">
                                {status.isVacation ? '🏖 Сейчас в отпуске (тишина)' : 'Запланирован'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleClearVacation(emp.surname)}
                              className="p-1 text-amber-700 hover:text-rose-600 hover:bg-amber-200 rounded transition-colors"
                              title="Завершить / снять отпуск"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleOpenVacationModal(emp.surname)}
                            className="w-full py-1 text-[11px] font-semibold text-slate-600 hover:text-cyan-700 hover:bg-slate-100 rounded border border-slate-200 transition-colors"
                          >
                            Изменить даты отпуска
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            id={`set-vacation-btn-${emp.surname}`}
                            onClick={() => handleOpenVacationModal(emp.surname)}
                            className="flex-1 py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                          >
                            <Palmtree className="w-3.5 h-3.5 text-amber-600" />
                            Установить отпуск
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Vacation Date Picker Modal */}
      {vacationModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                  <Palmtree className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Установка отпуска</h3>
                  <p className="text-xs text-slate-500 font-mono">Сотрудник: {vacationModalUser}</p>
                </div>
              </div>
              <button
                onClick={() => setVacationModalUser(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-4">
              В период отпуска Telegram-бот автоматически отключит утренние и вечерние напоминания для этого сотрудника.
            </p>

            {/* Quick Presets */}
            <div className="mb-4">
              <label className="block text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1.5">
                Быстрый выбор длительности:
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleSetVacationPresetDays(7)}
                  className="py-1.5 px-2 bg-slate-100 hover:bg-amber-50 hover:text-amber-900 hover:border-amber-300 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors"
                >
                  7 дней (1 нед.)
                </button>
                <button
                  type="button"
                  onClick={() => handleSetVacationPresetDays(14)}
                  className="py-1.5 px-2 bg-slate-100 hover:bg-amber-50 hover:text-amber-900 hover:border-amber-300 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors"
                >
                  14 дней (2 нед.)
                </button>
                <button
                  type="button"
                  onClick={() => handleSetVacationPresetDays(28)}
                  className="py-1.5 px-2 bg-slate-100 hover:bg-amber-50 hover:text-amber-900 hover:border-amber-300 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors"
                >
                  28 дней (мес.)
                </button>
              </div>
            </div>

            {/* Custom Date Range Pickers */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">
                  Дата начала (с)
                </label>
                <input
                  type="date"
                  value={vacationStartDate}
                  onChange={(e) => setVacationStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:border-amber-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-1">
                  Дата окончания (по)
                </label>
                <input
                  type="date"
                  value={vacationEndDate}
                  onChange={(e) => setVacationEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:border-amber-500 bg-white"
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setVacationModalUser(null)}
                className="py-2 px-4 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSaveVacationModal}
                className="py-2 px-5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Check className="w-4 h-4" />
                Сохранить отпуск
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
