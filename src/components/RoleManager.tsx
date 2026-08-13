import React, { useState } from 'react';
import { Users, Shield, Plus, Trash2, CheckCircle2, UserPlus } from 'lucide-react';
import { RoleMap } from '../types';

interface RoleManagerProps {
  roles: RoleMap | null;
  onUpdateRole: (surname: string, role: string, telegram_id: number) => Promise<void>;
  onDeleteRole: (surname: string) => Promise<void>;
}

export const RoleManager: React.FC<RoleManagerProps> = ({ roles, onUpdateRole, onDeleteRole }) => {
  const [surname, setSurname] = useState('');
  const [role, setRole] = useState('admin');
  const [telegramId, setTelegramId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surname || !telegramId) return;

    setSubmitting(true);
    setMsg(null);
    try {
      await onUpdateRole(surname.trim(), role, Number(telegramId));
      setSurname('');
      setTelegramId('');
      setMsg(`Обновлена роль для ${surname}: ${role === 'admin' ? 'Администратор' : 'Сотрудник'}`);
    } catch (e: any) {
      setMsg(`Ошибка при сохранении роли: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const renderRoleSection = (title: string, roleKey: 'creator' | 'admin' | 'user', badgeClass: string) => {
    const list = roles ? roles[roleKey] || {} : {};
    const entries = Object.entries(list);

    return (
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-500"></span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">{title}</h3>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${badgeClass}`}>
            {entries.length} человек
          </span>
        </div>

        <div className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-2 font-mono">Нет пользователей в данной категории.</p>
          ) : (
            entries.map(([userSurname, id]) => (
              <div key={userSurname} id={`role-user-${userSurname}`} className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-200/80 text-xs">
                <div>
                  <p className="font-bold text-slate-900">{userSurname}</p>
                  <p className="text-[10px] font-mono text-slate-400">Telegram ID: {id}</p>
                </div>
                {roleKey !== 'creator' && (
                  <button
                    id={`delete-role-btn-${userSurname}`}
                    onClick={() => onDeleteRole(userSurname)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                    title="Отозвать доступ"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  return (
    <div id="role-manager-section" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Assign Role Form */}
      <div className="lg:col-span-5">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <h2 className="text-xs font-bold text-slate-600 uppercase tracking-widest mb-1 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-cyan-600" />
            Назначение ролей и прав
          </h2>
          <p className="text-xs text-slate-500 mb-5">
            Регистрация фамилий сотрудников и их Telegram ID для управления доступом.
          </p>

          {msg && (
            <div className="p-3 mb-4 bg-cyan-50 border border-cyan-200 text-slate-800 rounded text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-600 shrink-0" />
              {msg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Фамилия / Псевдоним сотрудника</label>
              <input
                id="role-surname-input"
                type="text"
                required
                placeholder="например: Иванов.А.В"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded text-slate-900 focus:outline-hidden focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Уровень доступа (Роль)</label>
              <select
                id="role-tier-select"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded text-slate-900 bg-white focus:outline-hidden focus:border-cyan-500"
              >
                <option value="admin">Администратор (Полный доступ к админке и боту)</option>
                <option value="user">Сотрудник (Отметка смен)</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Telegram User ID</label>
              <input
                id="role-telegram-id-input"
                type="number"
                required
                placeholder="например: 123456789"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded text-slate-900 font-mono focus:outline-hidden focus:border-cyan-500"
              />
            </div>

            <button
              id="save-role-btn"
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 bg-cyan-500 hover:bg-cyan-600 text-white font-bold uppercase tracking-wider rounded text-xs flex items-center justify-center gap-2 shadow-xs transition-colors mt-2"
            >
              <Plus className="w-4 h-4" />
              {submitting ? 'Сохранение...' : 'Сохранить права доступа'}
            </button>
          </form>
        </div>
      </div>

      {/* Role Lists */}
      <div className="lg:col-span-7 space-y-4">
        {renderRoleSection('Администраторы', 'admin', 'bg-cyan-100 text-cyan-800')}
        {renderRoleSection('Зарегистрированные сотрудники', 'user', 'bg-slate-100 text-slate-800')}
      </div>
    </div>
  );
};
