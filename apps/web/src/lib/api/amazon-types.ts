/**
 * Amazon discovery shared types (client-safe, no server-only imports).
 */

export interface AmazonScoredProduct {
  asin: string;
  title: string;
  detailPageUrl: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
  isPrime: boolean;
  availability: string | null;
  score: number;
  estimatedCommission: number | null;
  reasons: string[];
}
