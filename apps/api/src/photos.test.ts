import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { processImage } from './photos.js'

describe('photo processing', () => {
  it('keeps the original and creates a separate thumbnail for a valid PNG', async () => {
    const original = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer()
    const image = await processImage(original)
    expect(image.mimeType).toBe('image/png')
    expect(image.width).toBe(20)
    expect(image.height).toBe(10)
    expect(image.original).toEqual(original)
    expect(image.thumbnail).not.toEqual(original)
  })

  it('rejects text disguised as an image', async () => {
    await expect(processImage(Buffer.from('not an image'))).rejects.toThrow()
  })

  it('accepts JPEG and WebP image bytes', async () => {
    const source = sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
    })
    expect((await processImage(await source.jpeg().toBuffer())).mimeType).toBe('image/jpeg')
    expect((await processImage(await source.webp().toBuffer())).mimeType).toBe('image/webp')
  })

  it('rejects files larger than 15 MiB', async () => {
    await expect(processImage(Buffer.alloc(15 * 1024 * 1024 + 1))).rejects.toThrow()
  })
})
