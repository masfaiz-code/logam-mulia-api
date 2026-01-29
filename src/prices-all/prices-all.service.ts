import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import * as cheerio from "cheerio";
import { firstValueFrom } from "rxjs";
import {
  SupabaseService,
  GoldPriceHistory,
  PriceWithChange,
} from "../supabase/supabase.service";

export interface PriceItem {
  weight: number;
  unit: string;
  sell: number;
  buy: number;
  type: string;
}

export interface PriceItemWithChange extends PriceItem {
  sellChange: number;
  buyChange: number;
}

export interface ScrapeResult {
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
  constructor(
    private readonly httpService: HttpService,
    private readonly supabaseService: SupabaseService
  ) {}

  async scrapeAll(site: string, type?: string): Promise<ScrapeResult> {
    let result: ScrapeResult;

    switch (site) {
      case "anekalogam":
        result = await this.scrapeAnekalogam();
        break;
      case "indogold":
        result = await this.scrapeIndogold();
        break;
      case "pegadaian":
        result = await this.scrapePegadaian();
        break;
      case "galeri24":
        result = await this.scrapeGaleri24();
        break;
      default:
        throw new Error(
          `Site "${site}" is not supported for full price scraping. Supported sites: anekalogam, indogold, pegadaian, galeri24`
        );
    }

    // Filter by type if specified
    if (type) {
      result.data = result.data.filter((item) => item.type === type);
    }

    // Save prices to database (async, don't wait)
    this.savePricesToDatabase(result).catch((err) => {
      console.error("Failed to save prices to database:", err);
    });

    return result;
  }

  /**
   * Save scraped prices to Supabase database
   */
  private async savePricesToDatabase(result: ScrapeResult): Promise<void> {
    const { data, meta } = result;

    const priceRecords: GoldPriceHistory[] = data.map((item) => ({
      source: meta.source,
      type: item.type,
      weight: item.weight,
      sell_price: item.sell,
      buy_price: item.buy,
      last_updated: meta.lastUpdated,
    }));

    await this.supabaseService.savePrices(priceRecords);
  }

  async scrapeAllAsRss(site: string, type?: string): Promise<string> {
    const result = await this.scrapeAll(site, type);

    // Get price changes from database
    const pricesWithChange = await this.getPriceChanges(result);

    return this.convertToRss(result, site, type, pricesWithChange);
  }

  /**
   * Get price changes by comparing with previous prices in database
   */
  private async getPriceChanges(
    result: ScrapeResult
  ): Promise<Map<string, PriceItemWithChange>> {
    const { data, meta } = result;
    const priceChangeMap = new Map<string, PriceItemWithChange>();

    // Convert to GoldPriceHistory format for Supabase query
    const priceRecords: GoldPriceHistory[] = data.map((item) => ({
      source: meta.source,
      type: item.type,
      weight: item.weight,
      sell_price: item.sell,
      buy_price: item.buy,
      last_updated: meta.lastUpdated,
    }));

    // Get prices with changes
    const pricesWithChange = await this.supabaseService.getPricesWithChange(
      meta.source,
      priceRecords
    );

    // Map by weight-type key for easy lookup
    for (const price of pricesWithChange) {
      const key = `${price.type}-${price.weight}`;
      priceChangeMap.set(key, {
        weight: price.weight,
        unit: "gram",
        sell: price.sell_price,
        buy: price.buy_price,
        type: price.type,
        sellChange: price.sell_change,
        buyChange: price.buy_change,
      });
    }

    return priceChangeMap;
  }

  private getTypeTitle(type?: string): string {
    if (!type) return "";

    const titles: Record<string, string> = {
      antam: "Antam",
      "antam-certicard": "Antam Certicard",
      "antam-old": "Antam Edisi Lama",
      pegadaian: "Pegadaian",
      galeri24: "Galeri 24",
      ubs: "UBS",
      "baby-galeri24": "Baby Galeri 24",
      "dinar-g24": "Dinar G24",
      "batik-series": "Batik Series",
    };
    return titles[type] || type;
  }

