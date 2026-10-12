import { describe, expect, it } from 'vitest'
import { createPhotoLock } from './photos.js'

describe('photo operation serialization', () => {
  it('does not start recovery while an upload is still in progress', async () => {
    const lock = createPhotoLock()
    const steps: string[] = []
    let finishUpload!: () => void
    const gate = new Promise<void>((resolve) => {
      finishUpload = resolve
    })
    const upload = lock(async () => {
      steps.push('upload-start')
      await gate
      steps.push('upload-end')
    })
    const recovery = lock(async () => {
      steps.push('recovery')
    })
    await Promise.resolve()
    expect(steps).toEqual(['upload-start'])
    finishUpload()
    await Promise.all([upload, recovery])
    expect(steps).toEqual(['upload-start', 'upload-end', 'recovery'])
  })
})
