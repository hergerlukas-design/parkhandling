import { describe, expect, it } from 'vitest'
import { availableEvents, eventAppliesToRole, toggleEvent, type NotificationConfig } from './events'
import { isAppleMobile, suggestDeviceLabel } from './pushClient'

const config: NotificationConfig = {
  events: {
    booking_new: { enabled: true, roles: ['staff'] },
    booking_review: { enabled: true, roles: ['admin'] },
    pickup_soon: { enabled: false, roles: ['staff'] },
    shuttle_due: {},
  },
}

describe('Ereignisse je Rolle', () => {
  it('„staff“ gilt für alle, „admin“ nur für Admins, ausgeschaltete für niemanden', () => {
    expect(eventAppliesToRole(config, 'booking_new', 'staff')).toBe(true)
    expect(eventAppliesToRole(config, 'booking_new', 'admin')).toBe(true)
    expect(eventAppliesToRole(config, 'booking_review', 'staff')).toBe(false)
    expect(eventAppliesToRole(config, 'booking_review', 'admin')).toBe(true)
    expect(eventAppliesToRole(config, 'pickup_soon', 'admin')).toBe(false)
    expect(eventAppliesToRole(config, 'arrival_soon', 'admin')).toBe(false)
  })

  it('ohne Rollenangabe gilt ein Ereignis für alle', () => {
    expect(availableEvents(config, 'staff')).toEqual(['booking_new', 'shuttle_due'])
    expect(availableEvents(config, 'admin')).toEqual(['booking_new', 'booking_review', 'shuttle_due'])
  })

  it('schaltet Ereignisse sortiert und ohne Doppelte um', () => {
    expect(toggleEvent(['pickup_soon', 'unbekannt'], 'booking_new', true)).toEqual(['booking_new', 'pickup_soon'])
    expect(toggleEvent(['booking_new', 'pickup_soon'], 'booking_new', false)).toEqual(['pickup_soon'])
    expect(toggleEvent(['booking_new'], 'booking_new', true)).toEqual(['booking_new'])
  })
})

describe('Geräteerkennung', () => {
  const IPAD_OS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
  const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
  const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

  it('erkennt iPadOS trotz Mac-Kennung an den Touchpunkten', () => {
    expect(isAppleMobile(IPAD_OS, 5)).toBe(true)
    expect(isAppleMobile(IPAD_OS, 0)).toBe(false)
    expect(isAppleMobile(ANDROID_TAB, 5)).toBe(false)
  })

  it('schlägt einen Gerätenamen vor', () => {
    expect(suggestDeviceLabel(IPAD_OS, 5)).toBe('iPad')
    expect(suggestDeviceLabel(ANDROID_TAB, 5)).toBe('Android-Tablet')
    expect(suggestDeviceLabel(ANDROID_PHONE, 5)).toBe('Android-Smartphone')
  })
})
