import { createServer } from 'node:http'
import { pool } from './db.js'
import { handlePublicGet } from './publicRecords.js'
import { handleAuthRoute } from './auth.js'
import { handlePrivateRecordRoute } from './privateRecords.js'
import { handleInvitationRoute } from './invitations.js'
import { handleCoverRoute } from './covers.js'
import { handleDailyRoute } from './daily.js'
import { handlePaintingRoute } from './paintings.js'
import { handleAppearanceRoute } from './appearance.js'
import { handleSiteAbout } from './siteAbout.js'

const port = Number(process.env.PORT || 3001)

const server = createServer(async (request, response) => {
  const path = (request.url || '/').split('?')[0]

  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')

  // Only anonymous, publicly available GET routes may be read cross-origin.
  if (request.method === 'GET' && path.startsWith('/api/public/')) {
    response.setHeader('Access-Control-Allow-Origin', '*')
  }

  if (request.method === 'GET' && path === '/api/health') {
    try {
      await pool.query('SELECT 1')
      response.writeHead(200)
      response.end(JSON.stringify({
        ok: true,
        service: 'portfolio-api',
        database: 'connected',
      }))
    } catch (error) {
      console.error('PostgreSQL health check failed:', error.code || error.message)
      response.writeHead(503)
      response.end(JSON.stringify({
        ok: false,
        service: 'portfolio-api',
        database: 'unavailable',
      }))
    }
    return
  }

  if (
    await handleSiteAbout(request, response, new URL(request.url || '/', 'http://localhost'))
  ) return

  if (
    await handleAuthRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    await handleCoverRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    await handlePaintingRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    await handleAppearanceRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    await handleDailyRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    await handlePrivateRecordRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    await handleInvitationRoute(
      request,
      response,
      new URL(request.url || '/', 'http://localhost'),
    )
  ) return

  if (
    request.method === 'GET' &&
    await handlePublicGet(new URL(request.url || '/', 'http://localhost'), response)
  ) return

  response.writeHead(404)
  response.end(
    JSON.stringify({
      ok: false,
      error: 'Not found',
    }),
  )
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Portfolio API listening on http://127.0.0.1:${port}`)
})
