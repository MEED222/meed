export type MarketType = 'travaux' | 'services';

export interface LineItem {
  id: string; // e.g., "1.1", "2"
  designation: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Offer {
  id: string;
  competitorName: string;
  items: LineItem[];
  totalHT: number;
  vat: number;
  totalTTC: number;
  fileType: string;
  status?: 'conforme' | 'anormalement_bas' | 'excessif' | 'incomplet';
  errors?: string[];
  warnings?: string[];
}

export interface Reference {
  type: MarketType;
  items: LineItem[];
  estimationTTC: number;
}
