import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotificationProvider } from '../../hooks/useNotification'
import { NotificationCenter } from '../NotificationCenter'
import type { NotificationInput } from '../../hooks/useNotification'

describe('NotificationCenter', () => {
  test('renders empty when no notifications', () => {
    render(
      <NotificationProvider>
        <NotificationCenter />
      </NotificationProvider>
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('renders notifications from context', () => {
    const notifications: NotificationInput[] = [
      { message: 'Test message', type: 'info' }
    ]

    render(
      <NotificationProvider initialNotifications={notifications}>
        <NotificationCenter />
      </NotificationProvider>
    )

    expect(screen.getByText('Test message')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveAttribute('data-type', 'info')
  })

  test('can dismiss a notification', () => {
    const notifications: NotificationInput[] = [
      { message: 'Test message', type: 'info' }
    ]

    render(
      <NotificationProvider initialNotifications={notifications}>
        <NotificationCenter />
      </NotificationProvider>
    )

    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissButton)

    expect(screen.queryByText('Test message')).not.toBeInTheDocument()
  })

  test('auto-dismisses notifications after timeout', async () => {
    const notifications: NotificationInput[] = [
      { message: 'Auto dismiss message', type: 'success' }
    ]

    render(
      <NotificationProvider initialNotifications={notifications}>
        <NotificationCenter />
      </NotificationProvider>
    )

    expect(screen.getByText('Auto dismiss message')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText('Auto dismiss message')).not.toBeInTheDocument()
    }, { timeout: 6000 })
  }, 10000)

  test('limits max notifications to 5', () => {
    const notifications: NotificationInput[] = Array.from({ length: 7 }, (_, i) => ({
      message: `Message ${i + 1}`,
      type: 'info' as const
    }))

    render(
      <NotificationProvider initialNotifications={notifications}>
        <NotificationCenter />
      </NotificationProvider>
    )

    const alerts = screen.getAllByRole('alert')
    expect(alerts.length).toBe(5)
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument()
    expect(screen.getByText('Message 6')).toBeInTheDocument()
    expect(screen.getByText('Message 7')).toBeInTheDocument()
  })
})
