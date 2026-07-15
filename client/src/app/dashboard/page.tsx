'use client'

import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import { Wallet, TrendingUp, ArrowUpRight, ArrowDownRight, Zap, TrendingDown, Activity, AlertCircle, X } from 'lucide-react'
import ActiveTradeSimulator from '@/components/ActiveTradeSimulator'

export default function DashboardPage() {
  const { user, token } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState({
    totalDeposited: 0,
    activeInvestments: 0,
    currentBalance: 0,
    totalProfit: 0,
    walletBalance: 0,
  })
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [requestingProfit, setRequestingProfit] = useState(false)
  const [activeInvestments, setActiveInvestments] = useState<any[]>([])
  const [simulationInvestment, setSimulationInvestment] = useState<any | null>(null)
  const [stoppedInvestments, setStoppedInvestments] = useState<Set<string>>(new Set())
  const [showStopPopup, setShowStopPopup] = useState(false)
  const [popupInvestment, setPopupInvestment] = useState<any | null>(null)
  const [showWithdrawalPopup, setShowWithdrawalPopup] = useState(false)
  const profitDetectedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [investmentResponse, referralResponse] = await Promise.all([api.get('investments'), api.get('referrals')])
        const data = investmentResponse.data
        const userInvestments = data.data || []
        const activeInv = userInvestments.filter((inv: any) => 
          inv.status === 'PAYMENT_RECEIVED' || inv.status === 'ACTIVE_TRADE'
        )
        const activeCount = activeInv.length
        const totalDeposited = activeInv.reduce((sum: number, inv: any) => sum + Number(inv.depositAmount), 0)
        const totalProfit = activeInv.reduce((sum: number, inv: any) => sum + Number(inv.profitAmount || 0), 0)
        
        activeInv.forEach((inv: any) => {
          if (
            inv.status === 'ACTIVE_TRADE' &&
            inv.profitActionRequiredAt &&
            !profitDetectedRef.current.has(inv.investmentId) &&
            !stoppedInvestments.has(inv.investmentId)
          ) {
            profitDetectedRef.current.add(inv.investmentId)
            setPopupInvestment(inv)
            setShowStopPopup(true)
          }
        })
        
        setStats({
          totalDeposited,
          activeInvestments: activeCount,
          currentBalance: activeInv.reduce((sum: number, inv: any) => sum + Number(inv.currentBalance), 0) + Number(referralResponse.data.data?.walletBalance || 0),
          totalProfit,
          walletBalance: Number(referralResponse.data.data?.walletBalance || 0),
        })
        setActiveInvestments(activeInv)
      } catch (err) {
        console.error(err)
      }
    }
    if (!token) return
    fetchStats()
    const interval = window.setInterval(fetchStats, 10_000)
    return () => window.clearInterval(interval)
  }, [token, stoppedInvestments])

  useEffect(() => {
    const fetchRecent = async () => {
      try {
        const [invRes, depRes] = await Promise.all([
          api.get('investments'),
          api.get('deposits'),
        ])
        const investments = (invRes.data.data || []).slice(0, 3).map((inv: any) => ({
          type: 'investment',
          id: inv.investmentId,
          plan: inv.plan?.name || 'Plan',
          amount: inv.depositAmount,
          status: inv.status,
          date: inv.createdAt,
        }))
        const deposits = (depRes.data.data || []).slice(0, 3).map((dep: any) => ({
          type: 'deposit',
          id: dep.id,
          method: dep.paymentMethod,
          amount: dep.amount,
          status: dep.status,
          date: dep.createdAt,
        }))
        const combined = [...investments, ...deposits]
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 5)
        setRecentActivity(combined)
      } catch (err) {
        console.error(err)
      }
    }
    if (token) fetchRecent()
  }, [token, stats.activeInvestments])

  const formatCurrency = (amount: number) => {
    return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE_TRADE':
      case 'PAYMENT_RECEIVED':
        return 'bg-green-50 text-green-700 border border-green-200'
      case 'PENDING':
      case 'WAITING_FOR_PAYMENT_DETAILS':
      case 'PAYMENT_DETAILS_SENT':
        return 'bg-yellow-50 text-yellow-700 border border-yellow-200'
      case 'CLOSED':
      case 'WITHDRAWN':
        return 'bg-brand-blue/10 text-brand-blue border border-brand-blue/20'
      case 'REJECTED':
        return 'bg-red-50 text-red-700 border border-red-200'
      default:
        return 'bg-gray-50 text-gray-700 border border-gray-200'
    }
  }

  const handleTradeAction = async (action: 'stop' | 'continue') => {
    if (!popupInvestment) return
    try {
      const response = await api.post(`investments/${popupInvestment.investmentId}/user-action`, { action })
      console.log('User action response:', response.data)
      if (action === 'stop') {
        setStoppedInvestments((prev) => new Set(prev).add(popupInvestment.investmentId))
        if (simulationInvestment?.investmentId === popupInvestment.investmentId) {
          setSimulationInvestment(null)
        }
        setShowStopPopup(false)
        setShowWithdrawalPopup(true)
        toast.success('Trade stop request sent to admin')
      } else {
        toast.success('Trade will continue - admin notified')
        setShowStopPopup(false)
      }
    } catch (err: any) {
      console.error('User action error:', err.response?.data || err.message)
      const msg = err.response?.data?.message || err.message || 'Unknown error'
      if (err.response?.status === 401) {
        toast.error('Please log in to continue')
        router.push('/login')
      } else if (err.response?.status === 403) {
        toast.error('Access denied. Please check your session.')
      } else {
        toast.error('Failed to send action: ' + msg)
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Hello, {user?.firstName}
          {user?.kycStatus === 'APPROVED' && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified
            </span>
          )}
        </h1>
        <p className="text-sm text-gray-500">Welcome back to your investment dashboard</p>
      </div>

      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-blue via-brand-sky to-brand-light p-6 text-white shadow-2xl">
        <div className="absolute inset-0 opacity-10">
          <div className="h-full w-full bg-[radial-gradient(circle_at_30%_70%,white,transparent_70%)]" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/80">Total Balance</p>
              <p className="mt-1 text-3xl font-bold">{formatCurrency(stats.currentBalance)}</p>
              {stats.walletBalance > 0 && <p className="mt-1 text-xs text-cyan-100">Includes {formatCurrency(stats.walletBalance)} in approved referral rewards</p>}
            </div>
            <div className="rounded-2xl bg-white/20 p-3 backdrop-blur-sm">
              <Wallet className="h-7 w-7" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <p className="text-xs text-white/70">Total Invested</p>
              <p className="mt-1 text-lg font-semibold">{formatCurrency(stats.totalDeposited)}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/70">Total Profit</p>
                  <div className="flex items-center gap-1">
                    <p className={`mt-1 text-lg font-semibold ${stats.totalProfit >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                      {stats.totalProfit >= 0 ? '+' : ''}{formatCurrency(Math.abs(stats.totalProfit))}
                    </p>
                    {stats.totalProfit > 0 && (
                      <TrendingUp className="h-4 w-4 text-green-300" />
                    )}
                    {stats.totalProfit < 0 && (
                      <TrendingDown className="h-4 w-4 text-red-300" />
                    )}
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={async () => {
                      if (stats.activeInvestments === 0) {
                        toast('No active investments to track profit')
                        return
                      }
                      setRequestingProfit(true)
                      try {
                        await api.post('notifications/profit-request')
                      } catch (err) {
                        toast.error('Failed to request profit update')
                      } finally {
                        setRequestingProfit(false)
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-green-300/20 px-3 py-1.5 text-xs font-medium text-green-300 transition-all hover:bg-green-300/30 disabled:opacity-60"
                    title="Click to see profit made so far"
                    disabled={requestingProfit}
                  >
                    Track Profit
                    {requestingProfit && <div className="h-3 w-3 animate-spin rounded-full border border-green-300 border-t-transparent" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Quick Actions</h2>
        <div className="grid grid-cols-4 gap-3">
          <button
            onClick={() => router.push('/dashboard/deposits')}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 hover:border-brand-sky/30 hover:shadow-md transition-all duration-200"
          >
            <div className="rounded-xl bg-green-50 p-2.5">
              <ArrowDownRight className="h-4 w-4 text-green-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Transactions</span>
          </button>
          <button
            onClick={() => router.push('/dashboard/investments')}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 hover:border-brand-sky/30 hover:shadow-md transition-all duration-200"
          >
            <div className="rounded-xl bg-brand-blue/10 p-2.5">
              <TrendingUp className="h-4 w-4 text-brand-blue" />
            </div>
            <span className="text-xs font-medium text-gray-700">Invest</span>
          </button>
          <button
            onClick={() => router.push('/dashboard/withdrawals')}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 hover:border-brand-sky/30 hover:shadow-md transition-all duration-200"
          >
            <div className="rounded-xl bg-purple-50 p-2.5">
              <ArrowUpRight className="h-4 w-4 text-purple-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Withdraw</span>
          </button>
          <button
            onClick={() => router.push('/dashboard/profile')}
            className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 shadow-sm border border-gray-100 hover:border-brand-sky/30 hover:shadow-md transition-all duration-200"
          >
            <div className="rounded-xl bg-orange-50 p-2.5">
              <Zap className="h-4 w-4 text-orange-600" />
            </div>
            <span className="text-xs font-medium text-gray-700">Profile</span>
          </button>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Active Investments</h2>
          <button
            onClick={() => router.push('/dashboard/investments')}
            className="text-sm font-medium text-brand-blue hover:text-brand-blue/80"
          >
            View All
          </button>
        </div>
        {stats.activeInvestments === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
              <TrendingUp className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900">No active investments</p>
            <p className="mt-1 text-xs text-gray-500">Start investing to see your trades here</p>
            <button
              onClick={() => router.push('/dashboard/investments')}
              className="mt-4 rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky px-5 py-2 text-sm font-medium text-white hover:from-brand-blue/90 hover:to-brand-sky/90 transition-all duration-200"
            >
              Start Investing
            </button>
          </div>
        ) : simulationInvestment ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Live Trade Session</h3>
                <p className="text-sm text-gray-500">
                  Investment #{simulationInvestment.investmentId} | {simulationInvestment.plan?.name || 'Plan'} | ${Number(simulationInvestment.depositAmount).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSimulationInvestment(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
            </div>
            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              <ActiveTradeSimulator
                investmentId={simulationInvestment.investmentId}
                depositAmount={Number(simulationInvestment.depositAmount)}
                currentProfit={Number(simulationInvestment.profitAmount || 0)}
                currentBalance={Number(simulationInvestment.currentBalance || 0)}
                status={simulationInvestment.status}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {activeInvestments.slice(0, 3).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-brand-blue/10 p-2.5">
                    <TrendingUp className="h-4 w-4 text-brand-blue" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{inv.plan?.name || 'Plan'}</p>
                    <p className="text-xs text-gray-500">#{inv.investmentId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">${Number(inv.depositAmount).toLocaleString()}</p>
                    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${getStatusColor(inv.status)}`}>
                      {inv.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {(inv.status === 'ACTIVE_TRADE' || inv.status === 'PAYMENT_RECEIVED') && !stoppedInvestments.has(inv.investmentId) && (
                    <button
                      onClick={() => setSimulationInvestment(inv)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#F0B90B] px-3 py-2 text-xs font-semibold text-[#0B0E11] hover:bg-[#D0980B] transition-colors"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      Live Trade
                    </button>
                  )}
                  {stoppedInvestments.has(inv.investmentId) && (
                    <button
                      disabled
                      className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500 cursor-not-allowed"
                    >
                      Trade Ended
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showStopPopup && popupInvestment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-brand-blue" />
                <h3 className="text-lg font-semibold text-gray-900">Trade Action Required</h3>
              </div>
              <button onClick={() => setShowStopPopup(false)} className="text-gray-500 hover:text-gray-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Your investment #{popupInvestment.investmentId} has generated profit. Would you like to stop the trade or continue?
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-gray-500">Current P&L:</span>
              <span className={`text-sm font-bold ${Number(popupInvestment.profitAmount || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {Number(popupInvestment.profitAmount || 0) >= 0 ? '+' : '-'}{formatCurrency(Math.abs(Number(popupInvestment.profitAmount || 0)))}
              </span>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleTradeAction('stop')}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
              >
                Stop Trade
              </button>
              <button
                onClick={() => handleTradeAction('continue')}
                className="flex-1 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-600 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {showWithdrawalPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Trade Ended</h3>
            <p className="text-sm text-gray-600 mb-4">
              You ended the trade. You can now withdraw your profits from the withdrawals page.
            </p>
            <button
              onClick={() => {
                setShowWithdrawalPopup(false)
                router.push('/dashboard/withdrawals')
              }}
              className="rounded-lg bg-gradient-to-r from-brand-blue to-brand-sky px-6 py-2.5 text-sm font-semibold text-white hover:from-brand-blue/90 hover:to-brand-sky/90 transition-all"
            >
              Go to Withdraw
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
