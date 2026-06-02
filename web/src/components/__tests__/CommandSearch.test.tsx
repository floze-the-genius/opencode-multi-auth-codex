import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { CommandSearch } from '../CommandSearch'

// Mock useNavigate
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: vi.fn()
  }
})

describe('CommandSearch', () => {
  const mockNavigate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(mockNavigate)
  })

  test('does not render dialog when closed', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('opens dialog with keyboard shortcut Cmd+K', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/search commands/i)).toBeInTheDocument()
  })

  test('opens dialog with keyboard shortcut Ctrl+K', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('closes dialog with Escape key', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('lists only Dashboard and Settings as top-level navigation routes', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })

    expect(screen.getByRole('option', { name: /go to dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /go to settings/i })).toBeInTheDocument()

    // Legacy routes must not appear as top-level commands
    expect(screen.queryByRole('option', { name: /go to overview/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /go to accounts/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /go to configuration/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /go to operations/i })).not.toBeInTheDocument()
  })

  test('includes antigravity route when feature flag is enabled', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: true }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })

    expect(screen.getByRole('option', { name: /go to settings.*antigravity/i })).toBeInTheDocument()
  })

  test('excludes antigravity route when feature flag is disabled', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })

    expect(screen.queryByRole('option', { name: /go to settings.*antigravity/i })).not.toBeInTheDocument()
  })

  test('navigates to selected route on click', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const settingsButton = screen.getByRole('option', { name: /go to settings/i })
    fireEvent.click(settingsButton)

    expect(mockNavigate).toHaveBeenCalledWith('/settings')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('navigates to Dashboard on Enter key (first item selected)', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const input = screen.getByLabelText(/search commands/i)
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mockNavigate).toHaveBeenCalledWith('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('filters routes based on search input', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const input = screen.getByLabelText(/search commands/i)
    fireEvent.change(input, { target: { value: 'sett' } })

    expect(screen.getByRole('option', { name: /go to settings/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /go to dashboard/i })).not.toBeInTheDocument()
  })

  test('shows keyboard shortcut hint in the trigger button', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    const trigger = screen.getByRole('button', { name: /open command search/i })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent(/cmd.*k|ctrl.*k/i)
  })

  test('clicking trigger button opens dialog', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    const trigger = screen.getByRole('button', { name: /open command search/i })
    fireEvent.click(trigger)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  test('does not open when typing k in an input field', () => {
    render(
      <MemoryRouter>
        <div>
          <input data-testid="test-input" />
          <CommandSearch featureFlags={{ antigravityEnabled: false }} />
        </div>
      </MemoryRouter>
    )

    const input = screen.getByTestId('test-input')
    fireEvent.keyDown(input, { key: 'k', metaKey: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('arrow keys navigate through options', () => {
    render(
      <MemoryRouter>
        <CommandSearch featureFlags={{ antigravityEnabled: false }} />
      </MemoryRouter>
    )

    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const input = screen.getByLabelText(/search commands/i)

    // First item (Dashboard) is selected by default
    const firstButton = screen.getByRole('option', { name: /go to dashboard/i })
    expect(firstButton).toHaveAttribute('data-selected', 'true')

    // Arrow down to second item (Settings)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const secondButton = screen.getByRole('option', { name: /go to settings/i })
    expect(secondButton).toHaveAttribute('data-selected', 'true')
    expect(firstButton).toHaveAttribute('data-selected', 'false')
  })
})
