import { redirect } from 'next/navigation'

// Race became Compare (John, 2026-11-12); old links and bookmarks land there.
export default function RacePage() {
  redirect('/compare')
}
