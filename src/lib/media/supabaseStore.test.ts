import { describe, expect, it } from 'vitest'
import { rebaseUploadUrl } from './supabaseStore'

describe('rebaseUploadUrl', () => {
  it('ersetzt die Docker-interne Adresse des lokalen Stacks', () => {
    expect(rebaseUploadUrl('http://kong:8000/storage/v1/object/upload/sign/media/a.webp?token=t', 'http://127.0.0.1:54321')).toBe(
      'http://127.0.0.1:54321/storage/v1/object/upload/sign/media/a.webp?token=t',
    )
  })

  it('lässt Produktions-URLs unverändert', () => {
    const url = 'https://abc.supabase.co/storage/v1/object/upload/sign/media/a.webp?token=t'
    expect(rebaseUploadUrl(url, 'https://abc.supabase.co/')).toBe(url)
    expect(rebaseUploadUrl(url, '')).toBe(url)
  })
})
