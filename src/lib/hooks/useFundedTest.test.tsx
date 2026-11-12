import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TestSwitch } from '@/components/home/SizeSwitch'
import { createFunded, fundedOf } from '@/lib/race/funded'
import { FUNDED_TEST_KEY, loadFundedTest, useFundedTest } from './useFundedTest'

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

// One $10K account per test, told apart by balance, as Today picks them.
const state = {
  funded: { ...createFunded(0), balance: 10_100 },
  fundedB: [{ ...createFunded(0), balance: 10_250 }],
}

/** Today's switch with the saved choice, and the balance of the account it shows. */
function Harness() {
  const [test, setTest] = useFundedTest()
  return (
    <>
      <TestSwitch value={test} onChange={setTest} />
      <p data-testid="shown">{fundedOf(state, 10_000, test)?.balance}</p>
    </>
  )
}

const pressed = () =>
  screen
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent)

describe('funded test switch', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows two tests, v1 only selected first, 44 px targets', () => {
    render(<Harness />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['v1 only', 'v1 + breakouts'])
    expect(pressed()).toEqual(['v1 only'])
    expect(screen.getByTestId('shown').textContent).toBe('10100')
    for (const b of buttons) expect(b.style.minHeight).toBe('44px')
  })

  it('a tap changes which test the card shows and is remembered', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'v1 + breakouts' }))
    expect(pressed()).toEqual(['v1 + breakouts'])
    expect(screen.getByTestId('shown').textContent).toBe('10250')
    expect(localStorage.getItem(FUNDED_TEST_KEY)).toBe('breakouts')
    cleanup()
    render(<Harness />)
    expect(pressed()).toEqual(['v1 + breakouts'])
  })

  it('junk or blocked storage falls back to v1 only', () => {
    localStorage.setItem(FUNDED_TEST_KEY, 'everything')
    expect(loadFundedTest()).toBe('v1')
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(loadFundedTest()).toBe('v1')
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'v1 + breakouts' }))
    expect(pressed()).toEqual(['v1 + breakouts']) // still switches, just not saved
  })
})
