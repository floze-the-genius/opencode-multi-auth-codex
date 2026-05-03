import {
  getSettings,
  updateSettings,
  resetSettings,
  applyPreset,
  calculateWeightedSelection,
  getSettingsWithInfo,
  type SettingsResult
} from '../../src/settings.js'
import { loadStore, saveStore, addAccount, removeAccount } from '../../src/store.js'
import {
  DEFAULT_ROTATION_SETTINGS,
  WEIGHTED_PRESETS,
  validateSettings,
  type RotationSettings,
  type WeightPreset
} from '../../src/types.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const tmpDir = path.join(os.tmpdir(), 'oma-test-settings-' + Date.now())
const originalEnv = process.env

describe('Phase F: Settings + Weighted Rotation', () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.OPENCODE_MULTI_AUTH_STORE_DIR = tmpDir
    
    // Ensure clean state
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true })
    }
    fs.mkdirSync(tmpDir, { recursive: true })
    
    // Clear environment variables that affect settings
    delete process.env.OPENCODE_MULTI_AUTH_ROTATION_STRATEGY
    delete process.env.OPENCODE_MULTI_AUTH_CRITICAL_THRESHOLD
    delete process.env.OPENCODE_MULTI_AUTH_LOW_THRESHOLD
    delete process.env.OPENCODE_MULTI_AUTH_DEBUG
  })
  
  afterEach(() => {
    process.env = originalEnv
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true })
    }
  })

  describe('Settings Model', () => {
    it('should return default settings when no settings persisted', () => {
      const result = getSettings()
      
      expect(result.source).toBe('default')
      expect(result.settings.rotationStrategy).toBe('round-robin')
      expect(result.settings.debug).toBe(false)
      expect(result.settings.criticalThreshold).toBe(10)
      expect(result.settings.lowThreshold).toBe(30)
      expect(result.settings.accountWeights).toEqual({})
      expect(result.settings.sessionIdleTimeoutMs).toBe(30 * 24 * 60 * 60 * 1000)
      expect(result.settings.sessionStickyFallback).toBe('fail')
    })

    it('should persist settings to store', () => {
      const update = updateSettings({
        rotationStrategy: 'weighted-round-robin',
        criticalThreshold: 15,
        lowThreshold: 35
      }, 'test')
      
      expect(update.success).toBe(true)
      expect(update.settings?.rotationStrategy).toBe('weighted-round-robin')
      
      // Verify persistence
      const result = getSettings()
      expect(result.source).toBe('persisted')
      expect(result.settings.rotationStrategy).toBe('weighted-round-robin')
    })

    it('should reset settings to defaults', () => {
      // First update settings
      updateSettings({ rotationStrategy: 'least-used' }, 'test')
      
      // Then reset
      const reset = resetSettings('test')
      
      expect(reset.rotationStrategy).toBe('round-robin')
      
      // Verify reset
      const result = getSettings()
      expect(result.source).toBe('default')
      expect(result.settings.rotationStrategy).toBe('round-robin')
    })
  })

  describe('Settings Precedence', () => {
    it('should use environment variable for rotation strategy', () => {
      process.env.OPENCODE_MULTI_AUTH_ROTATION_STRATEGY = 'least-used'
      
      const result = getSettings()
      
      expect(result.source).toBe('env')
      expect(result.settings.rotationStrategy).toBe('least-used')
    })

    it('should use environment variable for critical threshold', () => {
      process.env.OPENCODE_MULTI_AUTH_CRITICAL_THRESHOLD = '25'
      
      const result = getSettings()
      
      expect(result.source).toBe('env')
      expect(result.settings.criticalThreshold).toBe(25)
    })

    it('should use environment variable for low threshold', () => {
      process.env.OPENCODE_MULTI_AUTH_LOW_THRESHOLD = '45'
      
      const result = getSettings()
      
      expect(result.source).toBe('env')
      expect(result.settings.lowThreshold).toBe(45)
    })

    it('should use environment variable for debug logging', () => {
      process.env.OPENCODE_MULTI_AUTH_DEBUG = '1'

      const result = getSettings()

      expect(result.source).toBe('env')
      expect(result.settings.debug).toBe(true)
    })
  })

  describe('Settings Validation', () => {
    it('should reject critical threshold outside 0-100 range', () => {
      const result = updateSettings({ criticalThreshold: -5 }, 'test')
      
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors?.[0].field).toBe('criticalThreshold')
    })

    it('should reject low threshold outside 0-100 range', () => {
      const result = updateSettings({ lowThreshold: 150 }, 'test')
      
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors?.[0].field).toBe('lowThreshold')
    })

    it('should reject critical >= low threshold', () => {
      const result = updateSettings({
        criticalThreshold: 50,
        lowThreshold: 40
      }, 'test')
      
      expect(result.success).toBe(false)
      expect(result.errors?.some(e => e.field === 'thresholds')).toBe(true)
    })

    it('should reject weights <= 0', () => {
      const result = updateSettings({
        accountWeights: { 'account1': 0 }
      }, 'test')
      
      expect(result.success).toBe(false)
      expect(result.errors?.some(e => e.field.includes('accountWeights'))).toBe(true)
    })

    it('should reject weights > 1', () => {
      const result = updateSettings({
        accountWeights: { 'account1': 1.5 }
      }, 'test')
      
      expect(result.success).toBe(false)
      expect(result.errors?.some(e => e.field.includes('accountWeights'))).toBe(true)
    })

    it('should reject weights that do not sum to 1', () => {
      const result = updateSettings({
        accountWeights: {
          'account1': 0.3,
          'account2': 0.3
        }
      }, 'test')
      
      expect(result.success).toBe(false)
      expect(result.errors?.some(e => e.field === 'accountWeights')).toBe(true)
    })

    it('should accept valid settings', () => {
      const result = updateSettings({
        rotationStrategy: 'weighted-round-robin',
        criticalThreshold: 10,
        lowThreshold: 30,
        accountWeights: {
          'account1': 0.5,
          'account2': 0.5
        }
      }, 'test')
      
      expect(result.success).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    it('should reject invalid session sticky fallback', () => {
      const result = updateSettings({
        sessionStickyFallback: 'invalid' as RotationSettings['sessionStickyFallback']
      }, 'test')

      expect(result.success).toBe(false)
      expect(result.errors?.some(e => e.field === 'sessionStickyFallback')).toBe(true)
    })

    it('should accept valid session sticky fallback values', () => {
      const failResult = updateSettings({ sessionStickyFallback: 'fail' }, 'test')
      expect(failResult.success).toBe(true)

      const rotateResult = updateSettings({ sessionStickyFallback: 'rotate' }, 'test')
      expect(rotateResult.success).toBe(true)
    })
  })

  describe('Weighted Rotation', () => {
    it('should select account with probability proportional to weight', () => {
      const weights = {
        'account1': 0.7,
        'account2': 0.3
      }
      
      const aliases = ['account1', 'account2']
      
      // Run multiple times and check distribution
      const counts: Record<string, number> = { account1: 0, account2: 0 }
      const iterations = 1000
      
      for (let i = 0; i < iterations; i++) {
        const selected = calculateWeightedSelection(aliases, weights)
        if (selected) {
          counts[selected]++
        }
      }
      
      // account1 should be selected roughly 70% of the time
      const account1Ratio = counts.account1 / iterations
      expect(account1Ratio).toBeGreaterThan(0.6)
      expect(account1Ratio).toBeLessThan(0.8)
    })

    it('should return null for empty aliases', () => {
      const result = calculateWeightedSelection([], { 'account1': 1 })
      expect(result).toBeNull()
    })

    it('should return null when all weights are 0', () => {
      const result = calculateWeightedSelection(
        ['account1', 'account2'],
        { 'account1': 0, 'account2': 0 }
      )
      expect(result).toBeNull()
    })

    it('should filter out aliases with 0 weight', () => {
      const weights = {
        'account1': 1.0,
        'account2': 0
      }
      
      const aliases = ['account1', 'account2']
      
      // Run multiple times
      for (let i = 0; i < 100; i++) {
        const selected = calculateWeightedSelection(aliases, weights)
        expect(selected).toBe('account1')
      }
    })
  })

  describe('Weighted Presets', () => {
    beforeEach(() => {
      // Add test accounts
      addAccount('account1', {
        accessToken: 'token1',
        refreshToken: 'refresh1',
        expiresAt: Date.now() + 3600000,
        rateLimits: {
          fiveHour: { limit: 100, remaining: 80, updatedAt: Date.now() },
          weekly: { limit: 100, remaining: 90, updatedAt: Date.now() }
        }
      })
      
      addAccount('account2', {
        accessToken: 'token2',
        refreshToken: 'refresh2',
        expiresAt: Date.now() + 3600000,
        rateLimits: {
          fiveHour: { limit: 100, remaining: 40, updatedAt: Date.now() },
          weekly: { limit: 100, remaining: 50, updatedAt: Date.now() }
        }
      })
      
      // Update usage counts
      const store = loadStore()
      store.accounts.account1.usageCount = 10
      store.accounts.account2.usageCount = 20
      saveStore(store)
    })

    it('should apply balanced preset with equal weights', () => {
      const result = applyPreset('balanced', 'test')
      
      expect(result.success).toBe(true)
      expect(result.settings?.rotationStrategy).toBe('weighted-round-robin')
      
      // Should have equal weights
      const weights = result.settings?.accountWeights || {}
      expect(weights.account1).toBeCloseTo(0.5, 5)
      expect(weights.account2).toBeCloseTo(0.5, 5)
    })

    it('should apply conservative preset with health-based weights', () => {
      const result = applyPreset('conservative', 'test')
      
      expect(result.success).toBe(true)
      expect(result.settings?.rotationStrategy).toBe('weighted-round-robin')
      
      // account1 has better limits (85% avg) vs account2 (45% avg)
      // So account1 should have higher weight
      const weights = result.settings?.accountWeights || {}
      expect(weights.account1).toBeGreaterThan(weights.account2)
    })

    it('should apply aggressive preset favoring low-remaining accounts', () => {
      const result = applyPreset('aggressive', 'test')
      
      expect(result.success).toBe(true)
      expect(result.settings?.rotationStrategy).toBe('weighted-round-robin')
      
      // account2 has lower limits, so it should have higher weight
      const weights = result.settings?.accountWeights || {}
      expect(weights.account2).toBeGreaterThan(weights.account1)
    })

    it('should set appropriate thresholds for each preset', () => {
      const balanced = applyPreset('balanced', 'test')
      expect(balanced.settings?.criticalThreshold).toBe(10)
      expect(balanced.settings?.lowThreshold).toBe(30)
      
      const conservative = applyPreset('conservative', 'test')
      expect(conservative.settings?.criticalThreshold).toBe(20)
      expect(conservative.settings?.lowThreshold).toBe(40)
      
      const aggressive = applyPreset('aggressive', 'test')
      expect(aggressive.settings?.criticalThreshold).toBe(5)
      expect(aggressive.settings?.lowThreshold).toBe(20)
    })
  })

  describe('Settings Metadata', () => {
    it('should track who updated settings', () => {
      updateSettings({ criticalThreshold: 15 }, 'admin-user')
      
      const store = loadStore()
      expect(store.settings?.updatedBy).toBe('admin-user')
      expect(store.settings?.updatedAt).toBeDefined()
    })

    it('should persist debug logging setting', () => {
      const result = updateSettings({ debug: true }, 'test')

      expect(result.success).toBe(true)
      expect(result.settings?.debug).toBe(true)

      const loaded = getSettings()
      expect(loaded.settings.debug).toBe(true)
    })

    it('should allow checking if settings can be reset', () => {
      // Initially no persisted settings
      let info = getSettingsWithInfo()
      expect(info.canReset).toBe(false)
      
      // After updating
      updateSettings({ criticalThreshold: 15 }, 'test')
      info = getSettingsWithInfo()
      expect(info.canReset).toBe(true)
    })
  })
})
