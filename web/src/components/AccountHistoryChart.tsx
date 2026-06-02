import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { toRechartsData, formatVelocity } from '../lib/account-history'
import type { HistoryPoint } from '../lib/account-history'
import type { RateLimitWindow } from '../types/api'
import './AccountHistoryChart.css'

interface AccountHistoryChartProps {
  history: HistoryPoint[]
  type: 'fiveHour' | 'weekly'
  currentWindow?: RateLimitWindow
  velocity?: number | null
  resetAt?: number
}

function formatChartTime(at: number): string {
  const d = new Date(at)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatChartDate(at: number): string {
  const d = new Date(at)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function getChartDomain(data: Array<{ pct: number }>): [number, number] {
  const values = data.map((point) => point.pct)
  if (values.length === 0) return [0, 100]

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  const padding = range < 2 ? 2 : Math.max(2, Math.ceil(range * 0.3))
  const lower = Math.max(0, Math.floor(min - padding))
  const upper = Math.min(100, Math.ceil(max + padding))

  if (upper - lower >= 4) {
    return [lower, upper]
  }

  if (upper === 100) {
    return [Math.max(0, upper - 4), upper]
  }

  return [lower, Math.min(100, lower + 4)]
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ payload: { at: number; pct: number } }>
  type: 'fiveHour' | 'weekly'
  currentWindow?: RateLimitWindow
  velocity?: number | null
  resetAt?: number
  history: HistoryPoint[]
}

function CustomTooltipContent({
  active,
  payload,
  type,
  currentWindow,
  velocity,
  resetAt,
  history
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  const dataPoint = payload[0]?.payload as { at: number; pct: number } | undefined
  if (!dataPoint) return null

  const shortLabel = type === 'fiveHour' ? '5h' : '7d'
  const otherKey = type === 'fiveHour' ? 'weeklyPct' : 'fiveHourPct'
  const otherPct = history.find((h) => h.at === dataPoint.at)?.[otherKey] ?? null

  return (
    <div className="account-history-chart__tooltip">
      <div className="account-history-chart__tooltip-header">
        <span className="account-history-chart__tooltip-type">{shortLabel}</span>
        <span className="account-history-chart__tooltip-time">
          {formatChartDate(dataPoint.at)} {formatChartTime(dataPoint.at)}
        </span>
      </div>
      <div className="account-history-chart__tooltip-body">
        <div className="account-history-chart__tooltip-row">
          <span className="account-history-chart__tooltip-label">Remaining</span>
          <span className="account-history-chart__tooltip-value">{dataPoint.pct}%</span>
        </div>
        {otherPct !== null && (
          <div className="account-history-chart__tooltip-row">
            <span className="account-history-chart__tooltip-label">
              {type === 'fiveHour' ? '7d' : '5h'} remaining
            </span>
            <span className="account-history-chart__tooltip-value">{otherPct}%</span>
          </div>
        )}
        {currentWindow && typeof currentWindow.remaining === 'number' && typeof currentWindow.limit === 'number' && (
          <div className="account-history-chart__tooltip-row">
            <span className="account-history-chart__tooltip-label">Used</span>
            <span className="account-history-chart__tooltip-value">
              {currentWindow.limit - currentWindow.remaining} / {currentWindow.limit}
            </span>
          </div>
        )}
        {typeof velocity === 'number' && (
          <div className="account-history-chart__tooltip-row">
            <span className="account-history-chart__tooltip-label">Velocity</span>
            <span className="account-history-chart__tooltip-value">{formatVelocity(velocity)}</span>
          </div>
        )}
        {resetAt && resetAt > 0 && (
          <div className="account-history-chart__tooltip-row">
            <span className="account-history-chart__tooltip-label">Reset</span>
            <span className="account-history-chart__tooltip-value">
              {formatChartTime(resetAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export function AccountHistoryChart({
  history,
  type,
  currentWindow,
  velocity,
  resetAt
}: AccountHistoryChartProps): JSX.Element {
  const data = useMemo(() => toRechartsData(history, type), [history, type])
  const yDomain = useMemo(() => getChartDomain(data), [data])

  const label = type === 'fiveHour' ? '5-hour consumption history' : 'Weekly consumption history'
  const shortLabel = type === 'fiveHour' ? '5h' : '7d'
  const strokeColor = type === 'fiveHour' ? '#3b82f6' : '#8b5cf6'
  const gradientId = `area-gradient-${type}`

  if (data.length < 2) {
    return (
      <div className="account-history-chart account-history-chart--empty" role="img" aria-label={label}>
        <div className="account-history-chart__empty">
          <span className="account-history-chart__empty-label">{shortLabel}</span>
          <span className="account-history-chart__empty-text">Insufficient history</span>
        </div>
      </div>
    )
  }

  return (
    <div className="account-history-chart" role="img" aria-label={label}>
      <div className="account-history-chart__header">
        <span className="account-history-chart__header-label">{shortLabel}</span>
        {typeof velocity === 'number' && (
          <span className="account-history-chart__header-velocity">{formatVelocity(velocity)}</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 8, left: 2, bottom: 0 }}
          accessibilityLayer
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={strokeColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-subtle)"
            vertical={false}
          />
          <XAxis
            dataKey="at"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => formatChartTime(v)}
            stroke="var(--text-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={{ stroke: 'var(--border-subtle)' }}
            minTickGap={24}
          />
          <YAxis
            domain={yDomain}
            stroke="var(--text-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
            width={34}
          />
          <Tooltip
            content={
              <CustomTooltipContent
                type={type}
                currentWindow={currentWindow}
                velocity={velocity}
                resetAt={resetAt}
                history={history}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="pct"
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: strokeColor, stroke: '#fff', strokeWidth: 1.5 }}
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
