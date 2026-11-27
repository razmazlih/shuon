import { useState } from 'react'
import { ArrowLeft, CalendarDays, ChartNoAxesColumnIncreasing, Clock3, LogIn } from 'lucide-react'
import { login } from '../data/firebase'
import { Forest } from './Forest'
import './landing.css'

const features = [
  { icon: Clock3, title: 'רישום שעות', description: 'שעון משמרת והזנת שעות בדיעבד.' },
  { icon: CalendarDays, title: 'יומן משמרות', description: 'תכנון מראש ורישום של כמה ימי עבודה יחד.' },
  { icon: ChartNoAxesColumnIncreasing, title: 'תחזית שכר', description: 'אומדן חודשי של ברוטו, נטו ושעות נוספות.' },
]

export function Landing({ describeError }: { describeError: (error: unknown) => string }) {
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')

  const signIn = async () => {
    setSigningIn(true)
    setError('')
    try {
      await login()
    } catch (cause) {
      setError(describeError(cause))
      setSigningIn(false)
    }
  }

  return (
    <div className="landing">
      <header className="landing-header">
        <a className="brand" href="/" aria-label="שועון, דף הפתיחה">
          <img src="/fox.svg" alt="" />
          <span>שועון</span>
        </a>
      </header>
      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy">
            <p className="landing-context">יומן אישי לעובדים לפי שעה</p>
            <h1 id="landing-title">
              כמה עבדת החודש?
              <br />
              <span>כמה צפוי להיכנס?</span>
            </h1>
            <p className="landing-intro">
              רושמים את שעות העבודה, מתכננים משמרות ורואים אומדן שכר שמתעדכן יחד עם היומן.
            </p>
            <div className="landing-actions">
              <button type="button" className="landing-login" onClick={() => void signIn()} disabled={signingIn}>
                <LogIn size={18} aria-hidden="true" />
                {signingIn ? 'מתחברים…' : 'כניסה עם Google'}
              </button>
              <a className="landing-demo" href="/demo">
                התנסות בדמו <ArrowLeft size={18} aria-hidden="true" />
              </a>
            </div>
            <p className="landing-note">הדמו פתוח בלי חשבון.</p>
            {error && <p className="landing-error" role="alert">{error}</p>}
          </div>
          <div className="landing-art" aria-hidden="true">
            <Forest alert />
          </div>
        </section>
        <ul className="landing-features" aria-label="מה אפשר לעשות בשועון">
          {features.map(({ icon: Icon, title, description }) => (
            <li key={title}>
              <span className="landing-feature-icon"><Icon size={22} aria-hidden="true" /></span>
              <div>
                <h2>{title}</h2>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
