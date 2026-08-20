import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { StatsCards } from './components/StatsCards';
import { AttendanceTable } from './components/AttendanceTable';
import { OcrSimulator } from './components/OcrSimulator';
import { AuditLogsView } from './components/AuditLogsView';
import { RoleManager } from './components/RoleManager';
import { ScheduleManager } from './components/ScheduleManager';
import { BotCodeReview } from './components/BotCodeReview';
import { IndividualCharts } from './components/IndividualCharts';
import { EmployeeWebAppView } from './components/EmployeeWebAppView';
import { AddRecordModal } from './components/AddRecordModal';
import { ShiftRecord, AuditLog, RoleMap, SystemStats, ScheduleConfig } from './types';
import { apiFetch } from './lib/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('attendance');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [records, setRecords] = useState<ShiftRecord[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [roles, setRoles] = useState<RoleMap | null>(null);
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const [botCode, setBotCode] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);

  // Telegram WebApp & User Role State
  const [userProfile, setUserProfile] = useState<{
    role: string;
    surname: string | null;
    telegram_id: number | null;
    is_webapp: boolean;
  }>({
    role: 'admin',
    surname: null,
    telegram_id: null,
    is_webapp: false,
  });

  const [viewMode, setViewMode] = useState<'admin' | 'employee'>('admin');

  // Detect Telegram WebApp user
  useEffect(() => {
    // @ts-ignore
    const initData = window.Telegram?.WebApp?.initData;
    
    // Check if we are running outside Telegram
    if (!initData) {
      // Dev mode bypass for AI Studio preview
      if (window.location.hostname.includes('localhost') || window.location.hostname.includes('run.app')) {
        console.warn("Running in preview mode without Telegram Init Data");
      } else {
        setAccessDenied(true);
        return;
      }
    }
    
    // @ts-ignore
    if (window.Telegram?.WebApp?.ready) {
      // @ts-ignore
      window.Telegram.WebApp.ready();
    }

    apiFetch(`/api/user-me`)
      .then((res) => {
        if (!res.ok) throw new Error("Access Denied");
        return res.json();
      })
      .then((profile) => {
        if (profile) {
          setUserProfile(profile);
          // If user role is non-admin user, default to employee view
          if (profile.role === 'user') {
            setViewMode('employee');
          }
        }
      })
      .catch((err) => {
        console.error('Error identifying WebApp user:', err);
        setAccessDenied(true);
      });
  }, []);

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
        <div className="bg-white p-6 md:p-8 rounded-2xl shadow-xl border border-slate-200 text-center max-w-md w-full">
          <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Доступ запрещен</h1>
          <p className="text-sm text-slate-500">
            Пожалуйста, откройте эту панель управления через официального Telegram бота. 
            Прямой доступ из браузера закрыт в целях безопасности.
          </p>
        </div>
      </div>
    );
  }

  // Fetch all initial data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, recordsRes, logsRes, rolesRes, codeRes, scheduleRes] = await Promise.all([
        apiFetch('/api/stats'),
        apiFetch('/api/records'),
        apiFetch('/api/logs'),
        apiFetch('/api/roles'),
        apiFetch('/api/bot-code'),
        apiFetch('/api/schedule'),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (recordsRes.ok) {
        const data = await recordsRes.json();
        setRecords(data.records || []);
      }
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs || []);
      }
      if (rolesRes.ok) setRoles(await rolesRes.json());
      if (codeRes.ok) {
        const data = await codeRes.json();
        setBotCode(data.code || '');
      }
      if (scheduleRes.ok) {
        setSchedule(await scheduleRes.json());
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddManualRecord = async (recordData: {
    surname: string;
    action: 'in' | 'out';
    time: string;
    notes: string;
    date: string;
    bypass_honesty?: boolean;
  }) => {
    try {
      const res = await apiFetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData),
      });
      const data = await res.json();
      if (!res.ok) {
        return {
          success: false,
          error: data.error || 'Ошибка при сохранении отметки',
          is_honesty_error: !!data.is_honesty_error,
        };
      }
      fetchData();
      return { success: true };
    } catch (e: any) {
      console.error('Error adding record:', e);
      return { success: false, error: e.message || 'Сетевая ошибка' };
    }
  };

  const handleAddOcrRecord = async (ocrData: {
    surname: string;
    time: string;
    action: 'in' | 'out';
    time_line: string;
    raw_text: string;
  }) => {
    try {
      const res = await apiFetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surname: ocrData.surname,
          action: ocrData.action,
          time: ocrData.time,
          notes: ocrData.raw_text,
          date: new Date().toISOString().split('T')[0],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Ошибка при сохранении OCR отметки');
        return;
      }
      fetchData();
      setActiveTab('attendance');
    } catch (e) {
      console.error('Error adding OCR record:', e);
    }
  };

  const handleDeleteRecord = async (id: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту отметку смены?')) return;
    // Optimistically update UI
    setRecords((prev) => prev.filter((r) => r.id !== id));
    setStats((prev) => (prev ? { ...prev, total_records: Math.max(0, prev.total_records - 1) } : null));

    try {
      const res = await apiFetch(`/api/records/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error('Error deleting record:', e);
      fetchData();
    }
  };

  const handleBatchDeleteRecords = async (ids: number[]) => {
    const idSet = new Set(ids);
    // Optimistically update UI
    setRecords((prev) => prev.filter((r) => !idSet.has(r.id)));
    setStats((prev) => (prev ? { ...prev, total_records: Math.max(0, prev.total_records - ids.length) } : null));

    try {
      const res = await apiFetch('/api/records/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error('Error batch deleting records:', e);
      fetchData();
    }
  };

  const handleClearAllRecords = async () => {
    // Optimistically update UI
    setRecords([]);
    setStats((prev) => (prev ? { ...prev, total_records: 0, today_total_marks: 0, today_checked_in: 0, today_checked_out: 0 } : null));

    try {
      const res = await apiFetch('/api/records/clear', {
        method: 'POST',
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error('Error clearing all records:', e);
      fetchData();
    }
  };

  const handleUpdateRole = async (surname: string, role: string, telegram_id: number) => {
    const res = await apiFetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surname, role, telegram_id }),
    });
    if (res.ok) {
      fetchData();
    } else {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка при обновлении роли');
    }
  };

  const handleDeleteRole = async (surname: string) => {
    if (!confirm(`Вы уверены, что хотите отозвать права доступа у сотрудника ${surname}?`)) return;
    const res = await apiFetch(`/api/roles/${surname}`, { method: 'DELETE' });
    if (res.ok) {
      fetchData();
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Вы уверены, что хотите очистить системные логи аудита?')) return;
    const res = await apiFetch('/api/logs/clear', { method: 'POST' });
    if (res.ok) {
      fetchData();
    }
  };

  return (
    <div className="flex min-h-screen w-full max-w-[100vw] bg-[#F8FAFC] font-sans text-slate-900 antialiased overflow-x-hidden">
      {/* Sidebar (Admin View Only) */}
      {viewMode === 'admin' && (
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          stats={stats}
          mobileOpen={mobileSidebarOpen}
          setMobileOpen={setMobileSidebarOpen}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 min-h-screen w-full max-w-full overflow-x-hidden">
        {/* Header */}
        <Header
          stats={stats}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          onRefresh={fetchData}
          setMobileOpen={setMobileSidebarOpen}
          activeTab={activeTab}
          userRole={userProfile.role}
          userSurname={userProfile.surname}
          viewMode={viewMode}
          setViewMode={setViewMode}
          isWebApp={userProfile.is_webapp}
        />

        {/* Employee WebApp View Mode vs Admin Dashboard View Mode */}
        {viewMode === 'employee' ? (
          <EmployeeWebAppView
            surname={userProfile.surname || 'Смирнов.Д.А'}
            telegramId={userProfile.telegram_id}
            role={userProfile.role}
          />
        ) : (
          /* Admin Inner Canvas Area */
          <section className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl w-full mx-auto">
            {/* Stat Metric Cards */}
            <StatsCards stats={stats} />

            {/* Active Tab View */}
            {activeTab === 'attendance' && (
              <AttendanceTable
                records={records}
                schedule={schedule}
                loading={loading}
                onRefresh={fetchData}
                onOpenAddModal={() => setIsAddModalOpen(true)}
                onDeleteRecord={handleDeleteRecord}
                onBatchDeleteRecords={handleBatchDeleteRecords}
                onClearAllRecords={handleClearAllRecords}
              />
            )}

            {activeTab === 'analytics' && <IndividualCharts />}

            {activeTab === 'ocr' && (
              <OcrSimulator onAddRecordFromOcr={handleAddOcrRecord} />
            )}

            {activeTab === 'logs' && (
              <AuditLogsView
                logs={logs}
                loading={loading}
                onRefreshLogs={fetchData}
                onClearLogs={handleClearLogs}
              />
            )}

            {activeTab === 'roles' && (
              <RoleManager
                roles={roles}
                onUpdateRole={handleUpdateRole}
                onDeleteRole={handleDeleteRole}
                onRefreshAll={fetchData}
              />
            )}

            {activeTab === 'schedule' && <ScheduleManager onScheduleUpdated={fetchData} />}

            {activeTab === 'code' && (
              <BotCodeReview botCode={botCode} />
            )}
          </section>
        )}

        {/* Geometric Balance Footer */}
        <footer className="h-12 flex-none border-t border-slate-200 px-4 sm:px-8 flex items-center justify-between text-[10px] text-slate-400 font-medium uppercase tracking-widest bg-white mt-auto">
          <span>Системное время: {new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</span>
          <div className="flex gap-4">
            <span className="hidden sm:inline font-mono">База данных: shift_attendance.db</span>
            <span className="text-emerald-500 font-bold flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              Синхронизация активна
            </span>
          </div>
        </footer>
      </main>

      {/* Manual Record Modal */}
      <AddRecordModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleAddManualRecord}
      />
    </div>
  );
}
