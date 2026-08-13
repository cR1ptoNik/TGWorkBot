import React, { useState } from 'react';
import { X, Plus, LogIn, LogOut, Clock, User } from 'lucide-react';

interface AddRecordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (record: { surname: string; action: 'in' | 'out'; time: string; notes: string; date: string }) => Promise<void>;
}

export const AddRecordModal: React.FC<AddRecordModalProps> = ({ isOpen, onClose, onSave }) => {
  const [surname, setSurname] = useState('');
  const [action, setAction] = useState<'in' | 'out'>('in');
  const [time, setTime] = useState(new Date().toTimeString().split(' ')[0]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surname || !time) return;

    setSubmitting(true);
    try {
      await onSave({ surname: surname.trim(), action, time: time.trim(), notes: notes.trim(), date });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-150">
        <div className="p-4 bg-[#0F172A] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-cyan-400" />
            <h3 className="font-bold text-xs uppercase tracking-widest text-slate-100">Ручная отметка смены</h3>
          </div>
          <button
            id="close-modal-btn"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Фамилия / Имя сотрудника</label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="modal-surname-input"
                type="text"
                required
                placeholder="например: Иванов.А.В"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded focus:outline-hidden focus:border-cyan-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Действие</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                id="modal-action-in-btn"
                onClick={() => setAction('in')}
                className={`py-2 px-3 text-xs font-bold uppercase rounded border flex items-center justify-center gap-1.5 transition-all ${
                  action === 'in'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <LogIn className="w-4 h-4" />
                Приход
              </button>

              <button
                type="button"
                id="modal-action-out-btn"
                onClick={() => setAction('out')}
                className={`py-2 px-3 text-xs font-bold uppercase rounded border flex items-center justify-center gap-1.5 transition-all ${
                  action === 'out'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <LogOut className="w-4 h-4" />
                Уход
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Дата смены</label>
              <input
                id="modal-date-input"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-hidden focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Время (ЧЧ:ММ:СС)</label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="modal-time-input"
                  type="text"
                  required
                  placeholder="08:30:00"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded font-mono focus:outline-hidden focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Примечание / Причина (необязательно)</label>
            <input
              id="modal-notes-input"
              type="text"
              placeholder="например: Добавлено вручную администратором"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded focus:outline-hidden focus:border-cyan-500"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              id="cancel-modal-btn"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold uppercase text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
            >
              Отмена
            </button>
            <button
              id="submit-record-btn"
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold uppercase text-white bg-cyan-500 hover:bg-cyan-600 rounded shadow-xs"
            >
              {submitting ? 'Сохранение...' : 'Сохранить отметку'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
