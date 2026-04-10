import { NextRequest, NextResponse } from 'next/server'
import * as pdfjsLib from 'pdfjs-dist'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()

    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

    let text = ''

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()

      const strings = content.items.map((item: any) => item.str)
      text += strings.join(' ') + '\n'
    }

    const lines = text.split('\n').filter(line => line.trim())
    const orders: { Portal_SKU: string; Qty: number }[] = []

    const seen = new Set<string>()

    for (const line of lines) {
      const match = line.match(/[A-Z0-9\-_]{4,}/)

      if (match) {
        const sku = match[0]

        if (!seen.has(sku)) {
          seen.add(sku)
          orders.push({
            Portal_SKU: sku,
            Qty: 1
          })
        }
      }
    }

    return NextResponse.json({ orders })

  } catch (error) {
    console.error('PDF error:', error)
    return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 500 })
  }
}