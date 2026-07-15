import { Response } from 'express'
import { AuthRequest, authenticateToken } from '../middleware/auth.js'
import { prisma } from '../config/db.js'
import { notifyNewUser, notifyKYCSubmission } from '../services/telegramService.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { randomBytes } from 'crypto'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  referralCode: z.string().trim().min(4).max(64).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const register = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('Register request body:', req.body)
    const validated = registerSchema.parse(req.body)
    const { email, password, firstName, lastName, phone, referralCode: suppliedReferralCode } = validated

    const existingUser = await prisma.user.findUnique({ where: { email } })
    console.log('Existing user check:', existingUser ? 'exists' : 'new')
    if (existingUser) {
      res.status(400).json({ success: false, message: 'Email already registered' })
      return
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    console.log('Password hashed')

    const referralCode = suppliedReferralCode?.toUpperCase()
    const referrer = referralCode
      ? await prisma.user.findUnique({ where: { referralCode } })
      : null

    if (referralCode && !referrer) {
      res.status(400).json({ success: false, message: 'This referral link is invalid or has expired.' })
      return
    }

    const createUser = async (attempt = 0): Promise<any> => {
      const ownReferralCode = randomBytes(6).toString('hex').toUpperCase()
      try {
        return await prisma.$transaction(async (tx) => {
          const createdUser = await tx.user.create({
            data: {
              email,
              password: hashedPassword,
              firstName,
              lastName,
              phone,
              referralCode: ownReferralCode,
              referredById: referrer?.id,
              isVerified: false,
              isActive: false,
              kycStatus: 'PENDING',
            },
          })

          if (referrer) {
            // Each cycle accepts 20 registrations, each worth $5 to the referrer.
            const incremented = await tx.user.updateMany({
              where: { id: referrer.id, referralCycleCount: { lt: 20 } },
              data: { referralCycleCount: { increment: 1 }, referralBalance: { increment: 5 } },
            })
            if (incremented.count) {
              const updatedReferrer = await tx.user.findUnique({
                where: { id: referrer.id },
                select: { referralCycleCount: true },
              })
              if (updatedReferrer?.referralCycleCount === 20) {
                await tx.referralBonus.create({
                  data: { referrerId: referrer.id, beneficiaryId: referrer.id, eligibleAt: new Date() },
                })
              }
            }
          }

          return createdUser
        })
      } catch (error: any) {
        // An extremely unlikely referral-code collision is safe to retry.
        if (error?.code === 'P2002' && attempt < 2) return createUser(attempt + 1)
        throw error
      }
    }

    const createdUser = await createUser()
    const { password: _password, ...user } = createdUser
    console.log('User created:', user.id)

    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_CHAT_ID) {
      try {
        await notifyNewUser(email, user.id)
      } catch (notifyError) {
        console.error('Telegram notification error:', notifyError)
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    )

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please complete KYC to access your account.',
      data: { user, token },
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.errors })
      return
    }
    console.error('Register error:', error?.message || error, error?.stack)
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      details: error?.message || 'Unknown error',
      code: error?.code || null,
    })
  }
}

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const validated = loginSchema.parse(req.body)
    const { email, password } = validated

    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || !await bcrypt.compare(password, user.password)) {
      res.status(401).json({ success: false, message: 'Invalid credentials' })
      return
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    )

    const { password: _, ...userWithoutPassword } = user

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: { ...userWithoutPassword, avatar: (user as any).avatar },
        token,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.errors })
      return
    }
    console.error('Login error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const approveUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: true, isVerified: true, kycStatus: 'APPROVED' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        isVerified: true,
      },
    })

    res.status(200).json({ success: true, message: 'User approved', data: user })
  } catch (error) {
    console.error('Approve user error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const rejectUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId } = req.params

    await prisma.user.update({
      where: { id: userId },
      data: { isActive: false, kycStatus: 'REJECTED' },
    })

    res.status(200).json({ success: true, message: 'User rejected' })
  } catch (error) {
    console.error('Reject user error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const getPendingUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: false, role: 'INVESTOR' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        createdAt: true,
        kycStatus: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    res.status(200).json({ success: true, data: users })
  } catch (error) {
    console.error('Get pending users error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        isVerified: true,
        role: true,
        kycStatus: true,
        fullNameLegal: true,
        dateOfBirth: true,
        residentialAddress: true,
        country: true,
        idDocumentType: true,
        idDocumentNumber: true,
        idDocumentFrontUrl: true,
        idDocumentBackUrl: true,
        selfieUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    res.status(200).json({ success: true, data: user })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, phone } = req.body

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { firstName, lastName, phone },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isVerified: true,
        role: true,
      },
    })

    res.status(200).json({ success: true, message: 'Profile updated', data: user })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const uploadAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded' })
      return
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatar: avatarUrl },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
      },
    })

    res.status(200).json({ success: true, message: 'Avatar uploaded', data: user })
  } catch (error) {
    console.error('Upload avatar error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}

export const submitKYC = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] }
    const idDocumentFront = files?.idDocumentFront?.[0]
    const selfie = files?.selfie?.[0]

    console.log('KYC submit - files received:', { 
      idDocumentFront: idDocumentFront?.originalname || 'none', 
      selfie: selfie?.originalname || 'none',
      body: Object.keys(req.body) 
    })

    if (!idDocumentFront || !selfie) {
      res.status(400).json({ 
        success: false, 
        message: 'ID front and selfie are required',
        received: { hasIdFront: !!idDocumentFront, hasSelfie: !!selfie, files: Object.keys(files || {}) }
      })
      return
    }

    const { fullNameLegal, dateOfBirth, residentialAddress, idDocumentType, idDocumentNumber, country } = req.body

    const idFrontUrl = `/uploads/kyc/${idDocumentFront.filename}`
    const selfieUrl = `/uploads/kyc/${selfie.filename}`
    const idBackUrl = files?.idDocumentBack?.[0] ? `/uploads/kyc/${files.idDocumentBack[0].filename}` : null

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        fullNameLegal,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
        residentialAddress,
        idDocumentType,
        idDocumentNumber,
        country: country || 'Zimbabwe',
        idDocumentFrontUrl: idFrontUrl,
        idDocumentBackUrl: idBackUrl,
        selfieUrl,
        kycStatus: 'SUBMITTED',
      },
    })

    await notifyKYCSubmission(req.user!.id, `${req.user!.firstName} ${req.user!.lastName}`, selfieUrl, idFrontUrl, idBackUrl || undefined)

    res.status(200).json({ success: true, message: 'KYC submitted for verification' })
  } catch (error) {
    console.error('Submit KYC error:', error)
    res.status(500).json({ success: false, message: 'Server error' })
  }
}
