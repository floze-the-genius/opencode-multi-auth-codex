import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNotification, NotificationProvider } from '../useNotification'

describe('useNotification', () => {
  test('returns empty notifications initially', () => {
    const { result } = renderHook(() => useNotification(), {
      wrapper: NotificationProvider
    })

    expect(result.current.notifications).toEqual([])
  })

  test('can add a notification', () => {
    const { result } = renderHook(() => useNotification(), {
      wrapper: NotificationProvider
    })

    act(() => {
      result.current.addNotification({ message: 'Test notification', type: 'info' })
    })

    expect(result.current.notifications).toHaveLength(1)
    expect(result.current.notifications[0].message).toBe('Test notification')
    expect(result.current.notifications[0].type).toBe('info')
    expect(result.current.notifications[0].id).toBeDefined()
  })

  test('can remove a notification by id', () => {
    const { result } = renderHook(() => useNotification(), {
      wrapper: NotificationProvider
    })

    act(() => {
      result.current.addNotification({ message: 'To be removed', type: 'success' })
    })

    const id = result.current.notifications[0].id

    act(() => {
      result.current.removeNotification(id)
    })

    expect(result.current.notifications).toHaveLength(0)
  })

  test('supports multiple notification types', () => {
    const { result } = renderHook(() => useNotification(), {
      wrapper: NotificationProvider
    })

    act(() => {
      result.current.addNotification({ message: 'Info', type: 'info' })
      result.current.addNotification({ message: 'Success', type: 'success' })
      result.current.addNotification({ message: 'Warning', type: 'warning' })
      result.current.addNotification({ message: 'Error', type: 'error' })
    })

    expect(result.current.notifications).toHaveLength(4)
    expect(result.current.notifications.map(n => n.type)).toEqual(['info', 'success', 'warning', 'error'])
  })
})
