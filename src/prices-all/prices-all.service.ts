import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as cheerio from 'cheerio';
import { firstValueFrom } from 'rxjs';

interface PriceItem {
  weight: number;
  unit: string;
  sell: number;
  buy: number;
  type: string;
}

interface ScrapeResult {
  data: PriceItem[];
  meta: {
    source: string;
    url: string;
    lastUpdated: string | null;
    scrapedAt: string;
  };
}

@Injectable()
export class PricesAllService {
  constructor(private readonly httpService: HttpService) {}

  async scrapeAll(site: string): Promise<ScrapeResult> {
    switch (site) {
      case 'anekalogam':
        return this.scrapeAnekalogam();
      case 'indogold':
        return this.scrapeIndogold();
      case 'pegadaian':
        return this.scrapePegadaian();
      default:
        throw new Error(`Site "${site}" is not supported for full price scraping. Supported sites: anekalogam, indogold, pegadaian`);
    }
  }

  async scrapeAllAsRss(site: string): Promise<string> {
    const result = await this.scrapeAll(site);
    return this.convertToRss(result, site);
  }

  private convertToRss(result: ScrapeResult, site: string): string {
    const { data, meta } = result;
    
    // Generate unique GUID based on lastUpdated
    const guidBase = meta.lastUpdated 
      ? meta.lastUpdated.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
      : new Date().toISOString().split('T')[0];
    const guid = `${site}-${guidBase}`;
    
    // Convert lastUpdated to RFC 822 format for RSS
    const pubDate = this.formatRfc822Date(meta.lastUpdated);
    
    // Build price description
    const priceLines = data.map(item => {
      const sellFormatted = this.formatRupiah(item.sell);
      const buyFormatted = this.formatRupiah(item.buy);
      return `${item.weight}${item.unit}: ${sellFormatted} (jual) / ${buyFormatted} (beli)`;
    }).join('\n');

    // Build price summary for title
    const price1g = data.find(item => item.weight === 1);
    const priceSummary = price1g 
      ? `1g: ${this.formatRupiah(price1g.sell)}` 
      : `${data.length} items`;

    const siteTitle = this.getSiteTitle(site);
    
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Harga Emas ${siteTitle}</title>
    <link>${meta.url}</link>
    <description>Update harga emas dari ${siteTitle}</description>
    <language>id</language>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <atom:link href="https://logam-mulia-api-nine.vercel.app/prices-all/${site}/rss" rel="self" type="application/rss+xml"/>
    <item>
      <title>Update Harga Emas ${siteTitle} - ${meta.lastUpdated || 'Terbaru'} (${priceSummary})</title>
      <link>${meta.url}</link>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[
<h3>Harga Emas ${siteTitle}</h3>
<p><strong>Terakhir Update:</strong> ${meta.lastUpdated || 'N/A'}</p>
<p><strong>Scraped At:</strong> ${meta.scrapedAt}</p>
<hr/>
<pre>
${priceLines}
</pre>
<hr/>
<p>Source: <a href="${meta.url}">${meta.url}</a></p>
      ]]></description>
    </item>
  </channel>
</rss>`;

    return rss;
  }

  private getSiteTitle(site: string): string {
    const titles: Record<string, string> = {
      'anekalogam': 'Aneka Logam',
      'indogold': 'IndoGold',
      'pegadaian': 'Pegadaian',
    };
    return titles[site] || site;
  }

  private formatRupiah(amount: number): string {
    if (!amount) return 'Rp 0';
    return `Rp ${amount.toLocaleString('id-ID')}`;
  }

  private formatRfc822Date(dateStr: string | null): string {
    if (!dateStr) {
      return new Date().toUTCString();
    }

    // Try to parse Indonesian date format: "28 January 2026 14.02"
    const months: Record<string, number> = {
      'january': 0, 'februari': 1, 'february': 1, 'maret': 2, 'march': 2,
      'april': 3, 'mei': 4, 'may': 4, 'juni': 5, 'june': 5,
      'juli': 6, 'july': 6, 'agustus': 7, 'august': 7,
      'september': 8, 'oktober': 9, 'october': 9,
      'november': 10, 'desember': 11, 'december': 11,
      'januari': 0
    };

    const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})(?:\s+(\d{1,2})[.:](\d{2}))?/i);
    if (match) {
      const day = parseInt(match[1]);
      const monthName = match[2].toLowerCase();
      const year = parseInt(match[3]);
      const hour = match[4] ? parseInt(match[4]) : 12;
      const minute = match[5] ? parseInt(match[5]) : 0;

      const month = months[monthName];
      if (month !== undefined) {
        const date = new Date(year, month, day, hour, minute);
        return date.toUTCString();
      }
    }

    return new Date().toUTCString();
  }

  private async scrapeAnekalogam(): Promise<ScrapeResult> {
    const url = 'https://www.anekalogam.co.id/id/logam-mulia';
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }),
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Extract last updated time
    // Format: "Last Updated: 28 January 2026    14.02"
    const updateNote = $('.update-note').first().text();
    
    // Try multiple patterns to extract date and time
    // Pattern 1: "28 January 2026" with optional time "14.02"
    const dateTimeMatch = updateNote.match(/(\d{1,2}\s+\w+\s+\d{4})\s*(?:.*?(\d{1,2}[.:]\d{2}))?/i);
    if (dateTimeMatch) {
      const date = dateTimeMatch[1];
      const time = dateTimeMatch[2] || '';
      lastUpdated = time ? `${date} ${time}` : date;
    }
    
    // Fallback: try to get from strong tag
    if (!lastUpdated) {
      const strongText = $('.update-note strong').first().text().trim();
      if (strongText) {
        // Clean up the text (remove extra spaces)
        lastUpdated = strongText.replace(/\s+/g, ' ').trim();
      }
    }

    // Scrape all tables with class "lm-table"
    $('table.lm-table').each((tableIndex, table) => {
      // Determine type from table context
      let tableType = 'antam';
      const sectionTitle = $(table).closest('section').find('h1, h2, h3').first().text().toLowerCase();
      
      if (sectionTitle.includes('certicard') || sectionTitle.includes('reinvented')) {
        tableType = 'antam-certicard';
      } else if (sectionTitle.includes('edisi lama') || sectionTitle.includes('old edition')) {
        tableType = 'antam-old';
      }

      $(table).find('tbody tr').each((rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 3) {
          // Extract weight from first column
          const weightText = $(cells[0]).text().trim();
          const weightMatch = weightText.match(/([\d.,]+)\s*(?:gram|gr|g)?/i);
          
          if (weightMatch) {
            const weight = parseFloat(weightMatch[1].replace(',', '.'));
            
            // Extract sell price from second column
            const sellText = $(cells[1]).text().replace(/[^\d]/g, '');
            const sell = parseInt(sellText) || 0;
            
            // Extract buy price from third column
            const buyText = $(cells[2]).text().replace(/[^\d]/g, '');
            const buy = parseInt(buyText) || 0;

            if (weight > 0 && (sell > 0 || buy > 0)) {
              prices.push({
                weight,
                unit: 'gram',
                sell,
                buy,
                type: tableType,
              });
            }
          }
        }
      });
    });

    return {
      data: prices,
      meta: {
        source: 'anekalogam',
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  private async scrapeIndogold(): Promise<ScrapeResult> {
    const url = 'https://www.indogold.id/harga-emas-hari-ini';
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }),
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Try to find update time
    const updateText = $('body').text();
    const dateMatch = updateText.match(/(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4})/i);
    if (dateMatch) {
      lastUpdated = dateMatch[1];
    }

    // Scrape tables
    $('table').each((tableIndex, table) => {
      $(table).find('tr').each((rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const firstCell = $(cells[0]).text().trim();
          const weightMatch = firstCell.match(/([\d.,]+)\s*(?:gram|gr|g)/i);
          
          if (weightMatch) {
            const weight = parseFloat(weightMatch[1].replace(',', '.'));
            
            // Try to get sell and buy prices
            let sell = 0;
            let buy = 0;
            
            if (cells.length >= 3) {
              const sellText = $(cells[1]).text().replace(/[^\d]/g, '');
              const buyText = $(cells[2]).text().replace(/[^\d]/g, '');
              sell = parseInt(sellText) || 0;
              buy = parseInt(buyText) || 0;
            } else if (cells.length >= 2) {
              const priceText = $(cells[1]).text().replace(/[^\d]/g, '');
              sell = parseInt(priceText) || 0;
            }

            if (weight > 0 && sell > 0) {
              prices.push({
                weight,
                unit: 'gram',
                sell,
                buy,
                type: 'antam',
              });
            }
          }
        }
      });
    });

    return {
      data: prices,
      meta: {
        source: 'indogold',
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  private async scrapePegadaian(): Promise<ScrapeResult> {
    const url = 'https://www.pegadaian.co.id/harga';
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }),
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Scrape from pegadaian tables
    $('table').each((tableIndex, table) => {
      $(table).find('tbody tr').each((rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const firstCell = $(cells[0]).text().trim();
          const weightMatch = firstCell.match(/([\d.,]+)\s*(?:gram|gr|g)/i);
          
          if (weightMatch) {
            const weight = parseFloat(weightMatch[1].replace(',', '.'));
            const priceText = $(cells[1]).text().replace(/[^\d]/g, '');
            const sell = parseInt(priceText) || 0;

            if (weight > 0 && sell > 0) {
              prices.push({
                weight,
                unit: 'gram',
                sell,
                buy: 0,
                type: 'pegadaian',
              });
            }
          }
        }
      });
    });

    return {
      data: prices,
      meta: {
        source: 'pegadaian',
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }
}
