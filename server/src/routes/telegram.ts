import { Router, Request, Response } from 'express'
import TelegramBot from 'node-telegram-bot-api'
import { prisma } from '../config/db.js'
import { pendingProfitForAdmin, pendingTradeAfterDeposit } from '../utils/telegramState.js'
import { kvGet, kvSet } from '../utils/telegramKv.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || ''
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const secret = req.headers['x-bot-secret'] as string | undefined || 
                 (req.headers['x-telegram-bot-api-secret-token'] as string | undefined)
  const envSecret = process.env.BOT_SECRET
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  const validSecret = envSecret || webhookSecret || ''
  
  if (validSecret && secret !== validSecret) {
    res.status(401).json({ success: false, message: 'Unauthorized' })
    return
  }

  const body = req.body
  if (body.action === 'setup' && body.webhookUrl) {
    if (!BOT_TOKEN) {
      res.status(500).json({ success: false, message: 'Bot token not configured' })
      return
    }
    const fullUrl = `${body.webhookUrl}/webhook`
    const telegramBot = new TelegramBot(BOT_TOKEN, { polling: false })
    try {
      await telegramBot.setWebHook(fullUrl, { secret_token: WEBHOOK_SECRET || process.env.BOT_SECRET || undefined })
      res.json({ success: true, message: 'Webhook set', url: fullUrl })
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to set webhook', error })
    }
  } else {
    res.json({ success: true, message: 'Telegram bot endpoint ready', webhookPath: '/webhook' })
  }
})

const answerCallback = async (callbackQueryId: string, text?: string) => {
  if (!BOT_TOKEN) return
  try {
    const bot = new TelegramBot(BOT_TOKEN, { polling: false })
    await bot.answerCallbackQuery(callbackQueryId, { text: text || 'Processed' })
  } catch (err) {
    console.error('Answer callback error:', err)
  }
}

