import { describe, expect, it } from 'vitest'
import { canChangeStaff, normalizeRoles, rolesLabel, toggleRole, type StaffProfile } from './users'

const base = (over: Partial<StaffProfile>): StaffProfile => ({
  id: 'x', email: null, display_name: '', role: 'staff', roles: ['staff'], active: true, invited_at: null, ...over,
})

describe('canChangeStaff', () => {
  const admin1 = base({ id: 'a1', role: 'admin', roles: ['admin'] })
  const admin2 = base({ id: 'a2', role: 'admin', roles: ['admin', 'driver'] })
  const staff = base({ id: 's1' })

  it('blockiert Deaktivierung des letzten aktiven Admins', () => {
    expect(canChangeStaff(admin1, { active: false }, [admin1, staff])).not.toBeNull()
  })

  it('blockiert Herabstufung des letzten aktiven Admins', () => {
    expect(canChangeStaff(admin1, { roles: ['staff', 'driver'] }, [admin1])).not.toBeNull()
  })

  it('erlaubt Deaktivierung, wenn ein weiterer aktiver Admin existiert', () => {
    expect(canChangeStaff(admin1, { active: false }, [admin1, admin2])).toBeNull()
  })

  it('erlaubt Änderungen an Personal', () => {
    expect(canChangeStaff(staff, { active: false }, [admin1, staff])).toBeNull()
  })

  it('ignoriert bereits inaktive Admins', () => {
    const inactive = base({ id: 'a3', role: 'admin', roles: ['admin'], active: false })
    expect(canChangeStaff(admin1, { active: false }, [admin1, inactive])).not.toBeNull()
  })
})

describe('Rollen', () => {
  it('sortiert, ohne Doppelte', () => {
    expect(normalizeRoles(['driver', 'admin', 'driver'])).toEqual(['admin', 'driver'])
  })

  it('schaltet Rollen um, die letzte bleibt stehen', () => {
    expect(toggleRole(['staff'], 'driver', true)).toEqual(['staff', 'driver'])
    expect(toggleRole(['staff', 'driver'], 'staff', false)).toEqual(['driver'])
    expect(toggleRole(['driver'], 'driver', false)).toEqual(['driver'])
  })

  it('beschriftet Rollen', () => {
    expect(rolesLabel(['driver', 'staff'])).toBe('Personal, Fahrer')
  })

  it('Admin bleibt erhalten, solange er in den Rollen steht', () => {
    const admin = base({ id: 'a1', role: 'admin', roles: ['admin'] })
    expect(canChangeStaff(admin, { roles: ['admin', 'driver'] }, [admin])).toBeNull()
  })
})
