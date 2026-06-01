import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const HUB = 'https://oxfordhub.app'
const PROJECT_ID = 'promo-analyzer'

export async function middleware(req: NextRequest) {
  // Forward the session cookie to the hub to verify auth
  const cookie = req.headers.get('cookie') ?? ''

  try {
    const res = await fetch(`${HUB}/api/me?projectId=${PROJECT_ID}`, {
      headers: {
        cookie,
        'x-forwarded-for': req.headers.get('x-forwarded-for') ?? '',
      },
      cache: 'no-store',
    })

    const data = await res.json()

    if (!data.authenticated) {
      const loginUrl = new URL(`${HUB}/login`)
      loginUrl.searchParams.set('callbackUrl', req.url)
      return NextResponse.redirect(loginUrl)
    }

    if (!data.authorized) {
      return NextResponse.redirect(`${HUB}/dashboard?error=unauthorized`)
    }

    return NextResponse.next()
  } catch {
    // If hub is unreachable, fail open only on localhost
    if (req.nextUrl.hostname === 'localhost') {
      return NextResponse.next()
    }
    return NextResponse.redirect(`${HUB}/login?callbackUrl=${encodeURIComponent(req.url)}`)
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.webp$).*)'],
}