router.post('/webhook', async (req, res) => {
    const receivedSecret = req.get('X-Telegram-Bot-Api-Secret-Token') || 
                          req.headers['x-telegram-bot-api-secret-token'] as string | undefined
    const validSecret = process.env.BOT_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || ''
    
    if (validSecret && receivedSecret !== validSecret) {
      console.warn('Rejected Telegram webhook - secret token mismatch')
      res.sendStatus(200) // Return 200 to avoid Telegram retries
      return
    }

    res.sendStatus(200)
    try {
      const body = req.body

      if (body.message && body.message.text) {
      const chatId = body.message.chat.id
      const text = body.message.text

      if (text === '/start') {
        await sendMessage(chatId, 'Welcome to EcoCash Investment Bot\n\nCommands:\n/pending - View pending actions\n/users - List all users\n/investments - List investments')
      } else if (String(chatId) !== ADMIN_CHAT_ID) {
        console.warn(`Rejected Telegram command from non-admin chat ${chatId}`)
        await sendMessage(chatId, '❌ This command is restricted to the bot administrator.')
      } else if (text === '/pending') {
        const pending = await prisma.deposit.findMany({
          where: { status: 'WAITING_FOR_PAYMENT_DETAILS' },
          include: { user: true },
          take: 5,
        })
        const msg = pending.length
          ? `Pending Approvals:\n${pending.map((d: any) => `- ${d.user?.email}: $${d.amount}`).join('\n')}`
          : 'No pending actions.'
        await sendMessage(chatId, msg)
      } else if (text.toLowerCase().startsWith('ecocash:')) {
        const parts = text.substring(8).split(',')
        if (parts.length >= 2) {
            const number = parts[0].trim()
            const accountName = parts[1].trim()
            const deposit = await prisma.deposit.findFirst({
              where: { status: 'WAITING_FOR_PAYMENT_DETAILS' },
              orderBy: { createdAt: 'desc' },
              include: { user: true },
            })
            if (!deposit) {
              const chatIdStr = String(chatId)
              const notifyKey = `no_deposit_ctx:${chatIdStr}`
              if ((await kvGet(notifyKey)) !== '1') {
                await kvSet(notifyKey, '1')
                await sendMessage(chatId, '❌ No pending deposit found. Please check the admin panel.')
              }
              return
            }
            const updatedDeposit = await prisma.deposit.update({
              where: { id: deposit.id },
              data: {
                ecocashNumber: number,
                ecocashAccountName: accountName,
                status: 'PAYMENT_DETAILS_SENT',
              },
              include: { user: true },
            })
            if (updatedDeposit?.user?.telegramChatId) {
              await sendMessage(Number(updatedDeposit.user.telegramChatId),
                `💰 Payment Details Received!\n\nEcoCash Number: ${number}\nAccount Name: ${accountName}\n\nPlease make the payment and upload proof.`)
            }
            await sendMessage(chatId, '✅ Payment details sent to user!')
          }
        } else {
          const profitData = await pendingProfitForAdmin.get()
          if (profitData) {
            const amountMatch = text.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)$/)
            if (amountMatch) {
              const profitAmount = parseFloat(amountMatch[1])
              if (profitAmount > 0) {
                const investment = await prisma.investment.findUnique({ where: { id: profitData.id } })
                if (investment) {
                  const currentBalance = Number(investment.currentBalance || investment.depositAmount || 0)
                  const depositAmount = Number(investment.depositAmount || currentBalance)
                  const newBalance = currentBalance + profitAmount
                  const calculatedPercentage = profitAmount / depositAmount * 100
                  const updated = await prisma.investment.update({
                    where: { id: profitData.id },
                    data: {
                      currentBalance: newBalance,
                      profitAmount: profitAmount,
                      profitPercentage: calculatedPercentage,
                      profitActionRequiredAt: new Date(),
                    },
                    include: { user: true },
                  })
                  await sendMessage(chatId, `✅ Profit of $${profitAmount} added to investment ${updated.investmentId}. New balance: $${newBalance.toFixed(2)}`)
                } else {
                  await sendMessage(chatId, '❌ Investment not found.')
                }
                await pendingProfitForAdmin.delete()
              }
            }
          }
        }
      }

      if (body.callback_query) {
        const callbackQuery = body.callback_query
        const callbackData = callbackQuery.data
        const chatId = callbackQuery.message.chat.id
        const callbackQueryId = callbackQuery.id

        if (String(chatId) !== ADMIN_CHAT_ID) {
          console.warn(`Rejected Telegram callback from non-admin chat ${chatId}`)
          await answerCallback(callbackQueryId, 'Unauthorized')
          return
        }

        if (callbackData.startsWith('approve_referral_claim_')) {
          const claimId = callbackData.replace('approve_referral_claim_', '')
          await answerCallback(callbackQueryId, 'Approving referral reward...')
          await handleReferralClaim(claimId, chatId, true)
        } else if (callbackData.startsWith('reject_referral_claim_')) {
          const claimId = callbackData.replace('reject_referral_claim_', '')
          await answerCallback(callbackQueryId, 'Rejecting referral reward...')
          await handleReferralClaim(claimId, chatId, false)
        } else if (callbackData.startsWith('approve_user_')) {
          const userId = callbackData.replace('approve_user_', '')
          await answerCallback(callbackQueryId)
          await handleApproveUser(userId, chatId)
        } else if (callbackData.startsWith('reject_user_')) {
          const userId = callbackData.replace('reject_user_', '')
          await answerCallback(callbackQueryId)
          await handleRejectUser(userId, chatId)
        } else if (callbackData.startsWith('approve_kyc_')) {
          const userId = callbackData.replace('approve_kyc_', '')
          await answerCallback(callbackQueryId, 'Approving KYC...')
          await handleApproveKYC(userId, chatId)
        } else if (callbackData.startsWith('reject_kyc_')) {
          const userId = callbackData.replace('reject_kyc_', '')
          await answerCallback(callbackQueryId, 'Rejecting KYC...')
          await handleRejectKYC(userId, chatId)
        } else if (callbackData.startsWith('approve_deposit_')) {
          const depositId = callbackData.replace('approve_deposit_', '')
          await answerCallback(callbackQueryId, 'Approving deposit...')
          await handleApproveDeposit(depositId, chatId)
        } else if (callbackData.startsWith('reject_deposit_')) {
          const depositId = callbackData.replace('reject_deposit_', '')
          await answerCallback(callbackQueryId, 'Rejecting deposit...')
          await handleRejectDeposit(depositId, chatId)
        } else if (callbackData.startsWith('confirm_payment_')) {
          const depositId = callbackData.replace('confirm_payment_', '')
          await answerCallback(callbackQueryId, 'Confirming payment...')
          await handleApproveDeposit(depositId, chatId)
        } else if (callbackData.startsWith('reject_payment_')) {
          const depositId = callbackData.replace('reject_payment_', '')
          await answerCallback(callbackQueryId, 'Rejecting payment...')
          await handleRejectDeposit(depositId, chatId)
        } else if (callbackData.startsWith('start_trade_after_approve_')) {
          const depositId = callbackData.replace('start_trade_after_approve_', '')
          await answerCallback(callbackQueryId, 'Starting trade...')
          await handleStartTradeAfterApprove(depositId, chatId)
        } else if (callbackData.startsWith('dont_start_trade_')) {
          const depositId = callbackData.replace('dont_start_trade_', '')
          await answerCallback(callbackQueryId, 'Okay, trade not started.')
          await pendingTradeAfterDeposit.delete()
          await sendMessage(chatId, `ℹ️ Trade was not started for deposit ${depositId}. You can start it later from the admin panel.`)
        } else if (callbackData.startsWith('start_trade_')) {
          const investmentId = callbackData.replace('start_trade_', '')
          await answerCallback(callbackQueryId, 'Starting trade...')
          await handleStartTrade(investmentId, chatId)
        } else if (callbackData.startsWith('approve_investment_')) {
          const investmentId = callbackData.replace('approve_investment_', '')
          await answerCallback(callbackQueryId)
          await sendMessage(chatId, `Investment ${investmentId} approved via webhook.`)
        } else if (callbackData.startsWith('reject_investment_')) {
          const investmentId = callbackData.replace('reject_investment_', '')
          await answerCallback(callbackQueryId)
          await sendMessage(chatId, `Investment ${investmentId} rejected via webhook.`)
        } else if (callbackData.startsWith('reject_withdrawal_')) {
          const withdrawalId = callbackData.replace('reject_withdrawal_', '')
          await answerCallback(callbackQueryId, 'Rejecting withdrawal...')
          await handleRejectWithdrawal(withdrawalId, chatId)
        } else if (callbackData.startsWith('paid_withdrawal_')) {
          const withdrawalId = callbackData.replace('paid_withdrawal_', '')
          await answerCallback(callbackQueryId, 'Processing withdrawal...')
          await handlePaidWithdrawal(withdrawalId, chatId)
        } else {
          await answerCallback(callbackQueryId, 'Unknown action')
        }
      }
      } catch (error) {
      console.error('Telegram webhook error:', error)
    }
  })

