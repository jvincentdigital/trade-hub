import { unlock } from './actions'

export const metadata = { title: 'Unlock' }

export default async function Unlock({
  searchParams,
}: {
  searchParams: Promise<{ wrong?: string }>
}) {
  const { wrong } = await searchParams
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--bg-primary)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--indigo)' }}>Trade Hub</h1>
        <p style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
          Type your passcode once on this device. It stays unlocked after that.
        </p>
        <form
          action={unlock}
          style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <label htmlFor="pass" style={{ fontSize: 13, fontWeight: 600 }}>
            Passcode
          </label>
          <input
            id="pass"
            name="pass"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            style={{
              minHeight: 52,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              padding: '0 14px',
              fontSize: 17,
            }}
          />
          {wrong && (
            <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)' }}>
              That passcode is not right. Try again.
            </p>
          )}
          <button
            type="submit"
            style={{
              minHeight: 52,
              borderRadius: 12,
              border: 'none',
              background: 'var(--indigo)',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Open Trade Hub
          </button>
        </form>
      </div>
    </div>
  )
}
