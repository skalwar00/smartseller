'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Upload, Download, TrendingUp, TrendingDown, DollarSign, Package } from 'lucide-react'
import useSWR from 'swr'

interface OrderRow {
  orderId: string
  sku: string
  category: string
  unitCost: number
  status: string
  units: number
  settlement: number
  netProfit: number
}

interface Summary {
  totalSettlement: number
  totalProfit: number
  totalUnits: number
  categoryBreakdown: Record<string, { units: number; settlement: number; profit: number }>
}

// Extract design pattern from SKU
function getDesignPattern(masterSku: string): string {
  let sku = masterSku.toUpperCase().trim()
  sku = sku.replace(/[-_](S|M|L|XL|XXL|\d*XL|FREE|SMALL|LARGE)$/, '')
  sku = sku.replace(/\(.*?\)/g, '')
  return sku.trim().replace(/[-_]+$/, '')
}

async function fetchUserSettings() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const [mappingRes, costingRes] = await Promise.all([
    supabase.from('sku_mapping').select('portal_sku, master_sku').eq('user_id', user.id),
    supabase.from('design_costing').select('design_pattern, landed_cost').eq('user_id', user.id),
  ])

  const mappingDict: Record<string, string> = {}
  mappingRes.data?.forEach(item => {
    mappingDict[item.portal_sku.toUpperCase()] = item.master_sku
  })

  const costingDict: Record<string, number> = {}
  costingRes.data?.forEach(item => {
    costingDict[item.design_pattern] = item.landed_cost
  })

  return { mappingDict, costingDict }
}

