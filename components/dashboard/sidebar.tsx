'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  BarChart3,
  Package,
  DollarSign,
  ShoppingBag,
  Shirt,
  LogOut,
  Settings,
  ChevronUp,
  User,
} from 'lucide-react'
import type { User as SupabaseUser } from '@supabase/supabase-js'

interface PlanData {
  id: string
  user_id: string
  plan_type: string
  expiry_date: string
  created_at: string
}

interface DashboardSidebarProps {
  user: SupabaseUser
  planData: PlanData | null
}

const navItems = [
  {
    title: 'Picklist',
    url: '/dashboard',
    icon: Package,
    description: 'Process orders & generate picklists',
  },
  {
    title: 'Costing Manager',
    url: '/dashboard/costing',
    icon: DollarSign,
    description: 'Manage design-level costing',
  },
  {
    title: 'Flipkart Profit',
    url: '/dashboard/flipkart',
    icon: ShoppingBag,
    description: 'Analyze Flipkart orders',
  },
  {
    title: 'Myntra Profit',
    url: '/dashboard/myntra',
    icon: Shirt,
    description: 'Analyze Myntra settlement',
  },
]

export function DashboardSidebar({ user, planData }: DashboardSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [daysLeft, setDaysLeft] = useState(0)
  const [expiryDateStr, setExpiryDateStr] = useState('N/A')

  useEffect(() => {
    setMounted(true)
    if (planData) {
      const expiry = new Date(planData.expiry_date)
      const now = new Date()
      const diff = expiry.getTime() - now.getTime()
      setDaysLeft(Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24))))
      setExpiryDateStr(expiry.toLocaleDateString('en-IN'))
    }
  }, [planData])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const userInitials = user.email?.slice(0, 2).toUpperCase() || 'U'

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Aavoni</span>
            <span className="text-xs text-muted-foreground">Seller Suite</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.url === '/dashboard'
                        ? pathname === '/dashboard'
                        : pathname.startsWith(item.url)
                    }
                    tooltip={item.description}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Plan Status</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize">
                  {planData?.plan_type || 'Trial'}
                </span>
                <Badge variant={daysLeft > 7 ? 'default' : 'destructive'}>
                  {daysLeft} days left
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Expires: {mounted ? expiryDateStr : '...'}
              </p>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col text-left text-sm leading-tight">
                    <span className="truncate text-xs font-medium">{user.email}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {planData?.plan_type || 'Trial'} Plan
                    </span>
                  </div>
                  <ChevronUp className="ml-auto h-4 w-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56"
                side="top"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

export function DashboardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex flex-1 flex-col">
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </header>
  )
}
