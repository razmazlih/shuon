import { useId, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, FIRST_CALENDAR_YEAR, LAST_CALENDAR_YEAR } from '../domain/time'
import { Dialog } from './Dialog'
import './salary-month-picker.css'

const monthName = new Intl.DateTimeFormat('he-IL', { month: 'long', timeZone: 'UTC' })
const monthAndYear = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const months = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  return { number, label: monthName.format(new Date(`2026-${number}-01T00:00:00Z`)) }
})
const yearsPerPage = 12

function YearAndMonthDialog({
  month,
  onSelect,
  onClose,
}: {
  month: string
  onSelect: (month: string) => void
  onClose: () => void
}) {
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const [yearPage, setYearPage] = useState<number | null>(null)
  const optionsId = useId()
  const yearButton = useRef<HTMLButtonElement>(null)
  const pageEnd = yearPage === null ? year : Math.min(LAST_CALENDAR_YEAR, yearPage + yearsPerPage - 1)
  const pageStart = yearPage ?? year

  function advance(direction: -1 | 1) {
    if (yearPage === null) setYear(year + direction)
    else setYearPage(yearPage + direction * yearsPerPage)
  }

  return (
    <Dialog title="בחירת חודש הדוח" className="salary-month-dialog" onClose={onClose}>
      <div className="salary-month-navigation">
        <button
          type="button"
          className="icon-btn"
          aria-label={yearPage === null ? 'לשנה הקודמת' : 'לקבוצת השנים הקודמת'}
          disabled={pageStart <= FIRST_CALENDAR_YEAR}
          onClick={() => advance(-1)}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="salary-month-year"
          ref={yearButton}
          aria-controls={optionsId}
          aria-expanded={yearPage !== null}
          aria-label={yearPage === null ? `בחירת שנה, ${year}` : `חזרה לבחירת חודש בשנת ${year}`}
          onClick={() => {
            const firstYear = Math.floor((year - FIRST_CALENDAR_YEAR) / yearsPerPage) * yearsPerPage + FIRST_CALENDAR_YEAR
            setYearPage(yearPage === null ? firstYear : null)
          }}
        >
          <span aria-live="polite">
            {yearPage === null ? year : <bdi>{pageStart}–{pageEnd}</bdi>}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={yearPage === null ? 'לשנה הבאה' : 'לקבוצת השנים הבאה'}
          disabled={pageEnd >= LAST_CALENDAR_YEAR}
          onClick={() => advance(1)}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>
      {yearPage === null ? (
        <div id={optionsId} className="salary-month-options" role="group" aria-label="חודשים">
          {months.map(({ number, label }) => {
            const value = `${String(year).padStart(4, '0')}-${number}`
            return (
              <button key={number} type="button" aria-pressed={value === month} onClick={() => onSelect(value)}>
                {label}
              </button>
            )
          })}
        </div>
      ) : (
        <div id={optionsId} className="salary-month-options" role="group" aria-label="שנים">
          {Array.from({ length: pageEnd - pageStart + 1 }, (_, index) => {
            const option = pageStart + index
            return (
              <button
                key={option}
                type="button"
                aria-pressed={option === year}
                onClick={() => {
                  setYear(option)
                  setYearPage(null)
                  yearButton.current?.focus()
                }}
              >
                {option}
              </button>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}

export function SalaryMonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const [showPicker, setShowPicker] = useState(false)
  const date = month + '-01'
  const previous = addMonths(date, -1).slice(0, 7)
  const next = addMonths(date, 1).slice(0, 7)
  const label = monthAndYear.format(new Date(date + 'T00:00:00Z'))

  return (
    <div className="salary-month-control">
      <button
        type="button"
        className="icon-btn"
        aria-label="לחודש הקודם"
        disabled={previous === month}
        onClick={() => onChange(previous)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="salary-month-trigger"
        aria-label={`חודש הדוח, ${label}`}
        aria-haspopup="dialog"
        onClick={() => setShowPicker(true)}
      >
        <span>{label}</span>
        <CalendarDays size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="לחודש הבא"
        disabled={next === month}
        onClick={() => onChange(next)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      {showPicker && (
        <YearAndMonthDialog
          month={month}
          onClose={() => setShowPicker(false)}
          onSelect={(value) => {
            onChange(value)
            setShowPicker(false)
          }}
        />
      )}
    </div>
  )
}
