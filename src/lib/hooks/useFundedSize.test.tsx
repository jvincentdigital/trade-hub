import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SizeSwitch } from '@/components/home/SizeSwitch'
import { FUNDED_SIZE_KEY, loadFundedSize, useFundedSize } from './useFundedSize'

/** An in-memory localStorage: newer Node versions put their own (empty) one over jsdom's. */
function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}
let localStorage: ReturnType<typeof memoryStorage>
beforeEach(() => {
  localStorage = memoryStorage()
  Object.defineProperty(window, 'localStorage', { value: localStorage, configurable: true })
})

/** Today's switch with the saved choice, as the card uses it. */
function Harness() {
  const [size, setSize] = useFundedSize()
  return (
    <>
      <SizeSwitch value={size} onChange={setSize} />
      <p data-testid="shown">{size}</p>
    </>
  )
}

const pressed = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent)

describe('funded size switch', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows four sizes, one selected ($10K first), 44 px targets', () => {
    render(<Harness />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['$10K', '$50K', '$100K', '$200K'])
    expect(pressed()).toEqual(['$10K'])
    for (const b of buttons) expect(b.style.minHeight).toBe('44px')
  })

  it('a tap changes the size and is remembered', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '$100K' }))
    expect(pressed()).toEqual(['$100K'])
    expect(screen.getByTestId('shown').textContent).toBe('100000')
    expect(localStorage.getItem(FUNDED_SIZE_KEY)).toBe('100000')
    cleanup()
    render(<Harness />)
    expect(pressed()).toEqual(['$100K'])
  })

  it('junk or blocked storage falls back to the $10K', () => {
    localStorage.setItem(FUNDED_SIZE_KEY, '12345')
    expect(loadFundedSize()).toBe(10_000)
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadFundedSize()).toBe(10_000)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '$50K' }))
    expect(pressed()).toEqual(['$50K']) // still switches, just not saved
  })
})
