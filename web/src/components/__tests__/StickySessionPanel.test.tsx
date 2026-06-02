import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { StickySessionPanel } from '../StickySessionPanel'
import type { StickySessionSettings, StickySessionStatus, StickySessionCleanupResponse } from '../../types/api'

const mockConfig: StickySessionSettings = {
  enabled: true,
  identitySources: [
    'header:x-session-affinity',
    'header:session-id',
    'header:session_id',
    'header:conversation_id',
    'body:metadata.session_id',
    'body:metadata.conversation_id'
  ],
  allowPromptCacheKey: false,
  ttlMs: 86_400_000,
  maxEntries: 1000,
  maxFileBytes: 1_048_576,
  updatedAt: Date.now(),
  updatedBy: 'test-suite'
}

const mockStatus: StickySessionStatus = {
  ok: true,
  entries: 2,
  path: '/tmp/sticky-sessions.json',
  exists: true,
  ttlMs: 86_400_000,
  maxEntries: 1000,
  maxFileBytes: 1_048_576,
  sizeBytes: 2048,
  updatedAt: Date.now()
}

const mockCleanup: StickySessionCleanupResponse = {
  ok: true,
  before: 2,
  after: 1,
  removed: 1,
  prunedAt: Date.now()
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false }
    }
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

describe('StickySessionPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('renders sticky session configuration section', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /sticky sessions/i })).toBeInTheDocument()
    )
  })

  test('does not show duplicate enablement toggle inside panel', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Panel should show identity sources, not a duplicate enable toggle
      expect(screen.getByTestId('identity-sources-fieldset')).toBeInTheDocument()
    })

    // The old standalone enable toggle should be gone
    const enableToggle = screen.queryByRole('checkbox', { name: /enable sticky sessions/i })
    expect(enableToggle).not.toBeInTheDocument()
  })

  test('shows identity source checkboxes', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByLabelText(/header:x-session-affinity/i)).toBeInTheDocument()
    )

    expect(screen.getByLabelText(/header:session-id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/header:session_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/header:conversation_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/body:metadata\.session_id/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/body:metadata\.conversation_id/i)).toBeInTheDocument()
  })

  test('shows TTL, max entries, and max file size inputs', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByLabelText(/ttl/i)).toBeInTheDocument()
    )

    expect(screen.getByLabelText(/max entries/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/max file size/i)).toBeInTheDocument()
  })

  test('shows advanced allowPromptCacheKey as unchecked by default', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /show advanced/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /show advanced/i }))

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /allow prompt cache key/i })).toBeInTheDocument()
    )

    const advancedToggle = screen.getByRole('checkbox', { name: /allow prompt cache key/i })
    expect(advancedToggle).not.toBeChecked()
  })

  test('shows current status with entries count', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByText(/2 entries/i)).toBeInTheDocument()
    )

    expect(screen.getByText(/2\.0 KB/i)).toBeInTheDocument()
  })

  test('shows cleanup button', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /run cleanup/i })).toBeInTheDocument()
    )
  })

  test('shows refresh status button', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /refresh status/i })).toBeInTheDocument()
    )
  })

  test('displays cleanup result after manual cleanup', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockCleanup), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...mockStatus, entries: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /run cleanup/i })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /run cleanup/i }))

    await waitFor(() =>
      expect(screen.getByText(/removed 1 entries/i)).toBeInTheDocument()
    )
  })

  test('shows save button for configuration changes', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockConfig), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )

    render(<StickySessionPanel />, { wrapper: createWrapper() })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save configuration/i })).toBeInTheDocument()
    )
  })
})
