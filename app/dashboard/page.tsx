'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DashboardHeader } from '@/components/dashboard/sidebar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Download, Save, RefreshCw } from 'lucide-react'
import useSWR, { mutate } from 'swr'
import Fuse from 'fuse.js'

interface OrderData {
  Portal_SKU: string
  Qty: number
  Master_SKU?: string
}

interface MappingRow {
  confirm: boolean
  portalSku: string
  masterSku: string
  matchScore: number
}

// Token Set Ratio - matches thefuzz behavior
function tokenSetRatio(str1: string, str2: string): number {
  const s1 = str1.toUpperCase().trim()
  const s2 = str2.toUpperCase().trim()
  
  if (s1 === s2) return 100
  
  // Tokenize
  const tokens1 = new Set(s1.split(/[-_\s]+/).filter(Boolean))
  const tokens2 = new Set(s2.split(/[-_\s]+/).filter(Boolean))
  
  // Intersection
  const intersection = [...tokens1].filter(t => tokens2.has(t))
  
  // Sorted intersection
  const sortedIntersection = intersection.sort().join(' ')
  
  // Sorted tokens
  const sorted1 = [...tokens1].sort().join(' ')
  const sorted2 = [...tokens2].sort().join(' ')
  
  // Combined sets
  const combined1 = sortedIntersection + ' ' + [...tokens1].filter(t => !tokens2.has(t)).sort().join(' ')
  const combined2 = sortedIntersection + ' ' + [...tokens2].filter(t => !tokens1.has(t)).sort().join(' ')
  
  // Calculate simple ratio for each pair
  const ratios = [
    simpleRatio(sortedIntersection, sorted1),
    simpleRatio(sortedIntersection, sorted2),
    simpleRatio(sorted1, sorted2),
    simpleRatio(combined1.trim(), combined2.trim()),
  ]
  
  return Math.max(...ratios)
}

