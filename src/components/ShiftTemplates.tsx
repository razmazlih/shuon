import { useState, type FormEvent } from 'react'
import { Bookmark, Pencil, Plus } from 'lucide-react'
import type { Template } from '../data/model'
import { Dialog } from './Dialog'
import { TimeRange } from './TimeRange'
import './shift-templates.css'

export function ShiftTemplates({ templates, onSave }: {
  templates: Template[]
  onSave: (template: Template) => Promise<void>
}) {
  const [draft, setDraft] = useState<Template | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const existing = draft === 'new' ? null : draft

  function open(next: Template | 'new') {
    setError('')
    setNotice('')
    setDraft(next)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const values = new FormData(event.currentTarget)
    const title = String(values.get('title')).trim()
    const start = String(values.get('start'))
    const end = String(values.get('end'))

    if (!title || !start || !end || start === end) {
      setError('יש להזין שם ושעות התחלה וסיום שונות.')
      return
    }
    if (templates.some((item) => item.id !== existing?.id && item.title === title && item.start === start && item.end === end)) {
      setError('כבר קיימת תבנית עם אותו שם ואותן שעות.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({ id: existing?.id ?? crypto.randomUUID(), title, start, end })
      setDraft(null)
      setNotice('התבנית נשמרה')
    } catch {
      setError('התבנית לא נשמרה. אפשר לנסות שוב.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="prefs-card shift-templates" aria-label="תבניות משמרת">
      <div className="shift-templates-heading">
        <h2><Bookmark size={19} aria-hidden="true" /> תבניות משמרת</h2>
        <button type="button" className="prefs-secondary" onClick={() => open('new')}>
          <Plus size={17} aria-hidden="true" /> תבנית חדשה
        </button>
      </div>
      {templates.length > 0 && (
        <ul className="shift-template-list">
          {templates.map((template) => (
            <li key={template.id}>
              <button type="button" className="shift-template-row" aria-label={`עריכת תבנית: ${template.title}`} onClick={() => open(template)}>
                <span className="shift-template-copy">
                  <strong dir="auto">{template.title}</strong>
                  <small>
                    <TimeRange start={template.start} end={template.end} />
                    {template.end < template.start && ' · למחרת'}
                  </small>
                </span>
                <Pencil size={17} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="prefs-status" role="status">{notice}</p>}
      {draft && (
        <Dialog title={existing ? 'עריכת תבנית' : 'תבנית חדשה'} onClose={() => setDraft(null)} closeDisabled={saving} className="shift-template-dialog">
          <form className="prefs-form" onSubmit={submit}>
            <label className="prefs-field">
              שם התבנית
              <input name="title" defaultValue={existing?.title} maxLength={120} placeholder="למשל, משמרת לילה" required disabled={saving} />
            </label>
            <div className="prefs-grid prefs-template-times">
              <label className="prefs-field">
                שעת התחלה
                <input name="start" type="time" dir="ltr" defaultValue={existing?.start ?? '08:00'} required disabled={saving} />
              </label>
              <label className="prefs-field">
                שעת סיום
                <input name="end" type="time" dir="ltr" defaultValue={existing?.end ?? '16:00'} required disabled={saving} />
              </label>
            </div>
            {error && <p className="prefs-error" role="alert">{error}</p>}
            <div className="shift-template-actions">
              <button className="prefs-primary" type="submit" disabled={saving}>{saving ? 'בשמירה…' : 'שמירה'}</button>
              <button className="prefs-secondary" type="button" disabled={saving} onClick={() => setDraft(null)}>ביטול</button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}