export default function FlipkartAnalyzerPage() {
  const { data: settings } = useSWR('flipkart-settings', fetchUserSettings)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [stdCost, setStdCost] = useState(165)
  const [hfCost, setHfCost] = useState(110)

  const getCategoryAndCost = useCallback((skuName: string): [string, number] => {
    if (!settings) return ['Unknown', 0]
    
    const portalSku = skuName.trim().toUpperCase()
    const masterSku = settings.mappingDict[portalSku] || portalSku
    const pattern = getDesignPattern(masterSku)
    
    // Check costing DB first
    if (pattern in settings.costingDict) {
      return ['DB Match', settings.costingDict[pattern]]
    }

    // Fallback logic
    const isHF = portalSku.startsWith('HF')
    const baseCost = isHF ? hfCost : stdCost

    if (portalSku.includes('3CBO')) {
      return ['Combo 3', baseCost * 3]
    }
    if (portalSku.includes('CBO')) {
      return ['Combo 2', baseCost * 2]
    }

    return [isHF ? 'HF Single' : 'Std Single', baseCost]
  }, [settings, stdCost, hfCost])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !settings) return

    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/parse-excel', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to parse file')

      const data = await res.json()
      console.log("COLUMNS:", Object.keys(data.rows[0]))
      const rows: OrderRow[] = []
      const categoryBreakdown: Summary['categoryBreakdown'] = {}

      for (const row of data.rows) {
        
        console.log("ROW:", row)
        console.log("COLUMNS:", Object.keys(row))
        console.log("RAW Net Units:", row['Net Units'])
        console.log("TYPE:", typeof row['Net Units'])

        const skuCol = row['SKU Name'] || row['sku_name'] || ''
        const settlementCol = parseFloat(row['Bank Settlement [Projected] (INR)'] || row['settlement'] || 0)
        const unitsCol = parseInt(row['Net Units '] || row['units'] || 0)
        const orderIdCol = row['Order ID'] || row['order_id'] || ''
        const statusCol = row['Order Status'] || row['status'] || ''

        const [category, unitCost] = getCategoryAndCost(skuCol)
        const netProfit = unitsCol > 0 
          ? settlementCol - (unitsCol * unitCost)
          : settlementCol

        rows.push({
          orderId: orderIdCol,
          sku: skuCol,
          category,
          unitCost,
          status: statusCol,
          units: unitsCol,
          settlement: settlementCol,
          netProfit,
        })

        // Update category breakdown
        if (!categoryBreakdown[category]) {
          categoryBreakdown[category] = { units: 0, settlement: 0, profit: 0 }
        }
        categoryBreakdown[category].units += unitsCol
        categoryBreakdown[category].settlement += settlementCol
        categoryBreakdown[category].profit += netProfit
      }

      setOrders(rows)
      setSummary({
        totalSettlement: rows.reduce((sum, r) => sum + r.settlement, 0),
        totalProfit: rows.reduce((sum, r) => sum + r.netProfit, 0),
        totalUnits: rows.reduce((sum, r) => sum + r.units, 0),
        categoryBreakdown,
      })

      toast.success(`Analyzed ${rows.length} orders`)
    } catch (err) {
      toast.error('Failed to analyze file')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleExport = () => {
    if (orders.length === 0) return

    const csv = [
      ['Order ID', 'SKU', 'Category', 'Unit Cost', 'Status', 'Units', 'Settlement', 'Net Profit'].join(','),
      ...orders.map(o => [
        o.orderId,
        `"${o.sku}"`,
        o.category,
        o.unitCost,
        o.status,
        o.units,
        o.settlement.toFixed(2),
        o.netProfit.toFixed(2),
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flipkart-analysis-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const marginPercent = summary && summary.totalSettlement > 0
    ? ((summary.totalProfit / summary.totalSettlement) * 100).toFixed(1)
    : '0.0'

  return (
    <>
      <DashboardHeader 
        title="Flipkart Profit Analyzer" 
        description="Analyze your Flipkart orders P&L" 
      />
      
      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost Settings</CardTitle>
            <CardDescription>
              Default costs for products without DB costing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              <div className="w-40">
                <Label htmlFor="std-cost">Standard Pant (PT/PL)</Label>
                <Input
                  id="std-cost"
                  type="number"
                  value={stdCost}
                  onChange={(e) => setStdCost(parseInt(e.target.value) || 0)}
                  className="mt-1"
                />
              </div>
              <div className="w-40">
                <Label htmlFor="hf-cost">HF Series</Label>
                <Input
                  id="hf-cost"
                  type="number"
                  value={hfCost}
                  onChange={(e) => setHfCost(parseInt(e.target.value) || 0)}
                  className="mt-1"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* File Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Flipkart Orders</CardTitle>
            <CardDescription>
              Upload your Flipkart Orders P&L Excel file (.xlsx)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="flipkart-file">Orders Excel File</Label>
                <Input
                  id="flipkart-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  disabled={isProcessing}
                  className="mt-1"
                />
              </div>
              {orders.length > 0 && (
                <Button variant="outline" onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" />
                  Export Analysis
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Settlement</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  Rs {Math.round(summary.totalSettlement).toLocaleString('en-IN')}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
                {summary.totalProfit >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-500" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500" />
                )}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${summary.totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  Rs {Math.round(summary.totalProfit).toLocaleString('en-IN')}
                </div>
                <p className="text-xs text-muted-foreground">
                  {marginPercent}% margin
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Net Units Sold</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {summary.totalUnits.toLocaleString('en-IN')}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {orders.length.toLocaleString('en-IN')}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Category Breakdown */}
        {summary && Object.keys(summary.categoryBreakdown).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Category Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Settlement</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(summary.categoryBreakdown).map(([cat, data]) => (
                      <TableRow key={cat}>
                        <TableCell className="font-medium">{cat}</TableCell>
                        <TableCell className="text-right">{data.units}</TableCell>
                        <TableCell className="text-right">
                          Rs {Math.round(data.settlement).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${data.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          Rs {Math.round(data.profit).toLocaleString('en-IN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Orders Table */}
        {orders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Orders Breakdown</CardTitle>
              <CardDescription>
                Showing {Math.min(50, orders.length)} of {orders.length} orders
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Settlement</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.slice(0, 50).map((order, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{order.orderId}</TableCell>
                        <TableCell className="max-w-[150px] truncate text-sm" title={order.sku}>
                          {order.sku}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{order.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right">Rs {order.unitCost}</TableCell>
                        <TableCell className="text-xs">{order.status}</TableCell>
                        <TableCell className="text-right">{order.units}</TableCell>
                        <TableCell className="text-right">
                          Rs {Math.round(order.settlement).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${order.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          Rs {Math.round(order.netProfit).toLocaleString('en-IN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
