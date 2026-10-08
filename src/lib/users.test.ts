import { describe, expect, it } from 'vitest'
import { canChangeStaff, type StaffProfile } from './users'

const base = (over: Partial<StaffProfile>): StaffProfile => ({
  id: 'x', email: null, display_name: '', role: 'staff', active: true, invited_at: null, ...over,
})

describe('canChangeStaff', () => {
  const admin1 = base({ id: 'a1', role: 'admin' })
  const admin2 = base({ id: 'a2', role: 'admin' })
  const staff = base({ id: 's1' })

  it('blockiert Deaktivierung des letzten aktiven Admins', () => {
    expect(canChangeStaff(admin1, { active: false }, [admin1, staff])).not.toBeNull()
  })

  it('blockiert Herabstufung des letzten aktiven Admins', () => {
    expect(canChangeStaff(admin1, { role: 'staff' }, [admin1])).not.toBeNull()
  })

  it('erlaubt Deaktivierung, wenn ein weiterer aktiver Admin existiert', () => {
    expect(canChangeStaff(admin1, { active: false }, [admin1, admin2])).toBeNull()
  })

  it('erlaubt Änderungen an Personal', () => {
    expect(canChangeStaff(staff, { active: false }, [admin1, staff])).toBeNull()
  })

  it('ignoriert bereits inaktive Admins', () => {
    const inactive = base({ id: 'a3', role: 'admin', active: false })
    expect(canChangeStaff(admin1, { active: false }, [admin1, inactive])).not.toBeNull()
  })
})
