import { Offer, Reference, LineItem, MarketType } from './types';

export interface AnalysisResult {
  offerId: string;
  competitorName: string;
  lineComparisons: LineComparison[];
  mathErrors: string[];
  abnormalPrices: AbnormalPrice[];
  globalTTCStatus: 'normal' | 'anormalement_bas' | 'excessif';
  status: Offer['status'];
  totalTTC: number;
}

export interface LineComparison {
  refId: string;
  refDesignation: string;
  refQty: number;
  refUnit: string;
  offerId?: string;
  offerDesignation?: string;
  offerQty?: number;
  offerUnit?: string;
  status: 'identique' | 'different' | 'manquant' | 'ajoute';
  details: string[];
}

export interface AbnormalPrice {
  lineId: string;
  designation: string;
  offerPrice: number;
  refPrice: number;
  status: 'normal' | 'anormalement_bas' | 'excessif';
  percentageDiff: number;
}

export function analyzeOffer(offer: Offer, reference: Reference): AnalysisResult {
  const lineComparisons: LineComparison[] = [];
  const mathErrors: string[] = [];
  const abnormalPrices: AbnormalPrice[] = [];
  
  // 1. Line by Line Comparison
  const offerItems = offer.items || [];
  const refItems = reference.items || [];
  const offerItemsMap = new Map(offerItems.map(item => [item.id, item]));
  
  refItems.forEach(refItem => {
    const offerItem = offerItemsMap.get(refItem.id);
    if (!offerItem) {
      lineComparisons.push({
        refId: refItem.id,
        refDesignation: refItem.designation,
        refQty: refItem.quantity,
        refUnit: refItem.unit,
        status: 'manquant',
        details: ["Ligne manquante dans l'offre"]
      });
    } else {
      const details: string[] = [];
      let status: LineComparison['status'] = 'identique';
      
      // We do a loose comparison for strings to avoid false positives on minor typos
      if (offerItem.designation.toLowerCase().trim() !== refItem.designation.toLowerCase().trim()) {
        details.push(`Désignation différente: "${offerItem.designation}" vs "${refItem.designation}"`);
        status = 'different';
      }
      if (offerItem.quantity !== refItem.quantity) {
        details.push(`Quantité différente: ${offerItem.quantity} vs ${refItem.quantity}`);
        status = 'different';
      }
      if (offerItem.unit.toLowerCase().trim() !== refItem.unit.toLowerCase().trim()) {
        details.push(`Unité différente: "${offerItem.unit}" vs "${refItem.unit}"`);
        status = 'different';
      }
      
      lineComparisons.push({
        refId: refItem.id,
        refDesignation: refItem.designation,
        refQty: refItem.quantity,
        refUnit: refItem.unit,
        offerId: offerItem.id,
        offerDesignation: offerItem.designation,
        offerQty: offerItem.quantity,
        offerUnit: offerItem.unit,
        status,
        details
      });
      
      offerItemsMap.delete(refItem.id);
    }
  });

  // Added lines
  offerItemsMap.forEach(offerItem => {
    lineComparisons.push({
      refId: '',
      refDesignation: '',
      refQty: 0,
      refUnit: '',
      offerId: offerItem.id,
      offerDesignation: offerItem.designation,
      offerQty: offerItem.quantity,
      offerUnit: offerItem.unit,
      status: 'ajoute',
      details: ['Ligne ajoutée par le concurrent']
    });
  });

  // 2. Math Verification
  let calculatedTotalHT = 0;
  offerItems.forEach(item => {
    const expectedTotal = item.quantity * item.unitPrice;
    // Allow small floating point differences
    if (Math.abs(expectedTotal - item.totalPrice) > 0.05) {
      mathErrors.push(`Ligne ${item.id}: Erreur de multiplication (${item.quantity} * ${item.unitPrice} = ${expectedTotal.toFixed(2)}, trouvé ${item.totalPrice})`);
    }
    calculatedTotalHT += item.totalPrice;
  });

  if (Math.abs(calculatedTotalHT - offer.totalHT) > 0.05) {
    mathErrors.push(`Erreur d'addition HT: La somme des lignes est ${calculatedTotalHT.toFixed(2)}, le total HT déclaré est ${offer.totalHT}`);
  }

  const expectedTTC = offer.totalHT + offer.vat;
  if (Math.abs(expectedTTC - offer.totalTTC) > 0.05) {
    mathErrors.push(`Erreur TTC: HT (${offer.totalHT}) + TVA (${offer.vat}) = ${expectedTTC.toFixed(2)}, le total TTC déclaré est ${offer.totalTTC}`);
  }

  // 3. Abnormal Prices Detection (Line by Line)
  // Only if reference has prices
  const hasRefPrices = refItems.some(item => item.unitPrice > 0);
  if (hasRefPrices) {
    offerItems.forEach(offerItem => {
      const refItem = refItems.find(r => r.id === offerItem.id);
      if (refItem && refItem.unitPrice > 0) {
        const diff = (offerItem.unitPrice - refItem.unitPrice) / refItem.unitPrice;
        const percentageDiff = diff * 100;
        
        let status: AbnormalPrice['status'] = 'normal';
        const lowerBound = reference.type === 'travaux' ? -0.20 : -0.25;
        const upperBound = 0.20;

        if (diff < lowerBound) status = 'anormalement_bas';
        else if (diff > upperBound) status = 'excessif';

        abnormalPrices.push({
          lineId: offerItem.id,
          designation: offerItem.designation,
          offerPrice: offerItem.unitPrice,
          refPrice: refItem.unitPrice,
          status,
          percentageDiff
        });
      }
    });
  }

  // 4. Global TTC Verification
  let globalTTCStatus: AnalysisResult['globalTTCStatus'] = 'normal';
  if (reference.estimationTTC > 0) {
    const diff = (offer.totalTTC - reference.estimationTTC) / reference.estimationTTC;
    const lowerBound = reference.type === 'travaux' ? -0.20 : -0.25;
    const upperBound = 0.20;

    if (diff < lowerBound) globalTTCStatus = 'anormalement_bas';
    else if (diff > upperBound) globalTTCStatus = 'excessif';
  }

  // Determine overall status
  let overallStatus: Offer['status'] = 'conforme';
  if (lineComparisons.some(c => c.status === 'manquant' || c.status === 'different')) {
    overallStatus = 'incomplet';
  } else if (globalTTCStatus === 'excessif' || abnormalPrices.some(p => p.status === 'excessif')) {
    overallStatus = 'excessif';
  } else if (globalTTCStatus === 'anormalement_bas' || abnormalPrices.some(p => p.status === 'anormalement_bas')) {
    overallStatus = 'anormalement_bas';
  }

  return {
    offerId: offer.id,
    competitorName: offer.competitorName,
    lineComparisons,
    mathErrors,
    abnormalPrices,
    globalTTCStatus,
    status: overallStatus,
    totalTTC: offer.totalTTC
  };
}

