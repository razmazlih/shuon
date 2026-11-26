import type { PaySettings, Shift } from '../domain/gross'
import { defaultPayrollProfile, type PayrollAdjustment, type PayrollProfile } from '../domain/net'
import { addDays, localDate, localToInstant, weekday } from '../domain/time'

export interface WorkShift extends Shift {
  title: string
  status: 'planned' | 'completed' | 'active'
  breaks: { start: string; end: string; paid?: boolean }[]
  updatedAt: string
  openBreak?: string | null
}

export function shiftStatusAt(shift: WorkShift, now: number): WorkShift['status'] {
  if (shift.status === 'active') return 'active'
  return Date.parse(shift.end) <= now ? 'completed' : 'planned'
}

export type Theme = 'light' | 'dark' | 'sage' | 'system'
export interface UserProfile {
  pay: PaySettings
  theme: Theme
  questionnaire?: Record<string, string>
  onboarded: boolean
}
export interface Template {
  id: string
  title: string
  start: string
  end: string
}
export interface Workspace {
  profile: UserProfile
  payroll: PayrollProfile
  adjustments: PayrollAdjustment[]
  templates: Template[]
  shifts: WorkShift[]
}
export const defaultPay: PaySettings = {
  hourlyRate: 50,
  workDays: 5,
  shortDay: 4,
  restDay: 6,
  restStart: '12:00',
  restEnd: '24:00',
  holidayCalendar: 'israel-jewish',
  nightPremiumPercent: 0,
}
export function freshWorkspace(): Workspace {
  return {
    profile: { pay: { ...defaultPay }, onboarded: false, theme: 'light' },
    payroll: defaultPayrollProfile(),
    adjustments: [],
    shifts: [],
    templates: [
      { id: 'morning', title: 'משמרת בוקר', start: '08:00', end: '16:00' },
      { id: 'evening', title: 'משמרת ערב', start: '15:00', end: '22:00' },
    ],
  }
}
export function demoWorkspace(): Workspace {
  const state = freshWorkspace()
  const today = localDate(Date.now())
  state.profile = { ...state.profile, onboarded: true, pay: { ...defaultPay, hourlyRate: 52 } }
  state.payroll = { ...state.payroll, creditPoints: 2.25, pensionPercent: 6 }
  for (let offset = -30; offset <= 11; offset++) {
    const date = addDays(today, offset)
    const dow = weekday(date)
    if (dow === 5 || dow === 6 || offset === 0 || offset % 8 === -1) continue
    const evening = dow === 2 || dow === 4
    const night = dow === 3 && offset % 2 === 0
    const start = localToInstant(date, night ? '21:00' : evening ? '15:00' : '08:00')
    const end = localToInstant(night ? addDays(date, 1) : date, night ? '05:00' : evening ? '22:00' : '16:00')
    state.shifts.push({
      id: 'demo-' + date,
      title: night ? 'משמרת לילה' : evening ? 'משמרת ערב' : 'משמרת בוקר',
      status: offset > 0 ? 'planned' : 'completed',
      start,
      end,
      updatedAt: start,
      breaks: [],
    })
  }
  return state
}
export const formatMoney = (n: number, digits = 0) =>
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n)
export const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('he-IL', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
export const hourCount = (hours: number) =>
  new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(hours)
