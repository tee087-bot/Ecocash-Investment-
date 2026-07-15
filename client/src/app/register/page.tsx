'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import { Eye, EyeOff, UserPlus, Mail, User, Phone } from 'lucide-react'

export default function RegisterPage() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const router = useRouter()
  const { login } = useAuth()

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('ref')
    if (code) setReferralCode(code.trim().toUpperCase())
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data } = await api.post('auth/register', { ...formData, ...(referralCode ? { referralCode } : {}) })
      localStorage.setItem('token', data.data.token)
      localStorage.setItem('user', JSON.stringify({
        ...data.data.user,
        firstName: data.data.user.firstName,
        lastName: data.data.user.lastName,
        phone: data.data.user.phone,
        kycStatus: data.data.user.kycStatus,
      }))
      toast.success('Registration successful! Please complete KYC.')
      router.push('/kyc')
    } catch (err: any) {
      const serverMessage = err.response?.data?.details || err.response?.data?.message || 'Registration failed'
      setError(serverMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl bg-dark-300 p-8 shadow-xl border border-gray-700">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-2.5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue to-cyan-500">
              <UserPlus className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-white">Create Account</h1>
            <p className="mt-1.5 text-gray-400 text-xs">Join EcoCash Investment Platform</p>
          </div>

          {error && (
            <div className="mb-3 rounded-lg bg-red-900/20 p-2.5 text-2xs text-red-400 border border-red-400/20">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-2.5">
            {referralCode && (
              <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-2xs text-cyan-100">
                You were invited through a referral link. Complete your registration to help your referrer reach their reward goal.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-2xs font-medium text-gray-400">First Name</label>
                <input
                  name="firstName"
                  type="text"
                  value={formData.firstName}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-600 bg-dark-400 px-3 py-2 text-xs text-white focus:border-brand-blue focus:outline-none"
                  required
                  placeholder="John"
                />
              </div>
              <div>
                <label className="block text-2xs font-medium text-gray-400">Last Name</label>
                <input
                  name="lastName"
                  type="text"
                  value={formData.lastName}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-600 bg-dark-400 px-3 py-2 text-xs text-white focus:border-brand-blue focus:outline-none"
                  required
                  placeholder="Doe"
                />
              </div>
            </div>
            <div>
              <label className="block text-2xs font-medium text-gray-400">Email</label>
              <input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-600 bg-dark-400 px-3 py-2 text-xs text-white focus:border-brand-blue focus:outline-none"
                required
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-gray-400">Phone</label>
              <input
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-600 bg-dark-400 px-3 py-2 text-xs text-white focus:border-brand-blue focus:outline-none"
                placeholder="+263..."
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-gray-400">Password</label>
              <div className="relative mt-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-600 bg-dark-400 px-3 py-2 text-xs text-white focus:border-brand-blue focus:outline-none"
                  required
                  minLength={6}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-2.5 text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-blue to-cyan-500 px-3 py-2 font-medium text-white text-xs hover:from-brand-blue/90 hover:to-cyan-500/90 disabled:opacity-50 transition-all"
            >
              <UserPlus size={14} />
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-5 text-center text-2xs text-gray-400">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-brand-blue hover:underline">
              Sign In
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
