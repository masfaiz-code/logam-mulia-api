import { Controller, Get, Param } from '@nestjs/common';
import { PricesAllService } from './prices-all.service';
import { Public } from '../core/decorators/public.decorator';

@Controller('prices-all')
export class PricesAllController {
  constructor(private readonly pricesAllService: PricesAllService) {}

  @Get(':site')
  @Public()
  async getAllPrices(@Param('site') site: string) {
    return this.pricesAllService.scrapeAll(site);
  }

  @Get()
  @Public()
  async getSupportedSites() {
    return {
      message: 'Prices All API - Get all gold prices per weight',
      supportedSites: ['anekalogam', 'indogold', 'pegadaian'],
      usage: '/prices-all/:site',
      example: '/prices-all/anekalogam',
    };
  }
}
