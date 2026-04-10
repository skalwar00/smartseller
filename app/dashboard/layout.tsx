import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Check trial status
  const { data: planData } = await supabase
    .from('users_plan')
    .select('*')
    .eq('user_id', user.id)
    .single()

  const isTrialExpired = planData 
    ? new Date(planData.expiry_date) < new Date()
    : true

  if (isTrialExpired && !planData) {
    // Create trial for existing users who don't have a plan
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + 14)
    
    await supabase.from('users_plan').insert({
      user_id: user.id,
      plan_type: 'trial',
      expiry_date: expiryDate.toISOString(),
    })
  } else if (isTrialExpired) {
    redirect('/trial-expired')
  }

  return (
    <SidebarProvider>
      <DashboardSidebar user={user} planData={planData} />
      <SidebarInset>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  )
}
