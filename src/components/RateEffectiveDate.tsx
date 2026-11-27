import { localDate } from '../domain/time'

export function RateEffectiveDate({
  date, onChange,
}: {
  date: string | null
  onChange: (date: string | null) => void
}) {
  return (
    <div className="prefs-form">
      <label className="prefs-field">
        תחולת השכר
        <select value={date === null ? 'today' : 'custom'}
          onChange={(event) => onChange(event.target.value === 'today' ? null : '')}>
          <option value="today">מהיום</option>
          <option value="custom">מתאריך מסוים</option>
        </select>
      </label>
      {date !== null && (
        <label className="prefs-field">
          תאריך תחולה
          <input type="date" required value={date} onChange={(event) => onChange(event.target.value)} />
        </label>
      )}
      {date && date < localDate(Date.now()) && (
        <p className="prefs-hint">חישובי השכר של משמרות ודוחות קיימים עשויים להתעדכן מתאריך התחולה.</p>
      )}
    </div>
  )
}