  private convertToRss(
    result: ScrapeResult,
    site: string,
    type?: string,
    priceChangeMap?: Map<string, PriceItemWithChange>
  ): string {
    const { data, meta } = result;

    // Generate unique GUID based on lastUpdated
    const guidBase = meta.lastUpdated
      ? meta.lastUpdated.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()
      : new Date().toISOString().split("T")[0];
    const guid = `${site}-${guidBase}`;

    // Convert lastUpdated to RFC 822 format for RSS
    const pubDate = this.formatRfc822Date(meta.lastUpdated);

    // Get current date/time in WIB
    const now = new Date();
    const wibOffset = 7 * 60 * 60 * 1000; // UTC+7
    const wibDate = new Date(now.getTime() + wibOffset);
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayName = dayNames[wibDate.getUTCDay()];
    const day = wibDate.getUTCDate();
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const month = monthNames[wibDate.getUTCMonth()];
    const year = wibDate.getUTCFullYear();
    const hours = wibDate.getUTCHours().toString().padStart(2, "0");
    const minutes = wibDate.getUTCMinutes().toString().padStart(2, "0");
    const currentDateTime = `${dayName}, ${day} ${month} ${year} - ${hours}:${minutes} WIB`;

    const siteTitle = this.getSiteTitle(site);
    const typeTitle = this.getTypeTitle(type);
    // Use type title if available, otherwise use site title
    const displayTitle = typeTitle || siteTitle;

    // Sort data by weight descending (largest first)
    const sortedData = [...data].sort((a, b) => b.weight - a.weight);

    // Build price list with bullet points, buyback, and price change
    const priceLines = sortedData
      .map((item) => {
        const sellFormatted = this.formatRupiah(item.sell);
        const buyFormatted = item.buy ? this.formatRupiah(item.buy) : null;

        // Get price change from map
        const key = `${item.type}-${item.weight}`;
        const priceWithChange = priceChangeMap?.get(key);
        const sellChange = priceWithChange?.sellChange || 0;

        // Format change indicator
        let changeIndicator = "";
        if (sellChange > 0) {
          changeIndicator = ` ↑ +${this.formatRupiah(sellChange)}`;
        } else if (sellChange < 0) {
          changeIndicator = ` ↓ ${this.formatRupiah(sellChange)}`;
        }

        // Build line with buyback if available
        if (buyFormatted) {
          return `• ${item.weight} gram: ${sellFormatted} (buyback: ${buyFormatted})${changeIndicator}`;
        }
        return `• ${item.weight} gram: ${sellFormatted}${changeIndicator}`;
      })
      .join("\n");

    // Get buyback price (from 1 gram buy price)
    const price1g = data.find((item) => item.weight === 1);

    // Get price change for 1g for title summary
    const price1gKey = `${type || data[0]?.type || "antam"}-1`;
    const price1gChange = priceChangeMap?.get(price1gKey);
    const price1gChangeStr = price1gChange?.sellChange
      ? price1gChange.sellChange > 0
        ? ` ↑+${this.formatRupiah(price1gChange.sellChange)}`
        : ` ↓${this.formatRupiah(price1gChange.sellChange)}`
      : "";

    // Build price summary for title
    const priceSummary = price1g
      ? `1g: ${this.formatRupiah(price1g.sell)}${price1gChangeStr}`
      : `${data.length} items`;

    // Format lastUpdated for footer
    const updateTime = meta.lastUpdated || "N/A";

    // Build RSS feed URL with type query if specified
    const rssUrl = type
      ? `https://logam-mulia-api-nine.vercel.app/prices-all/${site}/rss?type=${type}`
      : `https://logam-mulia-api-nine.vercel.app/prices-all/${site}/rss`;

    // Build unique GUID with type
    const guidWithType = type ? `${guid}-${type}` : guid;

    // Build plain text description (for RSS readers that support it)
    const plainTextDescription = `🪙 HARGA EMAS ${displayTitle.toUpperCase()} HARI INI
${currentDateTime}

📊 Daftar Harga (Jual | Buyback | Perubahan):
${priceLines}

📈 Keterangan: ↑ naik, ↓ turun dari harga sebelumnya

⏰ Update harga: ${updateTime}`;

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Harga Emas ${displayTitle}</title>
    <link>${meta.url}</link>
    <description>Update harga emas dari ${displayTitle}</description>
    <language>id</language>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <atom:link href="${rssUrl}" rel="self" type="application/rss+xml"/>
    <item>
      <title>🪙 Harga Emas ${displayTitle} - ${updateTime} (${priceSummary})</title>
      <link>${meta.url}</link>
      <guid isPermaLink="false">${guidWithType}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${plainTextDescription}]]></description>
    </item>
  </channel>