function simpleRatio(s1: string, s2: string): number {
  if (!s1 && !s2) return 100
  if (!s1 || !s2) return 0
  
  const longer = s1.length >= s2.length ? s1 : s2
  const shorter = s1.length >= s2.length ? s2 : s1
  
  if (longer.length === 0) return 100
  
  // Levenshtein distance
  const matrix: number[][] = []
  for (let i = 0; i <= shorter.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= longer.length; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= shorter.length; i++) {
    for (let j = 1; j <= longer.length; j++) {
      if (shorter[i - 1] === longer[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  
  const distance = matrix[shorter.length][longer.length]
  return Math.round(((longer.length - distance) / longer.length) * 100)
}

async function fetchUserData() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const [mappingRes, inventoryRes] = await Promise.all([
    supabase.from('sku_mapping').select('portal_sku, master_sku').eq('user_id', user.id),
    supabase.from('master_inventory').select('master_sku').eq('user_id', user.id),
  ])

  const mappingDict: Record<string, string> = {}
  mappingRes.data?.forEach(item => {
    mappingDict[item.portal_sku.toUpperCase()] = item.master_sku
  })

  const masterOptions = inventoryRes.data?.map(i => i.master_sku.toUpperCase()) || []

  return { mappingDict, masterOptions, userId: user.id }
}

export default function PicklistPage() {
  const { data, error, isLoading } = useSWR('user-data', fetchUserData)
  const [orders, setOrders] = useState<OrderData[]>([])
  const [unmappedRows, setUnmappedRows] = useState<MappingRow[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [masterFile, setMasterFile] = useState<File | null>(null)

  // CSV column detection matching Streamlit logic exactly
  const findSkuColumn = (headers: string[]): number => {
    const normalizedHeaders = headers.map(h => h.trim().toLowerCase())
    
    // Priority columns for Myntra (exact match from Streamlit)
    const priorityCols = [
      'seller_sku_code',
      'seller sku code',
      'seller_sku',
      'seller sku'
    ]
    
    // Check priority columns first
    for (const pCol of priorityCols) {
      const idx = normalizedHeaders.findIndex(h => h === pCol)
      if (idx !== -1) return idx
    }
    
    // Fallback: any column with 'sku' in name
    const fallbackIdx = normalizedHeaders.findIndex(h => h.includes('sku'))
    return fallbackIdx
  }

  const findQtyColumn = (headers: string[]): number => {
    const normalizedHeaders = headers.map(h => h.trim().toLowerCase())
    return normalizedHeaders.findIndex(h => 
      h.includes('qty') || h.includes('quantity') || h.includes('units')
    )
  }

  const handleOrderUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !data) return

    setIsProcessing(true)
    const allOrders: OrderData[] = []

    try {
      for (const file of Array.from(files)) {
        if (file.name.endsWith('.csv')) {
          const text = await file.text()
          const lines = text.split('\n').filter(l => l.trim())
          
          if (lines.length === 0) {
            toast.error(`Empty file: ${file.name}`)
            continue
          }

          // Clean column names (strip whitespace)
          const rawHeaders = lines[0].split(',')
          const headers = rawHeaders.map(h => h.trim())
          
          const skuIndex = findSkuColumn(headers)
          const qtyIndex = findQtyColumn(headers)

          if (skuIndex === -1) {
            toast.error(`SKU column not found in ${file.name}`)
            continue
          }

          console.log(`[v0] Using SKU Column: ${headers[skuIndex]} (index: ${skuIndex})`)

          for (let i = 1; i < lines.length; i++) {
            // Handle CSV parsing with potential commas in quoted fields
            const cols = parseCSVLine(lines[i])
            
            if (cols[skuIndex]) {
              const skuVal = cols[skuIndex].trim().toUpperCase().replace(/"/g, '')
              
              // Myntra default qty is 1
              let qtyVal = 1
              if (qtyIndex !== -1 && cols[qtyIndex]) {
                const parsed = parseInt(cols[qtyIndex].replace(/"/g, ''), 10)
                if (!isNaN(parsed)) qtyVal = parsed
              }

              if (skuVal) {
                allOrders.push({ Portal_SKU: skuVal, Qty: qtyVal })
              }
            }
          }
        } else if (file.name.endsWith('.pdf')) {
          // For PDF (Meesho), send to API route
          const formData = new FormData()
          formData.append('file', file)
          
          const res = await fetch('/api/parse-pdf', {
            method: 'POST',
            body: formData,
          })
          
          if (res.ok) {
            const pdfOrders = await res.json()
            allOrders.push(...pdfOrders)
          } else {
            toast.error(`Failed to parse ${file.name}`)
          }
        }
      }

      // Map orders to master SKUs
      const mappedOrders = allOrders.map(order => ({
        ...order,
        Master_SKU: data.mappingDict[order.Portal_SKU],
      }))

      setOrders(mappedOrders)

      // Find unmapped SKUs
      const unmapped = [...new Set(
        mappedOrders
          .filter(o => !o.Master_SKU)
          .map(o => o.Portal_SKU)
      )]

      if (unmapped.length > 0 && data.masterOptions.length > 0) {
        // Use fuzzy matching to suggest best matches (matching thefuzz logic)
        const newMappingRows: MappingRow[] = unmapped.map(sku => {
          let bestMatch = data.masterOptions[0] || ''
          let bestScore = 0

          for (const masterSku of data.masterOptions) {
            const score = tokenSetRatio(sku, masterSku)
            if (score > bestScore) {
              bestScore = score
              bestMatch = masterSku
            }
          }

          return {
            confirm: bestScore >= 90, // Auto-confirm if score >= 90 (matching Streamlit)
            portalSku: sku,
            masterSku: bestMatch,
            matchScore: bestScore,
          }
        })

        setUnmappedRows(newMappingRows)
      } else {
        setUnmappedRows([])
      }

      toast.success(`Loaded ${allOrders.length} orders from ${files.length} file(s)`)
    } catch (err) {
      toast.error('Failed to process files')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }, [data])

  // Helper to parse CSV line handling quoted fields
  function parseCSVLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const handleMasterSync = async () => {
    if (!masterFile || !data) return

    setIsProcessing(true)
    try {
      const text = await masterFile.text()
      const lines = text.split('\n').filter(l => l.trim())
      
      // Get unique SKUs from first column, skip header
      const skus = [...new Set(
        lines.slice(1)
          .map(line => line.split(',')[0]?.trim().toUpperCase())
          .filter(Boolean)
      )]

      const supabase = createClient()
      const records = skus.map(sku => ({
        user_id: data.userId,
        master_sku: sku,
      }))

      const { error } = await supabase
        .from('master_inventory')
        .upsert(records, { onConflict: 'user_id, master_sku' })

      if (error) throw error

      toast.success(`Synced ${skus.length} master SKUs`)
      mutate('user-data')
      setMasterFile(null)
    } catch (err) {
      toast.error('Failed to sync master inventory')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSaveMappings = async () => {
    if (!data) return

    const toSave = unmappedRows.filter(row => row.confirm && row.masterSku)
    if (toSave.length === 0) {
      toast.error('No mappings selected')
      return
    }

    setIsProcessing(true)
    try {
      const supabase = createClient()
      const records = toSave.map(row => ({
        user_id: data.userId,
        portal_sku: row.portalSku,
        master_sku: row.masterSku,
      }))

      const { error } = await supabase
        .from('sku_mapping')
        .upsert(records, { onConflict: 'user_id, portal_sku' })

      if (error) throw error

      toast.success(`Saved ${toSave.length} mappings`)
      mutate('user-data')
      
      // Update orders with new mappings
      setOrders(prev => prev.map(order => {
        const mapping = toSave.find(m => m.portalSku === order.Portal_SKU)
        if (mapping) {
          return { ...order, Master_SKU: mapping.masterSku }
        }
        return order
      }))

      setUnmappedRows(prev => prev.filter(row => !row.confirm))
    } catch (err) {
      toast.error('Failed to save mappings')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleGeneratePicklist = async () => {
    const mappedOrders = orders.filter(o => o.Master_SKU)
    if (mappedOrders.length === 0) {
      toast.error('No mapped orders to generate picklist')
      return
    }

    setIsProcessing(true)
    try {
      const res = await fetch('/api/generate-picklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: mappedOrders }),
      })

      if (!res.ok) throw new Error('Failed to generate picklist')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `picklist.pdf`
      a.click()
      URL.revokeObjectURL(url)

      toast.success('Picklist downloaded!')
    } catch (err) {
      toast.error('Failed to generate picklist')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-destructive">Failed to load data. Please refresh.</p>
      </div>
    )
  }

  return (
    <>
      <DashboardHeader 
        title="Picklist Generator" 
        description="Process orders and generate warehouse picklists" 
      />
      
      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Master Inventory Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Master Inventory Sync</CardTitle>
            <CardDescription>
              Upload your master SKU list to enable smart mapping
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="master-file">Master SKU CSV</Label>
                <Input
                  id="master-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setMasterFile(e.target.files?.[0] || null)}
                  className="mt-1"
                />
              </div>
              <Button 
                onClick={handleMasterSync} 
                disabled={!masterFile || isProcessing}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Master SKUs
              </Button>
              {data && (
                <Badge variant="secondary">
                  {data.masterOptions.length} SKUs in inventory
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Order Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Orders</CardTitle>
            <CardDescription>
              Upload Flipkart CSV, Myntra CSV, or Meesho PDF files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <Label htmlFor="order-files">Order Files</Label>
                <Input
                  id="order-files"
                  type="file"
                  accept=".csv,.pdf"
                  multiple
                  onChange={handleOrderUpload}
                  disabled={isLoading || isProcessing}
                  className="mt-1"
                />
              </div>
              <Button 
                onClick={handleGeneratePicklist}
                disabled={orders.filter(o => o.Master_SKU).length === 0 || isProcessing}
              >
                <Download className="mr-2 h-4 w-4" />
                Generate 4x6 Picklist
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Orders Summary */}
        {orders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Orders Loaded: {orders.length}</CardTitle>
              <CardDescription>
                {orders.filter(o => o.Master_SKU).length} mapped, {orders.filter(o => !o.Master_SKU).length} unmapped
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border max-h-[300px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Portal SKU</TableHead>
                      <TableHead>Master SKU</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.slice(0, 20).map((order, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-sm">
                          {order.Portal_SKU}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {order.Master_SKU || '-'}
                        </TableCell>
                        <TableCell className="text-right">{order.Qty}</TableCell>
                        <TableCell>
                          <Badge variant={order.Master_SKU ? 'default' : 'destructive'}>
                            {order.Master_SKU ? 'Mapped' : 'Unmapped'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {orders.length > 20 && (
                  <div className="border-t p-2 text-center text-sm text-muted-foreground">
                    Showing 20 of {orders.length} orders
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Unmapped SKU Mapping */}
        {unmappedRows.length > 0 && data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New SKU Mapping</CardTitle>
              <CardDescription>
                {unmappedRows.length} SKUs need mapping. Select best matches below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Confirm</TableHead>
                      <TableHead>Portal SKU</TableHead>
                      <TableHead>Master SKU</TableHead>
                      <TableHead className="text-right">Match %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmappedRows.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Checkbox
                            checked={row.confirm}
                            onCheckedChange={(checked) => {
                              setUnmappedRows(prev => 
                                prev.map((r, i) => 
                                  i === idx ? { ...r, confirm: !!checked } : r
                                )
                              )
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {row.portalSku}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={row.masterSku}
                            onValueChange={(value) => {
                              setUnmappedRows(prev =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, masterSku: value } : r
                                )
                              )
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select master SKU" />
                            </SelectTrigger>
                            <SelectContent>
                              {data.masterOptions.map(opt => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={row.matchScore >= 90 ? 'default' : row.matchScore >= 70 ? 'secondary' : 'outline'}>
                            {row.matchScore}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={handleSaveMappings} disabled={isProcessing}>
                  <Save className="mr-2 h-4 w-4" />
                  Save Mappings
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