const sendMessage = async (chatId: number, text: string, options?: TelegramBot.SendMessageOptions) => {
  if (!BOT_TOKEN) return
  try {
    const bot = new TelegramBot(BOT_TOKEN, { polling: false })
    await bot.sendMessage(chatId, text, options)
  } catch (error) {
    console.error('Send message error:', error)
  }
}

const handleReferralClaim = async (claimId: string, adminChatId: number, approved: boolean) => {
  try {
    const claim = await prisma.$transaction(async (tx) => {
      const result = await tx.referralClaim.updateMany({
        where: { id: claimId, status: 'PENDING' },
        data: { status: approved ? 'APPROVED' : 'REJECTED', reviewedAt: new Date(), reviewedBy: String(adminChatId) },
      })
      if (!result.count) return null

      const reviewedClaim = await tx.referralClaim.findUnique({ where: { id: claimId }, include: { user: true } })
      await tx.referralBonus.updateMany({
        where: { claimId, status: 'CLAIM_REQUESTED' },
        data: { status: approved ? 'APPROVED' : 'REJECTED' },
      })
      if (approved && reviewedClaim) {
        await tx.user.update({
          where: { id: reviewedClaim.userId },
          data: {
            walletBalance: { increment: reviewedClaim.amount },
            referralBalance: 0,
            referralCycleCount: 0,
          },
        })
      }
      return reviewedClaim
    })
    if (!claim) {
      await sendMessage(adminChatId, 'ℹ️ This referral claim has already been reviewed.')
      return
    }
    if (claim.user.telegramChatId) {
      await sendMessage(Number(claim.user.telegramChatId), approved
        ? `🎉 Your $${claim.amount.toFixed(2)} referral reward was approved and added to your dashboard balance. Your next 20-referral cycle has started.`
        : `Your referral reward claim for $${claim.amount.toFixed(2)} was not approved. Please contact support for details.`)
    }
    await sendMessage(adminChatId, approved ? '✅ Referral reward approved.' : '✅ Referral reward rejected.')
  } catch (error) {
    console.error('Referral claim review error:', error)
    await sendMessage(adminChatId, '❌ Failed to review referral claim.')
  }
}

