'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Upload, Download } from 'lucide-react'
import useSWR from 'swr'

interface Order {
  orderId: string
  sku: string
  orderType: string
  forwardAmt: number
  reverseAmt: number
  netSettlement: number
  status: string
  unitCost: number
  totalCost: number
  netProfit: number
}

// ✅ ₹ FORMAT (NO DECIMAL)
const formatINR = (num: number) => {
  return Math.round(num).toLocaleString('en-IN')
}

// SKU pattern
function getDesignPattern(sku: string) {
  return sku.toUpperCase().replace(/[-_].*$/, '')
}

// settings fetch
async function fetchUserSettings() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [mappingRes, costingRes] = await Promise.all([
    supabase.from('sku_mapping').select('*').eq('user_id', user?.id),
    supabase.from('design_costing').select('*').eq('user_id', user?.id),
  ])

  const mappingDict: any = {}
  mappingRes.data?.forEach((i: any) => {
    mappingDict[i.portal_sku?.toUpperCase()] = i.master_sku
  })

  const costingDict: any = {}
  costingRes.data?.forEach((i: any) => {
    costingDict[i.design_pattern] = i.landed_cost
  })

  return { mappingDict, costingDict }
}

export default function Page() {
  const { data: settings } = useSWR('settings', fetchUserSettings)

  const [files, setFiles] = useState<File[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  // COST LOGIC
  const getCost = useCallback((sku: string) => {
    if (!settings) return 0

    const mapped = settings.mappingDict[sku] || sku
    const pattern = getDesignPattern(mapped)

    if (settings.costingDict[pattern]) return settings.costingDict[pattern]

    if (sku.startsWith('HF')) return sku.includes('CBO') ? 230 : 115
    if (sku.startsWith('PT')) return sku.includes('CBO') ? 330 : 165

    return 0
  }, [settings])

  // FILE UPLOAD
  const handleUpload = (e: any) => {
    const selected = Array.from(e.target.files)

    const invalid = selected.filter(
      (f: any) => !f.name.toLowerCase().endsWith('.csv')
    )

    if (invalid.length > 0) {
      toast.error('Only CSV files allowed ❌')
      return
    }

    setFiles(selected as File[]);
  }

  // ANALYZE
  const handleAnalyze = async () => {
    if (files.length < 3) {
      toast.error('Upload at least 3 files')
      return
    }

    setLoading(true)

    try {
      const formData = new FormData()
      files.forEach(f => formData.append('files', f))

      const res = await fetch('/api/analyze-myntra', {
        method: 'POST',
        body: formData,
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      const processed: Order[] = json.data.map((r: any) => {
        const unitCost = getCost(r.sku)
        const isDelivered = r.status?.toLowerCase() === 'delivered'
        const totalCost = isDelivered ? unitCost : 0
        const netProfit = r.netSettlement - totalCost

        return {
          ...r,
          unitCost,
          totalCost,
          netProfit,
        }
      })

      setOrders(processed)

      // SUMMARY
      const totalSettlement = processed.reduce((s, r) => s + r.netSettlement, 0)
      const totalCost = processed.reduce((s, r) => s + r.totalCost, 0)
      const totalProfit = processed.reduce((s, r) => s + r.netProfit, 0)

      setSummary({
        totalSettlement,
        totalCost,
        totalProfit,
        margin: totalSettlement ? (totalProfit / totalSettlement) * 100 : 0,
      })

      toast.success('Analysis Done ✅')

    } catch (e) {
      console.error(e)
      toast.error('Error')
    }

    setLoading(false)
  }

  // EXPORT
  const download = () => {
    const csv = [
      ['Order', 'SKU', 'Type', 'Settlement', 'Profit'],
      ...orders.map(o => [
        o.orderId,
        o.sku,
        o.orderType,
        o.netSettlement,
        o.netProfit,
      ])
    ].map(r => r.join(',')).join('\n')

    const blob = new Blob([csv])
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = 'myntra-analysis.csv'
    a.click()
  }

  return (
    <>
      <DashboardHeader title="Myntra Analyzer" description="Smart P&L Dashboard" />

      <div className="p-6 space-y-6">

        {/* UPLOAD */}
        <Card>
          <CardHeader>
            <CardTitle>Upload CSV Files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" multiple accept=".csv" onChange={handleUpload} />
            <Button onClick={handleAnalyze} disabled={loading}>
              <Upload className="mr-2 h-4 w-4" />
              Analyze
            </Button>
          </CardContent>
        </Card>

        {/* SUMMARY */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            <Card><CardContent className="p-4">
              <div className="text-sm">Net Payout</div>
              <div className="text-xl font-bold">
                ₹{formatINR(summary.totalSettlement)}
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-4">
              <div className="text-sm">Total Cost</div>
              <div className="text-xl font-bold">
                ₹{formatINR(summary.totalCost)}
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-4">
              <div className="text-sm">Profit</div>
              <div className={`text-xl font-bold ${
                summary.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                ₹{formatINR(summary.totalProfit)}
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-4">
              <div className="text-sm">Margin</div>
              <div className="text-xl font-bold">
                {summary.margin.toFixed(1)}%
              </div>
            </CardContent></Card>

          </div>
        )}

        {/* TABLE */}
        {orders.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row justify-between">
              <CardTitle>Orders</CardTitle>
              <Button onClick={download}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </CardHeader>

            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Settlement</TableHead>
                    <TableHead>Profit</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {orders.slice(0, 50).map((o, i) => (
                    <TableRow key={i}>
                      <TableCell>{o.orderId}</TableCell>
                      <TableCell>{o.sku}</TableCell>
                      <TableCell>
                        <Badge>{o.orderType}</Badge>
                      </TableCell>
                      <TableCell>₹{formatINR(o.netSettlement)}</TableCell>
                      <TableCell className={
                        o.netProfit >= 0 ? 'text-green-600' : 'text-red-600'
                      }>
                        ₹{formatINR(o.netProfit)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>

              </Table>
            </CardContent>
          </Card>
        )}

      </div>
    </>
  )
}