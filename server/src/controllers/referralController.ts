import { Response } from 'express'
import { AuthRequest } from '../middleware/auth.js'
import { prisma } from '../config/db.js'
import { notifyReferralClaim } from '../services/telegramService.js'

const REQUIRED_REFERRALS = 20

export const getReferralSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id
    const [user, bonuses, claims] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true, referralCycleCount: true, referralBalance: true, walletBalance: true },
      }),
      prisma.referralBonus.aggregate({
        where: { referrerId: userId, beneficiaryId: userId, eligibleAt: { not: null }, status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.referralClaim.findMany({
        where: { userId },
        select: { id: true, amount: true, bonusCount: true, status: true, createdAt: true, reviewedAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])

    res.json({
      success: true,
      data: {
        referralCode: user?.referralCode,
        registeredReferrals: user?.referralCycleCount || 0,
        requiredReferrals: REQUIRED_REFERRALS,
        remainingReferrals: Math.max(0, REQUIRED_REFERRALS - (user?.referralCycleCount || 0)),
        referralBalance: user?.referralBalance || 0,
        walletBalance: user?.walletBalance || 0,
        eligibleAmount: bonuses._sum.amount || 0,
        eligibleBonusCount: bonuses._count,
        claims,
      },
    })
  } catch (error) {
    console.error('Get referral summary error:', error)
    res.status(500).json({ success: false, message: 'Unable to load referral rewards.' })
  }
}

export const claimReferralBonus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id
    const claim = await prisma.$transaction(async (tx) => {
      const pendingBonuses = await tx.referralBonus.findMany({
        where: { referrerId: userId, beneficiaryId: userId, eligibleAt: { not: null }, status: 'PENDING' },
        select: { id: true, amount: true },
      })
      if (!pendingBonuses.length) return null

      const amount = pendingBonuses.reduce((total, bonus) => total + bonus.amount, 0)
      const newClaim = await tx.referralClaim.create({
        data: { userId, amount, bonusCount: pendingBonuses.length },
      })
      await tx.referralBonus.updateMany({
        where: { id: { in: pendingBonuses.map((bonus) => bonus.id) }, status: 'PENDING' },
        data: { status: 'CLAIM_REQUESTED', claimId: newClaim.id },
      })
      return newClaim
    })

    if (!claim) {
      res.status(400).json({ success: false, message: 'You do not have an eligible referral reward to claim yet.' })
      return
    }

    const claimant = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } })
    await notifyReferralClaim(claim.id, `${claimant?.firstName || ''} ${claimant?.lastName || ''}`.trim(), claimant?.email || '', claim.amount, claim.bonusCount)
    res.status(201).json({ success: true, message: 'Your claim was sent to the administrator for approval.', data: claim })
  } catch (error) {
    console.error('Claim referral bonus error:', error)
    res.status(500).json({ success: false, message: 'Unable to submit referral claim.' })
  }
}