export function calculateReferencePrice(estimation: number, retainedOffers: Offer[]): number {
  if (retainedOffers.length === 0) return estimation;
  const sumRetained = retainedOffers.reduce((sum, offer) => sum + offer.totalTTC, 0);
  const averageRetained = sumRetained / retainedOffers.length;
  return (estimation + averageRetained) / 2;
}

export function determineWinner(analysisResults: AnalysisResult[], referencePrice: number): AnalysisResult | null {
  // Filter out excessif and anormalement_bas (unless justified, but here we exclude them automatically as per prompt)
  const eligibleOffers = analysisResults.filter(r => r.status !== 'excessif' && r.status !== 'anormalement_bas');
  
  if (eligibleOffers.length === 0) return null;

  // L'offre la mieux-disante est celle qui est la plus proche du prix de référence par défaut (inférieure ou égale).
  const inferiorOffers = eligibleOffers.filter(o => o.totalTTC <= referencePrice);
  
  if (inferiorOffers.length > 0) {
    // Parmi les offres inférieures ou égales, on prend la plus proche (donc le maximum)
    return inferiorOffers.reduce((prev, curr) => (referencePrice - curr.totalTTC) < (referencePrice - prev.totalTTC) ? curr : prev);
  } else {
    // En cas d'absence d'offres inférieures, c'est la plus proche par excès (donc le minimum des offres supérieures)
    const superiorOffers = eligibleOffers.filter(o => o.totalTTC > referencePrice);
    return superiorOffers.reduce((prev, curr) => (curr.totalTTC - referencePrice) < (prev.totalTTC - referencePrice) ? curr : prev);
  }
}
