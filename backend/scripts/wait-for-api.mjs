#!/usr/bin/env node
/** Wait for backend /health before starting Vite (avoids false "backend down" on login). */
import http from 'http'

const port = process.env.ATTENDANCE_API_PORT ?? '8787'
const host = '127.0.0.1'
const maxAttempts = 60
const delayMs = 500

function probe() {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function main() {
  for (let i = 0; i < maxAttempts; i++) {
    if (await probe()) {
      console.log(`API ready on http://${host}:${port}`)
      return
    }
    if (i === 0) {
      console.log(`Waiting for API on http://${host}:${port}/health …`)
    }
    await new Promise((r) => setTimeout(r, delayMs))
  }
  console.error(
    `\nAPI did not start within ${(maxAttempts * delayMs) / 1000}s.\n` +
      `Run from repo root: npm run check:db  then  npm run api\n` +
      `Fix DATABASE_URL in backend/.env if check:db fails.\n`,
  )
  process.exit(1)
}

main()
