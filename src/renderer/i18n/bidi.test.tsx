// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { BidiText, isolateLatin } from './bidi'

describe('bidi isolation', () => {
  it('wraps Latin names, URLs and numbers inside Hebrew in <bdi>', () => {
    const { container } = render(<p><BidiText lang="he" text="הפרויקט Roam רץ על http://localhost:3000 כבר 5 דקות" /></p>)
    const isolated = [...container.querySelectorAll('bdi')].map((b) => b.textContent)
    expect(isolated).toEqual(['Roam', 'http://localhost:3000', '5'])
  })

  it('leaves English text untouched', () => {
    const { container } = render(<p><BidiText lang="en" text="Roam runs on port 3000" /></p>)
    expect(container.querySelectorAll('bdi')).toHaveLength(0)
  })

  it('keeps multi-word Latin names together', () => {
    expect(isolateLatin('קלוד Code מותקן').filter((n) => typeof n !== 'string')).toHaveLength(1)
  })
})
