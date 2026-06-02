import { useEffect } from 'react'
import { useNotification } from '../hooks/useNotification'
import './NotificationCenter.css'

const AUTO_DISMISS_MS = 5000

export function NotificationCenter(): JSX.Element {
  const { notifications, removeNotification } = useNotification()

  useEffect(() => {
    const timers = notifications.map(notification =>
      setTimeout(() => removeNotification(notification.id), AUTO_DISMISS_MS)
    )
    return () => {
      timers.forEach(clearTimeout)
    }
  }, [notifications, removeNotification])

  if (notifications.length === 0) {
    return <></>
  }

  return (
    <div className="notification-center" role="region" aria-label="Notifications">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`notification notification--${notification.type}`}
          role="alert"
          data-type={notification.type}
        >
          <span className="notification-message">{notification.message}</span>
          <button
            type="button"
            className="notification-dismiss"
            aria-label={`Dismiss ${notification.type} notification`}
            onClick={() => removeNotification(notification.id)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
