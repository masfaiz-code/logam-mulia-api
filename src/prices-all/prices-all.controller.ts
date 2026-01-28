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
  ) {
    return this.pricesAllService.scrapeAllAsRss(site, type);
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
      supportedSites: ['anekalogam', 'indogold', 'pegadaian'],
      usage: {
        json: '/prices-all/:site',
        rss: '/prices-all/:site/rss',
      },
      examples: {
        json: '/prices-all/anekalogam',
        rss: '/prices-all/anekalogam/rss',
      },
    };
  }
}
