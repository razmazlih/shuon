import { useState, type FormEvent } from 'react'
import type { PayrollProfile } from '../domain/net'
import { NumberField, readNumber } from './PayrollNumberField'
import './salary.css'

export function PayrollSettings({ profile, onSave }: {
  profile: PayrollProfile
  onSave: (profile: PayrollProfile) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSaving(true)
    setStatus('')
    try {
      await onSave({
        ...profile,
        creditPoints: readNumber(data, 'creditPoints'),
        pensionPercent: readNumber(data, 'pensionPercent'),
        capPension: data.has('capPension'),
      })
      setStatus('פרטי השכר נשמרו')
    } catch {
      setStatus('שמירת פרטי השכר נכשלה. אפשר לנסות שוב.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="prefs-card prefs-pay-tools salary-settings">
      <summary>פרטי שכר וניכויים</summary>
      <form className="salary-form" onSubmit={submit}>
        <p className="salary-help">
          שאלון השכר משמש לאומדן הראשוני. אם בתלוש מופיעים ערכים אחרים, אפשר לעדכן אותם כאן לכל החודשים.
        </p>
        <div className="salary-grid">
          <NumberField name="creditPoints" title="נקודות זיכוי" value={profile.creditPoints} hint="לפי התלוש" />
          <NumberField
            name="pensionPercent"
            title="הפרשת עובד לפנסיה (%)"
            value={profile.pensionPercent}
            max={100}
            hint="לפי התלוש"
          />
        </div>
        <label className="salary-check">
          <input key={String(profile.capPension)} type="checkbox" name="capPension" defaultChecked={profile.capPension} /> החלת תקרת פנסיית חובה
          (13,769 ₪ בחודש בשנת 2026)
        </label>
        <div className="salary-actions">
          <button className="salary-primary" type="submit" disabled={saving}>
            {saving ? 'בשמירה…' : 'שמירת פרטי שכר'}
          </button>
          <span role="status">{status}</span>
        </div>
      </form>
    </details>
  )
}
