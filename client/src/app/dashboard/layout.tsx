'use client'

import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, TrendingUp, Wallet, User, LogOut, Menu, X, Home, ArrowUpRight, BarChart3, Gift } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { href: '/dashboard', label: 'Home', icon: Home, color: 'text-blue-500' },
  { href: '/dashboard/investments', label: 'Invest', icon: TrendingUp, color: 'text-green-500' },
  { href: '/dashboard/trades', label: 'Trades', icon: BarChart3, color: 'text-purple-500' },
  { href: '/dashboard/deposits', label: 'Transactions', icon: Wallet, color: 'text-amber-500' },
  { href: '/dashboard/referrals', label: 'Referrals', icon: Gift, color: 'text-pink-500' },
  { href: '/dashboard/profile', label: 'Profile', icon: User, color: 'text-indigo-500' },
  { href: '/dashboard/withdrawals', label: 'Withdraw', icon: ArrowUpRight, color: 'text-red-500' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, token, logout, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!loading && !token) {
      router.push('/login')
    }
  }, [token, loading, router])

  if (loading) return <div className="flex h-screen items-center justify-center bg-gray-50">Loading...</div>
  if (!token) return null

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white border-r transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-brand-blue to-brand-sky" />
            <span className="text-lg font-bold">
              <span className="text-brand-blue">ECO</span><span className="text-red-500">CASH</span>
            </span>
          </div>
          <button className="lg:hidden text-gray-500 hover:text-gray-700" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>
        <nav className="space-y-1 p-4">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                pathname === item.href || (item.href === '/dashboard' && pathname === '/dashboard')
                  ? 'bg-brand-blue/10 text-brand-blue'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <item.icon size={20} className={item.color} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-4 w-full px-4">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="flex-1 lg:ml-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-4 lg:px-6 shadow-sm">
          <button className="lg:hidden text-gray-600 hover:text-gray-900" onClick={() => setSidebarOpen(true)}>
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-blue to-brand-sky flex items-center justify-center text-sm font-medium text-white">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <span className="hidden sm:block text-sm font-medium text-gray-900">
              {user?.firstName} {user?.lastName}
            </span>
          </div>
          {user?.kycStatus === 'APPROVED' && (
            <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
              Verified
            </span>
          )}
        </header>
        <div className="p-4 lg:p-6 pb-24 lg:pb-6">{children}</div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white lg:hidden">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 text-xs font-medium ${
                  isActive ? 'text-brand-blue' : 'text-gray-500'
                }`}
              >
                <item.icon size={22} className={isActive ? 'text-brand-blue' : item.color} />
                <span className="text-2xs">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}