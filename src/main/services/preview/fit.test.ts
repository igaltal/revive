import { describe, expect, it } from 'vitest'
import { fitBounds } from './fit'

describe('preview size', () => {
  it('fills the spot on desktop and centres a 390 px phone', () => {
    const spot = { x: 300.4, y: 200, width: 900, height: 560 }
    expect(fitBounds(spot, 'desktop')).toEqual({ x: 300, y: 200, width: 900, height: 560 })
    expect(fitBounds(spot, 'phone')).toEqual({ x: 555, y: 200, width: 390, height: 560 })
  })
})
