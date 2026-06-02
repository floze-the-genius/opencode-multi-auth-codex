import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AccountHistoryChart } from '../AccountHistoryChart'
import type { HistoryPoint } from '../../lib/account-history'

function createPoints(type: 'fiveHour' | 'weekly'): HistoryPoint[] {
  const now = Date.now()
  return [
    { at: now - 3600_000, fiveHourPct: type === 'fiveHour' ? 80 : 70, weeklyPct: type === 'weekly' ? 80 : 70 },
    { at: now - 1800_000, fiveHourPct: type === 'fiveHour' ? 60 : 65, weeklyPct: type === 'weekly' ? 60 : 65 },
    { at: now, fiveHourPct: type === 'fiveHour' ? 40 : 60, weeklyPct: type === 'weekly' ? 40 : 60 }
  ]
}

describe('AccountHistoryChart', () => {
  test('renders accessible chart region with aria-label', () => {
    const points = createPoints('fiveHour')
    render(<AccountHistoryChart history={points} type="fiveHour" />)

    const chart = screen.getByRole('img', { name: /5-hour consumption history/i })
    expect(chart).toBeInTheDocument()
  })

  test('renders Recharts responsive container', () => {
    const points = createPoints('fiveHour')
    render(<AccountHistoryChart history={points} type="fiveHour" />)

    // Recharts ResponsiveContainer renders with this class in jsdom
    const container = document.querySelector('.recharts-responsive-container')
    expect(container).toBeInTheDocument()
  })

  test('shows empty state when history has fewer than 2 valid points', () => {
    render(<AccountHistoryChart history={[]} type="fiveHour" />)

    expect(screen.getByText(/insufficient history/i)).toBeInTheDocument()
  })

  test('shows empty state when all values are null', () => {
    const points: HistoryPoint[] = [
      { at: Date.now() - 3600_000, fiveHourPct: null, weeklyPct: null },
      { at: Date.now(), fiveHourPct: null, weeklyPct: null }
    ]
    render(<AccountHistoryChart history={points} type="fiveHour" />)

    expect(screen.getByText(/insufficient history/i)).toBeInTheDocument()
  })

  test('renders chart header with window label', () => {
    const points = createPoints('fiveHour')
    render(<AccountHistoryChart history={points} type="fiveHour" />)

    expect(screen.getByText('5h')).toBeInTheDocument()
  })

  test('renders velocity in header when provided', () => {
    const points = createPoints('fiveHour')
    render(<AccountHistoryChart history={points} type="fiveHour" velocity={-20} />)

    expect(screen.getByText(/−20%\/h/)).toBeInTheDocument()
  })

  test('weekly chart has distinct accessible label', () => {
    const points = createPoints('weekly')
    render(<AccountHistoryChart history={points} type="weekly" />)

    const chart = screen.getByRole('img', { name: /weekly consumption history/i })
    expect(chart).toBeInTheDocument()
  })

  test('weekly chart renders 7d header label', () => {
    const points = createPoints('weekly')
    render(<AccountHistoryChart history={points} type="weekly" />)

    expect(screen.getByText('7d')).toBeInTheDocument()
  })
})
