import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getSettings, updateSettings, isFeatureEnabled } from '../../src/settings.js'
import { loadStore, saveStore } from '../../src/store.js'
import type { AccountStore } from '../../src/types.js'

const TEST_DIR = path.join(os.tmpdir(), 'oma-feature-flags-test-' + Date.now())
const TEST_STORE_FILE = path.join(TEST_DIR, 'accounts.json')

// Mock store environment
const originalEnv = process.env

describe('Phase G: Feature Flags', () => {
  beforeEach(() => {
    // Setup test environment
    process.env = {
      ...originalEnv,
      OPENCODE_MULTI_AUTH_STORE_DIR: TEST_DIR,
      OPENCODE_MULTI_AUTH_STORE_FILE: TEST_STORE_FILE
    }
    
    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true })
    }
    
    // Initialize empty store with version 2
    const emptyStore = {
      version: 2,
      accounts: {},
      activeAlias: null,
      rotationIndex: 0,
      lastRotation: Date.now(),
      forcedAlias: null,
      forcedUntil: null,
      previousRotationStrategy: null,
      forcedBy: null,
      rotationStrategy: 'round-robin'
    }
    fs.writeFileSync(TEST_STORE_FILE, JSON.stringify(emptyStore, null, 2), { mode: 0o600 })
  })

  afterEach(() => {
    // Cleanup
    process.env = originalEnv
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe('L1: Feature Flag Defaults', () => {
    it('should default antigravityEnabled to false', () => {
      const result = getSettings()
      
      expect(result.settings.featureFlags).toBeDefined()
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(false)
    })

    it('should return false for isFeatureEnabled when flag not set', () => {
      const result = isFeatureEnabled('antigravityEnabled')
      
      expect(result).toBe(false)
    })
  })

  describe('L1: Feature Flag Environment Override', () => {
    it('should enable antigravity via environment variable', () => {
      process.env.OPENCODE_MULTI_AUTH_ANTIGRAVITY_ENABLED = 'true'
      
      const result = getSettings()
      
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(true)
      expect(result.source).toBe('env')
    })

    it('should enable antigravity via environment variable with value 1', () => {
      process.env.OPENCODE_MULTI_AUTH_ANTIGRAVITY_ENABLED = '1'
      
      const result = getSettings()
      
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(true)
    })

    it('should disable antigravity via environment variable', () => {
      process.env.OPENCODE_MULTI_AUTH_ANTIGRAVITY_ENABLED = 'false'
      
      const result = getSettings()
      
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(false)
    })

    it('should handle invalid environment value gracefully', () => {
      process.env.OPENCODE_MULTI_AUTH_ANTIGRAVITY_ENABLED = 'invalid'
      
      const result = getSettings()
      
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(false)
    })
  })

  describe('L1: Feature Flag Persistence', () => {
    it('should persist feature flags to store', () => {
      const result = updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      expect(result.success).toBe(true)
      
      const store = loadStore()
      expect(store.settings?.featureFlags?.antigravityEnabled).toBe(true)
    })

    it('should persist feature flags across restarts', () => {
      // First, enable the feature
      updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      // Reload settings (simulating restart)
      const result = getSettings()
      
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(true)
    })

    it('should preserve other settings when updating feature flags', () => {
      // Set initial settings
      updateSettings({
        rotationStrategy: 'weighted-round-robin',
        criticalThreshold: 15
      }, 'test-actor')
      
      // Update feature flags
      updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      const result = getSettings()
      
      expect(result.settings.rotationStrategy).toBe('weighted-round-robin')
      expect(result.settings.criticalThreshold).toBe(15)
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(true)
    })
  })

  describe('L1: Feature Flag via Settings API', () => {
    it('should update feature flags via settings API', () => {
      const result = updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'api-user')
      
      expect(result.success).toBe(true)
      expect(result.settings?.featureFlags?.antigravityEnabled).toBe(true)
    })

    it('should update feature flags via settings API with actor tracking', () => {
      const result = updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'admin-user')
      
      expect(result.success).toBe(true)
      expect(result.settings?.updatedBy).toBe('admin-user')
    })
  })

  describe('L2: Flag-Off Behavior', () => {
    it('should return false for isFeatureEnabled when antigravity disabled', () => {
      const result = isFeatureEnabled('antigravityEnabled')
      
      expect(result).toBe(false)
    })

    it('should maintain default settings structure when flag off', () => {
      const result = getSettings()
      
      expect(result.settings.rotationStrategy).toBe('round-robin')
      expect(result.settings.criticalThreshold).toBe(10)
      expect(result.settings.lowThreshold).toBe(30)
    })
  })

  describe('L3: Flag-On Behavior', () => {
    it('should return true for isFeatureEnabled when antigravity enabled', () => {
      updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      const result = isFeatureEnabled('antigravityEnabled')
      
      expect(result).toBe(true)
    })

    it('should maintain other settings when flag on', () => {
      updateSettings({
        rotationStrategy: 'least-used',
        criticalThreshold: 20,
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      const result = getSettings()
      
      expect(result.settings.rotationStrategy).toBe('least-used')
      expect(result.settings.criticalThreshold).toBe(20)
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(true)
    })
  })

  describe('L7: Edge Cases', () => {
    it('should handle feature flags toggle during operation', () => {
      // Start with flag off
      let result = getSettings()
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(false)
      
      // Enable flag
      updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      result = getSettings()
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(true)
      
      // Disable flag
      updateSettings({
        featureFlags: { antigravityEnabled: false }
      }, 'test-actor')
      
      result = getSettings()
      expect(result.settings.featureFlags?.antigravityEnabled).toBe(false)
    })

    it('should handle feature flags enabled then disabled', () => {
      // Enable
      updateSettings({
        featureFlags: { antigravityEnabled: true }
      }, 'test-actor')
      
      let store = loadStore()
      expect(store.settings?.featureFlags?.antigravityEnabled).toBe(true)
      
      // Disable
      updateSettings({
        featureFlags: { antigravityEnabled: false }
      }, 'test-actor')
      
      store = loadStore()
      expect(store.settings?.featureFlags?.antigravityEnabled).toBe(false)
    })

    it('should handle undefined featureFlags gracefully', () => {
      const store = loadStore()
      store.settings = {
        rotationStrategy: 'round-robin',
        criticalThreshold: 10,
        lowThreshold: 30,
        accountWeights: {},
        stickySessionRouting: true,
        sessionIdleTimeoutMs: 60 * 60 * 1000,
        sessionStickyFallback: 'rotate'
        // featureFlags is undefined
      }
      saveStore(store)
      
      const result = isFeatureEnabled('antigravityEnabled')
      
      expect(result).toBe(false)
    })

    it('should handle partial featureFlags object', () => {
      updateSettings({
        featureFlags: {} as any
      }, 'test-actor')
      
      const result = isFeatureEnabled('antigravityEnabled')
      
      expect(result).toBe(false)
    })
  })
})
