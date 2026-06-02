import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
  id: string
  message: string
  type: NotificationType
}

export interface NotificationInput {
  message: string
  type: NotificationType
}

export interface NotificationContextValue {
  notifications: Notification[]
  addNotification: (input: NotificationInput) => void
  removeNotification: (id: string) => void
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined)

let nextId = 1
function generateId(): string {
  return `notification-${nextId++}`
}

export interface NotificationProviderProps {
  children: ReactNode
  initialNotifications?: NotificationInput[]
}

const MAX_NOTIFICATIONS = 5

export function NotificationProvider({ children, initialNotifications = [] }: NotificationProviderProps): JSX.Element {
  const [notifications, setNotifications] = useState<Notification[]>(() => {
    const mapped = initialNotifications.map(n => ({ ...n, id: generateId() }))
    if (mapped.length > MAX_NOTIFICATIONS) {
      return mapped.slice(mapped.length - MAX_NOTIFICATIONS)
    }
    return mapped
  })

  const addNotification = useCallback((input: NotificationInput) => {
    const notification: Notification = { ...input, id: generateId() }
    setNotifications(prev => {
      const next = [...prev, notification]
      if (next.length > MAX_NOTIFICATIONS) {
        return next.slice(next.length - MAX_NOTIFICATIONS)
      }
      return next
    })
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const value = useMemo(
    () => ({ notifications, addNotification, removeNotification }),
    [notifications, addNotification, removeNotification]
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotification(): NotificationContextValue {
  const context = useContext(NotificationContext)
  if (context === undefined) {
    throw new Error('useNotification must be used within a NotificationProvider')
  }
  return context
}
