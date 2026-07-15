import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.js'
import { claimReferralBonus, getReferralSummary } from '../controllers/referralController.js'

const router = Router()

router.get('/', authenticateToken, getReferralSummary)
router.post('/claim', authenticateToken, claimReferralBonus)

export default router