const handleApproveUser = async (userId: string, adminChatId: number) => {
  try {
    const user = await prisma.$transaction(async (tx) => {
      const approved = await tx.user.updateMany({
        where: { id: userId, isActive: false },
        data: { isActive: true, isVerified: true, kycStatus: 'APPROVED' },
      })
      if (!approved.count) return null

      const approvedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, telegramChatId: true, referredById: true },
      })
      if (!approvedUser) throw new Error('Approved user not found')

      if (approvedUser.referredById) {
        const incremented = await tx.user.updateMany({
          where: { id: approvedUser.referredById, referralCycleCount: { lt: 20 } },
          data: { referralCycleCount: { increment: 1 }, referralBalance: { increment: 5 } },
        })
        if (incremented.count) {
          const updatedReferrer = await tx.user.findUnique({
            where: { id: approvedUser.referredById },
            select: { referralCycleCount: true },
          })
          if (updatedReferrer?.referralCycleCount === 20) {
            await tx.referralBonus.create({
              data: { referrerId: approvedUser.referredById, beneficiaryId: approvedUser.referredById, eligibleAt: new Date() },
            })
          }
        }
      }
      return approvedUser
    })

    if (!user) {
      await sendMessage(adminChatId, 'ℹ️ This user is already approved or cannot be approved.')
      return
    }
    
    if (user?.telegramChatId) {
      await sendMessage(Number(user.telegramChatId),
        `🎉 Congratulations! Your account has been approved. You can now log in and start investing.`)
    }
    await sendMessage(adminChatId, '✅ User approved and notified!')
  } catch (error) {
    console.error('Approve user error:', error)
    await sendMessage(adminChatId, '❌ Failed to approve user.')
  }
}

const handleRejectUser = async (userId: string, adminChatId: number) => {
  await sendMessage(adminChatId, 'User rejected.')
}

const handleApproveKYC = async (userId: string, adminChatId: number) => {
  try {
    // KYC may be reviewed more than once. Only the first transition from an
    // inactive account can complete a referral, preventing duplicate rewards.
    const user = await prisma.$transaction(async (tx) => {
      const approved = await tx.user.updateMany({
        where: { id: userId, isActive: false, kycStatus: 'SUBMITTED' },
        data: { kycStatus: 'APPROVED', isVerified: true, isActive: true },
      })
      if (!approved.count) return null

      const approvedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, telegramChatId: true, referredById: true },
      })
      if (!approvedUser) throw new Error('Approved user not found')

      if (approvedUser.referredById) {
        const incremented = await tx.user.updateMany({
          where: { id: approvedUser.referredById, referralCycleCount: { lt: 20 } },
          data: { referralCycleCount: { increment: 1 }, referralBalance: { increment: 5 } },
        })
        if (incremented.count) {
          const updatedReferrer = await tx.user.findUnique({
            where: { id: approvedUser.referredById },
            select: { referralCycleCount: true },
          })
          if (updatedReferrer?.referralCycleCount === 20) {
            await tx.referralBonus.create({
              data: { referrerId: approvedUser.referredById, beneficiaryId: approvedUser.referredById, eligibleAt: new Date() },
            })
          }
        }
      }
      return approvedUser
    })

    if (!user) {
      await sendMessage(adminChatId, 'ℹ️ This KYC submission was already reviewed or is not ready for approval.')
      return
    }
    
    if (user?.telegramChatId) {
      await sendMessage(Number(user.telegramChatId),
        `✅ KYC Approved! Your account is now fully verified and you can make investments.`)
    }
    await sendMessage(adminChatId, '✅ KYC approved and notified!')
  } catch (error) {
    console.error('Approve KYC error:', error)
    await sendMessage(adminChatId, '❌ Failed to approve KYC.')
  }
}

const handleRejectKYC = async (userId: string, adminChatId: number) => {
  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: 'REJECTED' },
    })
    if (user?.telegramChatId) {
      await sendMessage(Number(user.telegramChatId),
        `❌ Your KYC submission was rejected. Please check your documents and resubmit.`)
    }
    await sendMessage(adminChatId, '✅ KYC rejected and notified!')
  } catch (error) {
    console.error('Reject KYC error:', error)
    await sendMessage(adminChatId, '❌ Failed to reject KYC.')
  }
}

