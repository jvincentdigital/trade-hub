import Link from 'next/link'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <Compass size={32} color="var(--indigo)" />
      <h1 style={{ fontSize: '18px', fontWeight: 600, marginTop: '16px' }}>Page not found</h1>
      <p
        style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginTop: '6px',
          maxWidth: '420px',
        }}
      >
        That route doesn&apos;t exist in Trade Hub. Head back to Today to see your trades.
      </p>
      <Link
        href="/"
        style={{
          marginTop: '20px',
          background: 'var(--indigo)',
          borderRadius: '7px',
          padding: '8px 14px',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
          color: 'white',
          fontSize: '12px',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        Back to Today
      </Link>
    </div>
  )
}
