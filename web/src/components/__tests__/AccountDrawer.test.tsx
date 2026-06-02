import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AccountDrawer } from '../AccountDrawer'
import type { AccountView } from '../../types/api'

const mockAccount: AccountView = {
  alias: 'alpha',
  email: 'alpha@example.com',
  enabled: true,
  usageCount: 3,
  source: 'opencode',
  tags: ['core'],
  notes: 'primary account',
  rateLimits: {
    fiveHour: { limit: 100, remaining: 80, resetAt: Date.now() + 60_000, updatedAt: Date.now() },
    weekly: { limit: 1000, remaining: 700, resetAt: Date.now() + 120_000, updatedAt: Date.now() }
  },
  limitsConfidence: 'fresh'
}

function renderDrawer(props: Partial<Parameters<typeof AccountDrawer>[0]> = {}) {
  const defaultProps = {
    account: mockAccount,
    isActive: false,
    onClose: vi.fn(),
    onToggleEnable: vi.fn(),
    onRemove: vi.fn(),
    onUpdateMeta: vi.fn(),
    onReauth: vi.fn(),
    onRefreshTokens: vi.fn(),
    onRefreshLimits: vi.fn(),
    onSwitch: vi.fn(),
    isBusy: false
  }

  return render(<AccountDrawer {...defaultProps} {...props} />)
}

describe('AccountDrawer', () => {
  test('renders account details', () => {
    renderDrawer()

    expect(screen.getByRole('dialog', { name: /account details/i })).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('alpha@example.com')).toBeInTheDocument()
  })

  test('closes on Escape key press', () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('moves focus to close button when opened', () => {
    renderDrawer()

    const closeButton = screen.getByRole('button', { name: /close drawer/i })
    expect(closeButton).toHaveFocus()
  })

  test('shows confirmation before remove and calls onRemove when confirmed', () => {
    const onRemove = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderDrawer({ onRemove })

    const removeButton = screen.getByRole('button', { name: /remove account/i })
    fireEvent.click(removeButton)

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('alpha'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  test('cancels remove when confirmation is declined', () => {
    const onRemove = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderDrawer({ onRemove })

    const removeButton = screen.getByRole('button', { name: /remove account/i })
    fireEvent.click(removeButton)

    expect(window.confirm).toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
  })

  test('disables all action buttons when busy', () => {
    renderDrawer({ isBusy: true })

    const buttons = screen.getAllByRole('button')
    const actionButtons = buttons.filter(b => !b.getAttribute('aria-label')?.includes('close'))

    actionButtons.forEach(button => {
      expect(button).toBeDisabled()
    })
  })

  test('calls onToggleEnable when enable/disable button is clicked', () => {
    const onToggleEnable = vi.fn()
    renderDrawer({ onToggleEnable })

    const toggleButton = screen.getByRole('button', { name: /disable/i })
    fireEvent.click(toggleButton)

    expect(onToggleEnable).toHaveBeenCalledTimes(1)
  })

  test('calls onSwitch when switch button is clicked for non-active account', () => {
    const onSwitch = vi.fn()
    renderDrawer({ onSwitch, isActive: false })

    const switchButton = screen.getByRole('button', { name: /switch to this account/i })
    fireEvent.click(switchButton)

    expect(onSwitch).toHaveBeenCalledTimes(1)
  })

  test('calls onUseInCodex when use-in-Codex button is clicked', () => {
    const onUseInCodex = vi.fn()
    renderDrawer({ onUseInCodex })

    fireEvent.click(screen.getByRole('button', { name: /use in codex/i }))

    expect(onUseInCodex).toHaveBeenCalledTimes(1)
  })

  test('shows use-in-Codex success and error feedback', () => {
    const { rerender } = renderDrawer({
      onUseInCodex: vi.fn(),
      useInCodexSuccess: true
    })

    expect(screen.getByText(/codex account updated/i)).toBeInTheDocument()

    rerender(
      <AccountDrawer
        account={mockAccount}
        isActive={false}
        onClose={vi.fn()}
        onToggleEnable={vi.fn()}
        onRemove={vi.fn()}
        onUpdateMeta={vi.fn()}
        onReauth={vi.fn()}
        onRefreshTokens={vi.fn()}
        onRefreshLimits={vi.fn()}
        onSwitch={vi.fn()}
        onUseInCodex={vi.fn()}
        useInCodexError="Account cannot be used in Codex"
        isBusy={false}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Account cannot be used in Codex')
  })

  test('hides switch button when account is already active', () => {
    renderDrawer({ isActive: true })

    expect(screen.queryByRole('button', { name: /switch to this account/i })).not.toBeInTheDocument()
  })

  test('calls onUpdateMeta with edited tags and notes', () => {
    const onUpdateMeta = vi.fn()
    renderDrawer({ onUpdateMeta })

    const tagsInput = screen.getByLabelText(/tags/i)
    const notesInput = screen.getByLabelText(/notes/i)
    const saveButton = screen.getByRole('button', { name: /save tags & notes/i })

    fireEvent.change(tagsInput, { target: { value: 'new-tag, another' } })
    fireEvent.change(notesInput, { target: { value: 'updated notes' } })
    fireEvent.click(saveButton)

    expect(onUpdateMeta).toHaveBeenCalledWith('new-tag, another', 'updated notes')
  })

  test('calls onReauth when re-authenticate button is clicked', () => {
    const onReauth = vi.fn()
    renderDrawer({ onReauth })

    const reauthButton = screen.getByRole('button', { name: /re-authenticate/i })
    fireEvent.click(reauthButton)

    expect(onReauth).toHaveBeenCalledTimes(1)
  })

  test('calls onRefreshTokens when refresh tokens button is clicked', () => {
    const onRefreshTokens = vi.fn()
    renderDrawer({ onRefreshTokens })

    const refreshButton = screen.getByRole('button', { name: /refresh tokens/i })
    fireEvent.click(refreshButton)

    expect(onRefreshTokens).toHaveBeenCalledTimes(1)
  })

  test('calls onRefreshLimits when refresh limits button is clicked', () => {
    const onRefreshLimits = vi.fn()
    renderDrawer({ onRefreshLimits })

    const refreshButton = screen.getByRole('button', { name: /refresh limits/i })
    fireEvent.click(refreshButton)

    expect(onRefreshLimits).toHaveBeenCalledTimes(1)
  })

  test('closes when overlay is clicked', () => {
    const onClose = vi.fn()
    const { container } = renderDrawer({ onClose })

    const overlay = container.querySelector('.account-drawer-overlay')
    if (!overlay) throw new Error('Overlay not found')
    fireEvent.click(overlay)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('does not close when drawer content is clicked', () => {
    const onClose = vi.fn()
    renderDrawer({ onClose })

    const drawer = screen.getByRole('dialog')
    fireEvent.click(drawer)

    expect(onClose).not.toHaveBeenCalled()
  })
})