</rss>`;

    return rss;
  }

  private getSiteTitle(site: string): string {
    const titles: Record<string, string> = {
      anekalogam: "Aneka Logam",
      indogold: "IndoGold",
      pegadaian: "Pegadaian",
    };
    return titles[site] || site;
  }

  private formatRupiah(amount: number): string {
    if (!amount) return "Rp 0";
    return `Rp ${amount.toLocaleString("id-ID")}`;
  }

  private formatRfc822Date(dateStr: string | null): string {
    if (!dateStr) {
      return new Date().toUTCString();
    }

    // Try to parse Indonesian date format: "28 January 2026 14.02"
    const months: Record<string, number> = {
      january: 0,
      februari: 1,
      february: 1,
      maret: 2,
      march: 2,
      april: 3,
      mei: 4,
      may: 4,
      juni: 5,
      june: 5,
      juli: 6,
      july: 6,
      agustus: 7,
      august: 7,
      september: 8,
      oktober: 9,
      october: 9,
      november: 10,
      desember: 11,
      december: 11,
      januari: 0,
    };

    const match = dateStr.match(
      /(\d{1,2})\s+(\w+)\s+(\d{4})(?:\s+(\d{1,2})[.:](\d{2}))?/i
    );
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
    const url = "https://www.anekalogam.co.id/id/logam-mulia";
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      })
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Extract last updated time
    // Format: "Last Updated: 28 January 2026    14.02"
    const updateNote = $(".update-note").first().text();

    // Try multiple patterns to extract date and time
    // Pattern 1: "28 January 2026" with optional time "14.02"
    const dateTimeMatch = updateNote.match(
      /(\d{1,2}\s+\w+\s+\d{4})\s*(?:.*?(\d{1,2}[.:]\d{2}))?/i
    );
    if (dateTimeMatch) {
      const date = dateTimeMatch[1];
      const time = dateTimeMatch[2] || "";
      lastUpdated = time ? `${date} ${time}` : date;
    }

    // Fallback: try to get from strong tag
    if (!lastUpdated) {
      const strongText = $(".update-note strong").first().text().trim();
      if (strongText) {
        // Clean up the text (remove extra spaces)
        lastUpdated = strongText.replace(/\s+/g, " ").trim();
      }
    }

    // Scrape all tables with class "lm-table"
    $("table.lm-table").each((tableIndex, table) => {
      // Determine type from table context
      let tableType = "antam";
      const sectionTitle = $(table)
        .closest("section")
        .find("h1, h2, h3")
        .first()
        .text()
        .toLowerCase();

      if (
        sectionTitle.includes("certicard") ||
        sectionTitle.includes("reinvented")
      ) {
        tableType = "antam-certicard";
      } else if (
        sectionTitle.includes("edisi lama") ||
        sectionTitle.includes("old edition")
      ) {
        tableType = "antam-old";
      }

      $(table)
        .find("tbody tr")
        .each((rowIndex, row) => {
          const cells = $(row).find("td");
          if (cells.length >= 3) {
            // Extract weight from first column
            const weightText = $(cells[0]).text().trim();
            const weightMatch = weightText.match(/([\d.,]+)\s*(?:gram|gr|g)?/i);

            if (weightMatch) {
              const weight = parseFloat(weightMatch[1].replace(",", "."));

              // Extract sell price from second column
              const sellText = $(cells[1]).text().replace(/[^\d]/g, "");
              const sell = parseInt(sellText) || 0;

              // Extract buy price from third column
              const buyText = $(cells[2]).text().replace(/[^\d]/g, "");
              const buy = parseInt(buyText) || 0;

              if (weight > 0 && (sell > 0 || buy > 0)) {
                prices.push({
                  weight,
                  unit: "gram",
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
        source: "anekalogam",
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  private async scrapeIndogold(): Promise<ScrapeResult> {
    const url = "https://www.indogold.id/harga-emas-hari-ini";
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      })
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Try to find update time
    const updateText = $("body").text();
    const dateMatch = updateText.match(
      /(\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4})/i
    );
    if (dateMatch) {
      lastUpdated = dateMatch[1];
    }

    // Scrape tables
    $("table").each((tableIndex, table) => {
      $(table)
        .find("tr")
        .each((rowIndex, row) => {
          const cells = $(row).find("td");
          if (cells.length >= 2) {
            const firstCell = $(cells[0]).text().trim();
            const weightMatch = firstCell.match(/([\d.,]+)\s*(?:gram|gr|g)/i);

            if (weightMatch) {
              const weight = parseFloat(weightMatch[1].replace(",", "."));

              // Try to get sell and buy prices
              let sell = 0;
              let buy = 0;

              if (cells.length >= 3) {
                const sellText = $(cells[1]).text().replace(/[^\d]/g, "");
                const buyText = $(cells[2]).text().replace(/[^\d]/g, "");
                sell = parseInt(sellText) || 0;
                buy = parseInt(buyText) || 0;
              } else if (cells.length >= 2) {
                const priceText = $(cells[1]).text().replace(/[^\d]/g, "");
                sell = parseInt(priceText) || 0;
              }

              if (weight > 0 && sell > 0) {
                prices.push({
                  weight,
                  unit: "gram",
                  sell,
                  buy,
                  type: "antam",
                });
              }
            }
          }
        });
    });

    return {
      data: prices,
      meta: {
        source: "indogold",
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  private async scrapePegadaian(): Promise<ScrapeResult> {
    const url = "https://www.pegadaian.co.id/harga";
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      })
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Scrape from pegadaian tables
    $("table").each((tableIndex, table) => {
      $(table)
        .find("tbody tr")
        .each((rowIndex, row) => {
          const cells = $(row).find("td");
          if (cells.length >= 2) {
            const firstCell = $(cells[0]).text().trim();
            const weightMatch = firstCell.match(/([\d.,]+)\s*(?:gram|gr|g)/i);

            if (weightMatch) {
              const weight = parseFloat(weightMatch[1].replace(",", "."));
              const priceText = $(cells[1]).text().replace(/[^\d]/g, "");
              const sell = parseInt(priceText) || 0;

              if (weight > 0 && sell > 0) {
                prices.push({
                  weight,
                  unit: "gram",
                  sell,
                  buy: 0,
                  type: "pegadaian",
                });
              }
            }
          }
        });
    });

    return {
      data: prices,
      meta: {
        source: "pegadaian",
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  private async scrapeGaleri24(): Promise<ScrapeResult> {
    const url = "https://galeri24.co.id/harga-emas";
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      })
    );

    const $ = cheerio.load(response.data);
    const prices: PriceItem[] = [];
    let lastUpdated: string | null = null;

    // Extract __NUXT_DATA__ JSON from script tag
    const nuxtDataScript = $("#__NUXT_DATA__").html();

    if (nuxtDataScript) {
      try {
        const nuxtData = JSON.parse(nuxtDataScript);

        // Find goldPrice data in the nested array structure
        // The data structure is a flat array with references
        if (Array.isArray(nuxtData) && nuxtData.length > 0) {
          // Find the goldPrice array (it's usually at index 3 of the first reactive object)
          const dataObj = nuxtData[1];
          if (dataObj && dataObj.data !== undefined) {
            const goldPriceIndex = dataObj.data;
            const goldPriceData = nuxtData[goldPriceIndex];

            if (goldPriceData && goldPriceData.goldPrice !== undefined) {
              const priceArrayIndex = goldPriceData.goldPrice;
              const priceArray = nuxtData[priceArrayIndex];

              if (Array.isArray(priceArray)) {
                // Each item in priceArray is an index to the actual price object
                for (const itemIndex of priceArray) {
                  const priceObj = nuxtData[itemIndex];

                  if (priceObj && typeof priceObj === "object") {
                    // Extract values from the object (values are indices to actual data)
                    const denomination = nuxtData[priceObj.denomination];
                    const sellingPrice = nuxtData[priceObj.sellingPrice];
                    const buybackPrice = nuxtData[priceObj.buybackPrice];
                    const vendorName = nuxtData[priceObj.vendorName];
                    const date = nuxtData[priceObj.date];

                    if (denomination && sellingPrice) {
                      const weight = parseFloat(denomination);
                      const sell = parseInt(sellingPrice) || 0;
                      const buy = parseInt(buybackPrice) || 0;

                      // Convert vendor name to type slug
                      const type = this.vendorToType(vendorName);

                      if (weight > 0 && sell > 0) {
                        prices.push({
                          weight,
                          unit: "gram",
                          sell,
                          buy,
                          type,
                        });
                      }

                      // Use date as lastUpdated
                      if (date && !lastUpdated) {
                        lastUpdated = date;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // JSON parse failed, continue with empty prices
        console.error("Failed to parse Galeri24 NUXT data:", e);
      }
    }

    // Sort by weight
    prices.sort((a, b) => a.weight - b.weight);

    return {
      data: prices,
      meta: {
        source: "galeri24",
        url,
        lastUpdated,
        scrapedAt: new Date().toISOString(),
      },
    };
  }

  private vendorToType(vendorName: string): string {
    if (!vendorName) return "other";

    const name = vendorName.toLowerCase();

    if (name.includes("antam")) return "antam";
    if (name.includes("ubs")) return "ubs";
    if (name.includes("baby galeri") || name.includes("baby-galeri"))
      return "baby-galeri24";
    if (name.includes("galeri 24") || name.includes("galeri24"))
      return "galeri24";
    if (name.includes("dinar")) return "dinar-g24";
    if (name.includes("batik")) return "batik-series";

    // Return slugified vendor name for unknown types
    return vendorName.toLowerCase().replace(/\s+/g, "-");
  }
}
