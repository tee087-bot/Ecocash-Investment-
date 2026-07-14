import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { getDeposits, submitDeposit, uploadReceipt, approveDeposit, rejectDeposit, updateDepositStatus } from '../controllers/depositController.js'
import { authenticateToken } from '../middleware/auth.js'

const router = Router()

// Ensure upload directory exists
const getUploadPath = () => {
  const uploadPath = process.env.VERCEL || process.env.RENDER ? '/tmp/uploads' : path.join(process.cwd(), '..', 'public', 'uploads')
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true })
  }
  return uploadPath
}

const botSecret = process.env.BOT_SECRET || 'ecocash_bot_secret_2024'

const botAuthMiddleware = (req: any, res: any, next: any): void => {
  const secret = req.headers['x-bot-secret'] as string
  if (secret === botSecret) {
    next()
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized bot access' })
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, getUploadPath())
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  },
})

const upload = multer({ storage })

// Bot-accessible endpoints (must come before authenticateToken middleware)
router.post('/admin/approve/:id', botAuthMiddleware, approveDeposit)
router.post('/admin/reject/:id', botAuthMiddleware, rejectDeposit)
router.post('/admin/send-details/:id', botAuthMiddleware, updateDepositStatus)

router.use(authenticateToken)

router.get('/', getDeposits)
router.post('/submit', submitDeposit)
router.post('/upload-receipt', upload.single('receipt'), uploadReceipt)
router.put('/:id/approve', approveDeposit)
router.put('/:id/reject', rejectDeposit)
router.put('/:id/send-details', updateDepositStatus)

export default router