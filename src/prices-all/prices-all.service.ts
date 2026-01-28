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
    const updateNote = $('.update-note').first().text();
    const updateMatch = updateNote.match(/Last Updated:\s*(.+?)(?:\*|$)/i);
    if (updateMatch) {
      lastUpdated = updateMatch[1].trim();
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
