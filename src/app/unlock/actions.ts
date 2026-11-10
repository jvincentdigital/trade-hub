'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE, passHash } from '@/lib/lock'

export async function unlock(fd: FormData) {
  const pass = process.env.TRADE_HUB_PASSCODE
  const typed = String(fd.get('pass') ?? '').trim()
  if (!pass) redirect('/')
  if (typed !== pass) {
    await new Promise((r) => setTimeout(r, 1500)) // slow down guessing
    redirect('/unlock?wrong=1')
  }
  ;(await cookies()).set(COOKIE, await passHash(pass), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  redirect('/')
}