const handleApproveDeposit = async (depositId: string, adminChatId: number) => {
  try {
    const result = await prisma.deposit.updateMany({
      where: { id: depositId, status: 'PAYMENT_SUBMITTED' },
      data: { status: 'PAYMENT_RECEIVED' },
    })
    if (result.count === 0) {
      await sendMessage(adminChatId, 'ℹ️ This payment was already processed or is no longer awaiting approval.')
      return
    }
    const deposit = await prisma.deposit.findUnique({
      where: { id: depositId },
      include: { user: true, investment: true },
    })
    if (!deposit) throw new Error('Deposit not found after approval')
    if (deposit?.investmentId) {
      await prisma.investment.update({
        where: { id: deposit.investmentId },
        data: { status: 'PAYMENT_RECEIVED' },
      })
    }
    if (deposit?.user?.telegramChatId) {
      await sendMessage(Number(deposit.user.telegramChatId),
        `✅ Payment confirmed! Your investment is now active.\n\nInvestment: #${deposit.investment?.investmentId || 'N/A'}`)
    }
    await sendMessage(adminChatId, '✅ Payment approved and user notified!')

    if (deposit?.investmentId) {
      await pendingTradeAfterDeposit.set({ depositId, investmentId: deposit.investmentId })
      const buttons = [
        { text: '🚀 Start Trade Now', callback_data: `start_trade_after_approve_${depositId}` },
        { text: '⏸️ Later', callback_data: `dont_start_trade_${depositId}` },
      ]
      await sendMessage(adminChatId, `Do you want to start the trade now for investment #${deposit.investment?.investmentId || deposit.investmentId}?`, {
        reply_markup: { inline_keyboard: buttons.map((btn) => [{ text: btn.text, callback_data: btn.callback_data }]) },
      })
    }
  } catch (error) {
    console.error('Approve deposit error:', error)
    await sendMessage(adminChatId, '❌ Failed to approve payment.')
  }
}

const handleRejectDeposit = async (depositId: string, adminChatId: number) => {
  try {
    const result = await prisma.deposit.updateMany({
      where: { id: depositId, status: 'PAYMENT_SUBMITTED' },
      data: { status: 'REJECTED' },
    })
    if (result.count === 0) {
      await sendMessage(adminChatId, 'ℹ️ This payment was already processed or is no longer awaiting approval.')
      return
    }
    const deposit = await prisma.deposit.findUnique({
      where: { id: depositId },
      include: { user: true, investment: true },
    })
    if (!deposit) throw new Error('Deposit not found after rejection')
    if (deposit?.investmentId) {
      await prisma.investment.update({
        where: { id: deposit.investmentId },
        data: { status: 'REJECTED' },
      })
    }
    if (deposit?.user?.telegramChatId) {
      await sendMessage(Number(deposit.user.telegramChatId),
        `❌ Your payment was rejected. Please contact support for assistance.`)
    }
    await sendMessage(adminChatId, '✅ Payment rejected and user notified!')
  } catch (error) {
    console.error('Reject deposit error:', error)
    await sendMessage(adminChatId, '❌ Failed to reject payment.')
  }
}

const handleStartTrade = async (investmentId: string, adminChatId: number) => {
  try {
    const investment = await prisma.investment.findUnique({
      where: { id: investmentId },
      include: { plan: true, user: true },
    })
    if (!investment) throw new Error('Investment not found')

    const tradeStart = new Date()
    const tradeEnd = new Date(tradeStart.getTime() + (investment.plan?.tradeDurationHours || 6) * 60 * 60 * 1000)

    const result = await prisma.investment.updateMany({
      where: { id: investmentId, status: 'PAYMENT_RECEIVED' },
      data: {
        status: 'ACTIVE_TRADE',
        tradeStartDate: tradeStart,
        tradeEndDate: tradeEnd,
      },
    })
    if (result.count === 0) {
      await sendMessage(adminChatId, 'ℹ️ This trade was already started or can no longer be started.')
      return
    }

    if (investment.user?.telegramChatId) {
      await sendMessage(Number(investment.user.telegramChatId),
        `🚀 Your investment #${investment.investmentId} is now trading!\n\nAmount: $${investment.depositAmount}\nDuration: ${investment.plan?.tradeDurationHours || 6}h\nExpected Return: $${(Number(investment.depositAmount) * (investment.plan?.returnMultiplier || 1)).toFixed(2)}`)
    }
    await sendMessage(adminChatId, '✅ Trade started and user notified!')
  } catch (error) {
    console.error('Start trade error:', error)
    await sendMessage(adminChatId, '❌ Failed to start trade.')
  }
}

