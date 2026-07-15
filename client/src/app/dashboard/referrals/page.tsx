'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import toast from 'react-hot-toast'
import { CheckCircle2, Clipboard, Gift, Share2, Users, WalletCards } from 'lucide-react'

type Claim = { id: string; amount: number; bonusCount: number; status: string; createdAt: string }
type Summary = {
  referralCode: string
  registeredReferrals: number
  requiredReferrals: number
  remainingReferrals: number
  referralBalance: number
  walletBalance: number
  eligibleAmount: number
  eligibleBonusCount: number
  canWithdrawReferralRewards: boolean
  claims: Claim[]
}

export default function ReferralsPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('referrals')
      setSummary(data.data)
    } catch {
      toast.error('Unable to load referral rewards.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const referralLink = typeof window === 'undefined' || !summary
    ? ''
    : `${window.location.origin}/register?ref=${encodeURIComponent(summary.referralCode)}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
      toast.success('Your referral link is ready to share!')
    } catch {
      toast.error('Could not copy the link. Please copy it manually.')
    }
  }

  const share = async () => {
    const text = 'Join EcoCash with my link and help me reach 20 completed registrations to unlock my $100 referral bonus!'
    if (navigator.share) {
      try { await navigator.share({ title: 'Join EcoCash', text, url: referralLink }); return } catch { /* user cancelled: keep the page unchanged */ }
    }
    await copyLink()
  }

  const claim = async () => {
    setClaiming(true)
    try {
      const { data } = await api.post('referrals/claim')
      toast.success(data.message)
      await load()
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Unable to submit your claim.')
    } finally {
      setClaiming(false)
    }
  }

  if (loading || !summary) return <div className="py-16 text-center text-sm text-gray-500">Loading your referral rewards…</div>

  const progress = Math.min(100, (summary.registeredReferrals / summary.requiredReferrals) * 100)
  const statusClass = (status: string) => status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-brand-blue to-cyan-500 p-6 text-white shadow-xl sm:p-9">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
          <div className="max-w-xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold"><Gift size={15} /> Referral rewards</div>
            <h1 className="text-3xl font-bold tracking-tight">Share your link. Grow together.</h1>
            <p className="mt-3 text-sm leading-6 text-cyan-50">Each completed registration adds $5 to your referral balance. Fill all 20 slots to reach $100, then submit your claim for admin approval.</p>
          </div>
          <div className="rounded-2xl bg-white/15 px-5 py-4 backdrop-blur"><p className="text-xs uppercase tracking-wider text-cyan-100">Available to claim</p><p className="mt-1 text-3xl font-bold">${summary.eligibleAmount.toFixed(2)}</p></div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm md:col-span-2">
          <div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-gray-900">Registration progress</p><p className="mt-1 text-sm text-gray-500">{summary.registeredReferrals} of {summary.requiredReferrals} friends registered</p></div><Users className="text-brand-blue" size={28} /></div>
          <div className="mt-5 flex gap-1" aria-label={`${summary.registeredReferrals} of 20 referral slots filled`}>
            {Array.from({ length: summary.requiredReferrals }, (_, index) => <div key={index} className={`h-7 flex-1 rounded-sm transition-all ${index < summary.registeredReferrals ? 'bg-gradient-to-t from-brand-blue to-cyan-400 shadow-sm shadow-cyan-200' : 'bg-slate-100'}`} />)}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs font-medium"><span className="text-brand-blue">${summary.referralBalance.toFixed(2)} referral balance</span><span className="text-gray-500">{summary.registeredReferrals} / {summary.requiredReferrals} · $5 each</span></div>
          <p className="mt-2 text-xs font-medium text-gray-500">{summary.remainingReferrals ? `${summary.remainingReferrals} more registration${summary.remainingReferrals === 1 ? '' : 's'} to reach $100.` : 'Your referral balance is full — claim $100 now.'}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5"><WalletCards className="text-emerald-600" size={26} /><p className="mt-4 text-sm font-semibold text-emerald-950">${summary.walletBalance.toFixed(2)} dashboard rewards</p><p className="mt-1 text-xs text-emerald-700">{summary.canWithdrawReferralRewards ? 'Withdrawable: you have a confirmed package deposit.' : 'Complete a confirmed package deposit before these rewards can be withdrawn.'}</p></div>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm font-semibold text-gray-900">Your personal invite link</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row"><div className="min-w-0 flex-1 truncate rounded-xl border bg-slate-50 px-4 py-3 font-mono text-xs text-gray-600">{referralLink}</div><button onClick={copyLink} className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-blue px-4 py-3 text-sm font-semibold text-brand-blue transition hover:bg-brand-blue/5"><Clipboard size={17} /> Copy</button></div>
        <button onClick={share} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-blue via-blue-600 to-cyan-500 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 sm:w-auto"><Share2 size={18} /> Share your link & earn $100</button>
      </section>

      <section className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold text-gray-900">Claim your unlocked rewards</h2><p className="mt-1 text-sm text-gray-500">A Telegram approval request is sent to the administrator immediately.</p></div><button disabled={!summary.eligibleAmount || claiming} onClick={claim} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"><CheckCircle2 size={17} />{claiming ? 'Submitting…' : `Claim $${summary.eligibleAmount.toFixed(2)}`}</button></div>
        {summary.claims.length > 0 && <div className="mt-5 border-t pt-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Recent claims</p><div className="space-y-2">{summary.claims.map((claim) => <div key={claim.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-3 text-sm"><span className="font-medium text-gray-800">${claim.amount.toFixed(2)} · {claim.bonusCount} rewards</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(claim.status)}`}>{claim.status.replace('_', ' ')}</span></div>)}</div></div>}
      </section>
    </div>
  )
}
