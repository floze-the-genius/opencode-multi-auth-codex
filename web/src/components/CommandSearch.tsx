import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FeatureFlags } from '../types/api'
import './CommandSearch.css'

export interface CommandSearchProps {
  featureFlags: FeatureFlags
}

interface CommandItem {
  label: string
  path: string
  keywords: string[]
}

export function CommandSearch({ featureFlags }: CommandSearchProps): JSX.Element {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const baseCommands: CommandItem[] = [
    { label: 'Dashboard', path: '/', keywords: ['dashboard', 'home', 'overview', 'accounts', 'operations', 'tokens', 'logs', 'queue'] },
    { label: 'Settings', path: '/settings', keywords: ['settings', 'configuration', 'config', 'prefs'] }
  ]

  const commands = featureFlags.antigravityEnabled
    ? [...baseCommands, { label: 'Settings / Antigravity', path: '/settings/antigravity', keywords: ['antigravity', 'anti', 'gravity', 'settings'] }]
    : baseCommands

  const filteredCommands = query.trim()
    ? commands.filter(cmd =>
        cmd.keywords.some(k => k.toLowerCase().includes(query.toLowerCase())) ||
        cmd.label.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  const handleOpen = useCallback(() => {
    setIsOpen(true)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  const handleSelect = useCallback((path: string) => {
    navigate(path)
    handleClose()
  }, [navigate, handleClose])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Open with Cmd+K or Ctrl+K, but not when typing in an input
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const target = event.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return
        }
        event.preventDefault()
        handleOpen()
        return
      }

      if (!isOpen) return

      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          handleClose()
          break
        case 'ArrowDown':
          event.preventDefault()
          setSelectedIndex(prev =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          event.preventDefault()
          setSelectedIndex(prev =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          break
        case 'Enter':
          event.preventDefault()
          if (filteredCommands[selectedIndex]) {
            handleSelect(filteredCommands[selectedIndex].path)
          }
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex, handleOpen, handleClose, handleSelect])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  return (
    <>
      <button
        type="button"
        className="command-search-trigger"
        aria-label="Open command search"
        onClick={handleOpen}
      >
        <span className="command-search-trigger-icon" aria-hidden="true">⌘</span>
        <span className="command-search-trigger-text">Search...</span>
        <kbd className="command-search-trigger-kbd">Ctrl K</kbd>
      </button>

      {isOpen && (
        <div
          className="command-search-overlay"
          role="dialog"
          aria-label="Command search"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose()
          }}
        >
          <div className="command-search-dialog">
            <div className="command-search-input-wrapper">
              <span className="command-search-input-icon" aria-hidden="true">🔍</span>
              <input
                ref={inputRef}
                type="text"
                className="command-search-input"
                placeholder="Type a command or search..."
                aria-label="Search commands"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="command-search-list" role="listbox" aria-label="Available commands">
              {filteredCommands.length === 0 ? (
                <div className="command-search-empty">No commands found</div>
              ) : (
                filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.path}
                    type="button"
                    className={`command-search-item${index === selectedIndex ? ' selected' : ''}`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    data-selected={index === selectedIndex}
                    onClick={() => handleSelect(cmd.path)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <span className="command-search-item-label">Go to {cmd.label}</span>
                    <kbd className="command-search-item-kbd">{cmd.path}</kbd>
                  </button>
                ))
              )}
            </div>

            <div className="command-search-footer">
              <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
              <span><kbd>Enter</kbd> to select</span>
              <span><kbd>Esc</kbd> to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