const handleStartTradeAfterApprove = async (depositId: string, adminChatId: number) => {
  try {
    const pending = await pendingTradeAfterDeposit.get()
    if (!pending || pending.depositId !== depositId) {
      await sendMessage(adminChatId, '❌ No pending trade start context found for this deposit.')
      return
    }
    await pendingTradeAfterDeposit.delete()
    await handleStartTrade(pending.investmentId, adminChatId)
  } catch (error) {
    console.error('Start trade after approve error:', error)
    await sendMessage(adminChatId, '❌ Failed to start trade after approval.')
  }
}

const handlePaidWithdrawal = async (withdrawalId: string, adminChatId: number) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true, investment: true },
    })
    if (!withdrawal) {
      await sendMessage(adminChatId, 'ℹ️ Withdrawal not found.')
      return
    }
    if (!withdrawal.isVerified) {
      await sendMessage(adminChatId, '⚠️ This withdrawal must be verified by the user first!')
      return
    }
    
    const feeMatch = withdrawal.transactionHash?.match(/Fee: ([\d.]+)/)
    const fee = Number(withdrawal.feeAmount) || (feeMatch ? Number(feeMatch[1]) : getWithdrawalFee(Number(withdrawal.amount)))
    const totalDeduct = Number(withdrawal.amount) + fee

    const paid = await prisma.$transaction(async (tx) => {
      const result = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'WITHDRAWAL_PENDING', isVerified: true },
        data: { status: 'WITHDRAWN', transactionHash: 'tx_' + Date.now() },
      })
      if (!result.count) return 'STATE_CHANGED' as const

      const deducted = withdrawal.balanceSource === 'REFERRAL'
        ? await tx.user.updateMany({ where: { id: withdrawal.userId, walletBalance: { gte: totalDeduct } }, data: { walletBalance: { decrement: totalDeduct } } })
        : await tx.investment.updateMany({ where: { id: withdrawal.investmentId, currentBalance: { gte: totalDeduct } }, data: { currentBalance: { decrement: totalDeduct } } })
      if (!deducted.count) throw new Error('INSUFFICIENT_SOURCE_BALANCE')
      return 'PAID' as const
    })
    if (paid === 'STATE_CHANGED') {
      await sendMessage(adminChatId, 'ℹ️ This withdrawal was already processed or is no longer pending.')
      return
    }
    
    if (withdrawal?.user?.telegramChatId) {
      await sendMessage(Number(withdrawal.user.telegramChatId),
        `💸 Your withdrawal has been processed! Amount: $${withdrawal.amount}`)
    }
    await sendMessage(adminChatId, `✅ Withdrawal processed!\n\nCard: ${withdrawal.cardNumber?.replace(/(\d{4})(?=\d)/g, '$1 ') || 'N/A'}\nHolder: ${withdrawal.cardholderName || 'N/A'}`)
  } catch (error) {
    console.error('Paid withdrawal error:', error)
    await sendMessage(adminChatId, '❌ Failed to process withdrawal.')
  }
}

const handleRejectWithdrawal = async (withdrawalId: string, adminChatId: number) => {
  try {
    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { user: true },
    })
    
    const result = await prisma.withdrawal.updateMany({
      where: { id: withdrawalId, status: { in: ['PROCESSING', 'WITHDRAWAL_PENDING'] } },
      data: { status: 'REJECTED' },
    })
    if (result.count === 0) {
      await sendMessage(adminChatId, 'ℹ️ This withdrawal was already processed or is no longer pending.')
      return
    }
    
    if (withdrawal?.user?.telegramChatId) {
      await sendMessage(Number(withdrawal.user.telegramChatId),
        `❌ Your withdrawal request for $${withdrawal?.amount || 'N/A'} was rejected. Please contact support.`)
    }
    await sendMessage(adminChatId, '✅ Withdrawal rejected!')
  } catch (error) {
    console.error('Reject withdrawal error:', error)
    await sendMessage(adminChatId, '❌ Failed to reject withdrawal.')
  }
}

const getWithdrawalFee = (amount: number): number => {
  const feePercent = 0.02
  const feeMin = 1
  const feeMax = 5
  const fee = amount * feePercent
  return Math.max(feeMin, Math.min(feeMax, fee))
}

export default router
