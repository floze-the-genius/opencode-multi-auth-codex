import { useState, useCallback } from 'react'
import {
  useStartAuthMutation,
  useStartAutoLoginMutation,
  useAddAutoLoginAccountMutation
} from '../api/queries'
import { useNotification } from '../hooks/useNotification'
import type { AutoLoginConfigState } from '../types/api'
import './CreateAccountModal.css'

export interface CreateAccountModalProps {
  autoLogin: AutoLoginConfigState
  onClose: () => void
}

export function CreateAccountModal({ autoLogin, onClose }: CreateAccountModalProps): JSX.Element {
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [alias, setAlias] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [chatgptPassword, setChatgptPassword] = useState('')
  const [selectedAutoLogin, setSelectedAutoLogin] = useState('')

  const { addNotification } = useNotification()
  const startAuthMutation = useStartAuthMutation()
  const startAutoLoginMutation = useStartAutoLoginMutation()
  const addAutoLoginAccountMutation = useAddAutoLoginAccountMutation()

  const enabledAutoLoginAccounts = autoLogin?.accounts?.filter((a) => a.enabled !== false) ?? []

  const handleManualAdd = useCallback(() => {
    if (!alias.trim()) return
    startAuthMutation.mutate(alias.trim(), {
      onSuccess: (data) => {
        addNotification({ message: `Login started for ${alias.trim()}`, type: 'info' })
        if (data.url) {
          window.open(data.url, '_blank')
        }
        onClose()
      },
      onError: (err: Error) => {
        addNotification({ message: err.message, type: 'error' })
      }
    })
  }, [alias, startAuthMutation, addNotification, onClose])

  const handleAutoLoginStart = useCallback(() => {
    if (!selectedAutoLogin) return
    startAutoLoginMutation.mutate(
      { selector: selectedAutoLogin },
      {
        onSuccess: () => {
          addNotification({ message: `Auto-login started for ${selectedAutoLogin}`, type: 'info' })
          onClose()
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      }
    )
  }, [selectedAutoLogin, startAutoLoginMutation, addNotification, onClose])

  const handleAddAutoLoginAccount = useCallback(() => {
    if (!email.trim() || !password.trim()) return
    addAutoLoginAccountMutation.mutate(
      { email: email.trim(), password: password.trim(), chatgptPassword: chatgptPassword.trim() || undefined },
      {
        onSuccess: () => {
          addNotification({ message: `Auto-login account ${email.trim()} added`, type: 'success' })
          setEmail('')
          setPassword('')
          setChatgptPassword('')
        },
        onError: (err: Error) => {
          addNotification({ message: err.message, type: 'error' })
        }
      }
    )
  }, [email, password, chatgptPassword, addAutoLoginAccountMutation, addNotification])

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-label="Create account">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Create account</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close modal">
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="mode-tabs">
            <button
              type="button"
              className={mode === 'manual' ? 'active' : ''}
              onClick={() => setMode('manual')}
            >
              Manual login
            </button>
            <button
              type="button"
              className={mode === 'auto' ? 'active' : ''}
              onClick={() => setMode('auto')}
            >
              Auto-login
            </button>
          </div>

          {mode === 'manual' && (
            <div className="modal-section">
              <label>
                Alias
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="e.g., acc8"
                />
              </label>
              <button
                type="button"
                onClick={handleManualAdd}
                disabled={!alias.trim() || startAuthMutation.isPending}
              >
                {startAuthMutation.isPending ? 'Starting...' : 'Start login'}
              </button>
            </div>
          )}

          {mode === 'auto' && (
            <div className="modal-section">
              {autoLogin?.configured && enabledAutoLoginAccounts.length > 0 && (
                <>
                  <label>
                    Existing auto-login account
                    <select
                      value={selectedAutoLogin}
                      onChange={(e) => setSelectedAutoLogin(e.target.value)}
                    >
                      <option value="">Select account...</option>
                      {enabledAutoLoginAccounts.map((acc) => (
                        <option key={acc.email} value={acc.email}>
                          {acc.alias} - {acc.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={handleAutoLoginStart}
                    disabled={!selectedAutoLogin || startAutoLoginMutation.isPending}
                  >
                    {startAutoLoginMutation.isPending ? 'Starting...' : 'Start auto-login'}
                  </button>
                  <hr />
                </>
              )}

              <h4>Add new auto-login credentials</h4>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                />
              </label>
              <label>
                ChatGPT password (optional)
                <input
                  type="password"
                  value={chatgptPassword}
                  onChange={(e) => setChatgptPassword(e.target.value)}
                  placeholder="ChatGPT password"
                />
              </label>
              <button
                type="button"
                onClick={handleAddAutoLoginAccount}
                disabled={!email.trim() || !password.trim() || addAutoLoginAccountMutation.isPending}
              >
                {addAutoLoginAccountMutation.isPending ? 'Adding...' : 'Add credentials'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
