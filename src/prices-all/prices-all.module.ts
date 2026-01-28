import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PricesAllController } from './prices-all.controller';
import { PricesAllService } from './prices-all.service';

@Module({
  imports: [HttpModule],
  controllers: [PricesAllController],
  providers: [PricesAllService],
})
export class PricesAllModule {}
