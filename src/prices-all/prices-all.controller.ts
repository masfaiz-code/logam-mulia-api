import { Controller, Get, Param, Query, Header } from '@nestjs/common';
import { PricesAllService, ScrapeResult } from './prices-all.service';
import { Public } from '../core/decorators/public.decorator';

@Controller('prices-all')
export class PricesAllController {
  constructor(private readonly pricesAllService: PricesAllService) {}

  @Get(':site/rss')
  @Public()
  @Header('Content-Type', 'application/rss+xml; charset=utf-8')
  async getRssFeed(
    @Param('site') site: string,
    @Query('type') type?: string,
  ): Promise<string> {
    try {
      return await this.pricesAllService.scrapeAllAsRss(site, type);
    } catch (error) {
      // Return error as valid RSS XML to avoid Fastify payload error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Error</title>
    <description>Failed to fetch prices: ${errorMessage}</description>
    <item>
      <title>Error</title>
      <description>${errorMessage}</description>
    </item>
  </channel>
</rss>`;
    }
  }

  @Get(':site')
  @Public()
  async getAllPrices(
    @Param('site') site: string,
    @Query('type') type?: string,
  ): Promise<ScrapeResult> {
    return this.pricesAllService.scrapeAll(site, type);
  }

  @Get()
  @Public()
  async getSupportedSites() {
    return {
      message: 'Prices All API - Get all gold prices per weight',
      supportedSites: ['anekalogam', 'indogold', 'pegadaian', 'galeri24'],
      usage: {
        json: '/prices-all/:site',
        jsonWithType: '/prices-all/:site?type=:type',
        rss: '/prices-all/:site/rss',
        rssWithType: '/prices-all/:site/rss?type=:type',
      },
      examples: {
        json: '/prices-all/anekalogam',
        jsonFiltered: '/prices-all/anekalogam?type=antam-certicard',
        rss: '/prices-all/anekalogam/rss',
        rssFiltered: '/prices-all/galeri24/rss?type=antam',
      },
      galeri24Types: ['antam', 'ubs', 'galeri24', 'baby-galeri24', 'dinar-g24', 'batik-series'],
      anekalogamTypes: ['antam-certicard', 'antam-old'],
    };
  }
}
