import express, { Request, Response } from 'express'
import cors from 'cors'
import { prisma } from './config/db.js'
import authRoutes from './routes/auth.js'
import investmentRoutes from './routes/investments.js'
import depositRoutes from './routes/deposits.js'
import withdrawalRoutes from './routes/withdrawals.js'
import adminRoutes from './routes/admin.js'
import telegramRoutes from './routes/telegram.js'
import notificationRoutes from './routes/notifications.js'
import referralRoutes from './routes/referrals.js'

const app = express()
const PORT = Number(process.env.PORT) || 5000

const allowedOrigins = [
  'https://ecocash-investment-copmanyzm.vercel.app',
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
].filter(Boolean) as string[]

const isAllowedOrigin = (origin?: string) => {
  if (!origin) return true
  if (allowedOrigins.includes(origin)) return true
  if (origin.endsWith('.vercel.app') && origin.includes('ecocash-investment')) return true
  if (origin.endsWith('.onrender.com')) return true
  return false
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())

app.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'EcoCash Investment Platform API is running',
    timestamp: new Date().toISOString(),
  })
})

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/investments', investmentRoutes)
app.use('/api/deposits', depositRoutes)
app.use('/api/withdrawals', withdrawalRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/referrals', referralRoutes)

app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

if (process.env.NODE_ENV !== 'test' && process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

export default app
export { prisma }
