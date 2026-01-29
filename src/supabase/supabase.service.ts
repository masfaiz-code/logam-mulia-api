import { Injectable } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface GoldPriceHistory {
  id?: number;
  source: string;
  type: string;
  weight: number;
  sell_price: number;
  buy_price: number;
  last_updated: string | null;
  scraped_at?: string;
}

export interface PriceWithChange extends GoldPriceHistory {
  sell_change: number;
  buy_change: number;
}

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl =
      process.env.SUPABASE_URL || "https://sqvnhgontvvcwqedhhfu.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxdm5oZ29udHZ2Y3dxZWRoaGZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY2MTM3MCwiZXhwIjoyMDg1MjM3MzcwfQ.Cn5xXlTCXBB2sIFTcnwIdMF3keB6mnu3dVUyhTDA1HQ";

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Save gold prices to database
   * Uses upsert to handle duplicates based on unique constraint
   */
  async savePrices(prices: GoldPriceHistory[]): Promise<void> {
    if (prices.length === 0) return;

    const { error } = await this.supabase
      .from("gold_price_history")
      .upsert(prices, {
        onConflict: "source,type,weight,last_updated",
        ignoreDuplicates: true,
      });

    if (error) {
      console.error("Error saving prices to Supabase:", error);
      // Don't throw - we don't want to break the API if DB save fails
    }
  }

  /**
   * Get the previous price for comparison
   * Returns the most recent price before the current last_updated
   */
  async getPreviousPrices(
    source: string,
    type: string,
    currentLastUpdated: string | null
  ): Promise<Map<number, GoldPriceHistory>> {
    const priceMap = new Map<number, GoldPriceHistory>();

    // Get the latest prices for each weight that are older than current
    const { data, error } = await this.supabase
      .from("gold_price_history")
      .select("*")
      .eq("source", source)
      .eq("type", type)
      .neq("last_updated", currentLastUpdated || "")
      .order("scraped_at", { ascending: false });

    if (error) {
      console.error("Error fetching previous prices:", error);
      return priceMap;
    }

    // Group by weight and take the most recent for each
    if (data) {
      for (const price of data) {
        const weight = parseFloat(price.weight);
        if (!priceMap.has(weight)) {
          priceMap.set(weight, price);
        }
      }
    }

    return priceMap;
  }

  /**
   * Get price change for each item
   */
  async getPricesWithChange(
    source: string,
    currentPrices: GoldPriceHistory[]
  ): Promise<PriceWithChange[]> {
    if (currentPrices.length === 0) return [];

    // Group prices by type
    const pricesByType = new Map<string, GoldPriceHistory[]>();
    for (const price of currentPrices) {
      const existing = pricesByType.get(price.type) || [];
      existing.push(price);
      pricesByType.set(price.type, existing);
    }

    const result: PriceWithChange[] = [];

    for (const [type, prices] of pricesByType) {
      const lastUpdated = prices[0]?.last_updated;
      const previousPrices = await this.getPreviousPrices(
        source,
        type,
        lastUpdated
      );

      for (const price of prices) {
        const prevPrice = previousPrices.get(price.weight);

        result.push({
          ...price,
          sell_change: prevPrice ? price.sell_price - prevPrice.sell_price : 0,
          buy_change: prevPrice ? price.buy_price - prevPrice.buy_price : 0,
        });
      }
    }

    return result;
  }

  /**
   * Get price history for a specific weight and type
   */
  async getPriceHistory(
    source: string,
    type: string,
    weight: number,
    limit: number = 30
  ): Promise<GoldPriceHistory[]> {
    const { data, error } = await this.supabase
      .from("gold_price_history")
      .select("*")
      .eq("source", source)
      .eq("type", type)
      .eq("weight", weight)
      .order("scraped_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching price history:", error);
      return [];
    }

    return data || [];
  }
}
