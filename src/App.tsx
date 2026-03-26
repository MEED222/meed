import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MarketType, Reference, Offer } from '@/lib/types';
import { parseFileWithGemini } from '@/lib/parser';
import { analyzeOffer, AnalysisResult, calculateReferencePrice, determineWinner } from '@/lib/logic';
import { Loader2, Upload, FileText, CheckCircle, AlertTriangle, XCircle, Download } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function App() {
  const [marketType, setMarketType] = useState<MarketType>('travaux');
  const [reference, setReference] = useState<Reference | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [isParsingRef, setIsParsingRef] = useState(false);
  const [isParsingOffer, setIsParsingOffer] = useState(false);
  const [activeTab, setActiveTab] = useState('setup');

  const handleRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsParsingRef(true);
    try {
      const data = await parseFileWithGemini(file, true);
      setReference({
        type: marketType,
        items: (data.items || []).map((i: any) => ({ ...i, unitPrice: i.unitPrice || 0, totalPrice: i.totalPrice || 0 })),
        estimationTTC: data.totalTTC || 0,
      });
    } catch (error: any) {
      console.error(error);
      alert(`Erreur lors de l'analyse du fichier de référence: ${error.message || 'Erreur inconnue'}`);
    } finally {
      setIsParsingRef(false);
    }
  };

  const handleOfferUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setIsParsingOffer(true);
    try {
      const newOffers: Offer[] = [];
      for (const file of files) {
        const data = await parseFileWithGemini(file, false);
        newOffers.push({
          id: Math.random().toString(36).substring(7),
          competitorName: data.competitorName || file.name,
          items: data.items || [],
          totalHT: data.totalHT || 0,
          vat: data.vat || 0,
          totalTTC: data.totalTTC || 0,
          fileType: file.type,
        });
      }
      setOffers([...offers, ...newOffers]);
    } catch (error: any) {
      console.error(error);
      alert(`Erreur lors de l'analyse d'une offre: ${error.message || 'Erreur inconnue'}`);
    } finally {
      setIsParsingOffer(false);
    }
  };

  const runAnalysis = () => {
    if (!reference) {
      alert("Veuillez d'abord importer le bordereau de référence.");
      setActiveTab('setup');
      return;
    }
    if (offers.length === 0) {
      alert("Veuillez importer au moins une offre.");
      return;
    }
    
    const results = offers.map(offer => analyzeOffer(offer, reference));
    setAnalysisResults(results);
    setActiveTab('analysis');
  };

  const generatePDF = () => {
    if (!reference || analysisResults.length === 0) return;

    const doc = new jsPDF();
    
    // Title
    doc.setFontSize(18);
    doc.text("Rapport d'Analyse des Offres Financières", 14, 22);
    
    doc.setFontSize(12);
    doc.text(`Type de marché: ${marketType === 'travaux' ? 'Travaux' : 'Services et Fournitures'}`, 14, 32);
    doc.text(`Estimation TTC: ${reference.estimationTTC.toFixed(2)} DH`, 14, 40);

    let yPos = 50;

    analysisResults.forEach((result, index) => {
      if (yPos > 250) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(14);
      doc.text(`Concurrent: ${result.competitorName}`, 14, yPos);
      yPos += 10;

      doc.setFontSize(10);
      doc.text(`Total TTC: ${result.totalTTC.toFixed(2)} DH`, 14, yPos);
      yPos += 8;
      doc.text(`Statut global: ${result.status}`, 14, yPos);
      yPos += 8;

      if (result.mathErrors.length > 0) {
        doc.text("Erreurs de calcul:", 14, yPos);
        yPos += 6;
        result.mathErrors.forEach(err => {
          doc.text(`- ${err}`, 18, yPos);
          yPos += 6;
        });
      }

      if (result.abnormalPrices.length > 0) {
        doc.text("Prix anormaux:", 14, yPos);
        yPos += 6;
        result.abnormalPrices.forEach(ap => {
          doc.text(`- Ligne ${ap.lineId}: ${ap.status} (${ap.percentageDiff > 0 ? '+' : ''}${ap.percentageDiff.toFixed(2)}%)`, 18, yPos);
          yPos += 6;
        });
      }

      yPos += 10;
    });

    // Winner
    const refPrice = calculateReferencePrice(reference.estimationTTC, offers.filter(o => analysisResults.find(r => r.offerId === o.id)?.status !== 'excessif' && analysisResults.find(r => r.offerId === o.id)?.status !== 'anormalement_bas'));
    const winner = determineWinner(analysisResults, refPrice);

    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(16);
    doc.text("Conclusion", 14, yPos);
    yPos += 10;
    doc.setFontSize(12);
    doc.text(`Prix de référence calculé: ${refPrice.toFixed(2)} DH`, 14, yPos);
    yPos += 10;
    
    if (winner) {
      doc.text(`Attributaire désigné: ${winner.competitorName}`, 14, yPos);
      yPos += 8;
      doc.text(`Montant de l'offre: ${winner.totalTTC.toFixed(2)} DH`, 14, yPos);
    } else {
      doc.text("Aucun attributaire n'a pu être désigné (toutes les offres sont non conformes ou anormales).", 14, yPos);
    }

    doc.save("rapport_analyse_offres.pdf");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Maroc Marchés Publics - Analyseur</h1>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="#api-gratuite">Obtenir une API gratuite</a>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
            <TabsTrigger value="setup">1. Configuration</TabsTrigger>
            <TabsTrigger value="offers">2. Offres</TabsTrigger>
            <TabsTrigger value="analysis">3. Analyse</TabsTrigger>
            <TabsTrigger value="results">4. Résultats</TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Bordereau Estimatif de Référence</CardTitle>
                <CardDescription>
                  Importez le fichier de référence de l'acheteur public (Excel, PDF).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Type de marché</Label>
                  <Select value={marketType} onValueChange={(v) => setMarketType(v as MarketType)}>
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Sélectionnez le type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="travaux">Travaux</SelectItem>
                      <SelectItem value="services">Services et Fournitures</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    Définit les seuils de prix anormaux (-20%/+20% pour travaux, -25%/+20% pour services).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Fichier de référence</Label>
                  <div className="flex items-center gap-4">
                    <Input 
                      type="file" 
                      accept=".xlsx,.xls,.csv,.pdf,image/*" 
                      onChange={handleRefUpload}
                      disabled={isParsingRef}
                      className="max-w-md"
                    />
                    {isParsingRef && <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
                  </div>
                </div>

                {reference && (
                  <div className="rounded-md border p-4 bg-blue-50/50">
                    <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                      <CheckCircle className="w-5 h-5" />
                      Bordereau importé avec succès
                    </div>
                    <ul className="text-sm space-y-1 text-slate-600">
                      <li>Nombre de lignes: {reference.items.length}</li>
                      <li>Estimation TTC: {reference.estimationTTC.toFixed(2)} DH</li>
                    </ul>
                    <Button className="mt-4" onClick={() => setActiveTab('offers')}>
                      Continuer vers les offres (Passer à l'étape suivante)
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="offers" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Offres Financières des Concurrents</CardTitle>
                <CardDescription>
                  Importez les offres des concurrents (Excel, PDF, Scans). Le système extraira automatiquement les données.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Fichiers des offres (sélection multiple possible)</Label>
                  <div className="flex items-center gap-4">
                    <Input 
                      type="file" 
                      multiple
                      accept=".xlsx,.xls,.csv,.pdf,image/*" 
                      onChange={handleOfferUpload}
                      disabled={isParsingOffer}
                      className="max-w-md"
                    />
                    {isParsingOffer && <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
                  </div>
                </div>

                {offers.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="font-medium text-lg">Offres importées ({offers.length})</h3>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {offers.map((offer, idx) => (
                        <Card key={idx} className="bg-slate-50">
                          <CardContent className="p-4">
                            <div className="font-medium mb-1">{offer.competitorName}</div>
                            <div className="text-sm text-muted-foreground mb-2">
                              {offer.items.length} lignes extraites
                            </div>
                            <div className="text-sm font-semibold">
                              Total TTC: {offer.totalTTC.toFixed(2)} DH
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <Button onClick={runAnalysis} className="w-full md:w-auto">
                      Lancer l'analyse comparative (Passer à l'étape suivante)
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            {analysisResults.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  Aucune analyse n'a encore été effectuée. Veuillez importer un bordereau et des offres, puis lancer l'analyse.
                  <div className="mt-4">
                    <Button onClick={() => setActiveTab('setup')}>Retour à la configuration</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {analysisResults.map((result) => (
                  <Card key={result.offerId} className="overflow-hidden">
                    <CardHeader className="bg-slate-50 border-b">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>{result.competitorName}</CardTitle>
                          <CardDescription>Total TTC: {result.totalTTC.toFixed(2)} DH</CardDescription>
                        </div>
                        <Badge variant={
                          result.status === 'conforme' ? 'default' : 
                          result.status === 'incomplet' ? 'secondary' : 'destructive'
                        }>
                          {result.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="h-[400px]">
                        <div className="p-6 space-y-8">
                          {/* Math Errors */}
                          {result.mathErrors.length > 0 && (
                            <div>
                              <h4 className="flex items-center gap-2 font-medium text-red-600 mb-3">
                                <XCircle className="w-5 h-5" /> Erreurs de calcul détectées
                              </h4>
                              <ul className="space-y-2 text-sm">
                                {result.mathErrors.map((err, i) => (
                                  <li key={i} className="bg-red-50 text-red-700 p-2 rounded border border-red-100">{err}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Line Comparisons */}
                          <div>
                            <h4 className="font-medium mb-3">Comparaison des lignes (Bordereau vs Offre)</h4>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>N°</TableHead>
                                  <TableHead>Désignation Réf.</TableHead>
                                  <TableHead>Statut</TableHead>
                                  <TableHead>Détails</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {result.lineComparisons.map((comp, i) => (
                                  <TableRow key={i}>
                                    <TableCell>{comp.refId || comp.offerId}</TableCell>
                                    <TableCell className="max-w-[200px] truncate" title={comp.refDesignation || comp.offerDesignation}>
                                      {comp.refDesignation || comp.offerDesignation}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant={comp.status === 'identique' ? 'outline' : 'secondary'}>
                                        {comp.status}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {comp.details.join(', ') || '-'}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>

                          {/* Abnormal Prices */}
                          {result.abnormalPrices.length > 0 && (
                            <div>
                              <h4 className="flex items-center gap-2 font-medium text-amber-600 mb-3">
                                <AlertTriangle className="w-5 h-5" /> Prix anormaux détectés
                              </h4>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Ligne</TableHead>
                                    <TableHead>Prix Offre</TableHead>
                                    <TableHead>Prix Réf.</TableHead>
                                    <TableHead>Écart</TableHead>
                                    <TableHead>Statut</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {result.abnormalPrices.map((ap, i) => (
                                    <TableRow key={i}>
                                      <TableCell>{ap.lineId}</TableCell>
                                      <TableCell>{ap.offerPrice.toFixed(2)}</TableCell>
                                      <TableCell>{ap.refPrice.toFixed(2)}</TableCell>
                                      <TableCell className={ap.percentageDiff > 0 ? 'text-red-600' : 'text-blue-600'}>
                                        {ap.percentageDiff > 0 ? '+' : ''}{ap.percentageDiff.toFixed(2)}%
                                      </TableCell>
                                      <TableCell>
                                        <Badge variant="destructive">{ap.status.replace('_', ' ')}</Badge>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                ))}
                <div className="flex justify-end">
                  <Button onClick={() => setActiveTab('results')} size="lg">
                    Voir les résultats finaux (Passer à l'étape suivante)
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="results" className="space-y-6">
            {!reference || analysisResults.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  Les résultats finaux ne sont pas encore disponibles. Veuillez compléter l'analyse des offres.
                  <div className="mt-4">
                    <Button onClick={() => setActiveTab('setup')}>Retour à la configuration</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="border-blue-200 shadow-sm">
                  <CardHeader className="bg-blue-50/50">
                    <CardTitle className="text-blue-900">Décision d'Attribution</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="grid md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <div>
                          <div className="text-sm text-muted-foreground mb-1">Estimation du maître d'ouvrage</div>
                          <div className="text-2xl font-semibold">{reference.estimationTTC.toFixed(2)} DH</div>
                        </div>
                        
                        {(() => {
                          const refPrice = calculateReferencePrice(
                            reference.estimationTTC, 
                            offers.filter(o => {
                              const r = analysisResults.find(ar => ar.offerId === o.id);
                              return r && r.status !== 'excessif' && r.status !== 'anormalement_bas';
                            })
                          );
                          const winner = determineWinner(analysisResults, refPrice);

                          return (
                            <>
                              <div>
                                <div className="text-sm text-muted-foreground mb-1">Prix de référence calculé (P)</div>
                                <div className="text-2xl font-semibold text-slate-700">{refPrice.toFixed(2)} DH</div>
                                <div className="text-xs text-muted-foreground mt-1">P = (Estimation + Moyenne des offres retenues) / 2</div>
                              </div>
                              
                              <div className="pt-4 border-t">
                                <div className="text-sm text-muted-foreground mb-2">Attributaire désigné (Moins-disant conforme)</div>
                                {winner ? (
                                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                    <div className="font-bold text-green-900 text-lg">{winner.competitorName}</div>
                                    <div className="text-green-800 font-medium mt-1">{winner.totalTTC.toFixed(2)} DH</div>
                                  </div>
                                ) : (
                                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
                                    Aucune offre ne remplit les critères d'attribution (toutes sont non conformes, excessives ou anormalement basses).
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      
                      <div className="flex flex-col justify-center items-center bg-slate-50 rounded-lg p-6 border border-slate-100">
                        <FileText className="w-16 h-16 text-slate-300 mb-4" />
                        <h3 className="font-medium text-lg mb-2">Rapport Officiel</h3>
                        <p className="text-sm text-center text-muted-foreground mb-6">
                          Générez le rapport PDF complet incluant toutes les vérifications, détections d'erreurs et la décision finale.
                        </p>
                        <Button onClick={generatePDF} className="w-full gap-2">
                          <Download className="w-4 h-4" />
                          Télécharger le rapport PDF
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Section API Gratuite */}
        <section id="api-gratuite" className="mt-24 pt-12 border-t border-slate-200">
          <Card className="bg-slate-900 text-slate-50 border-slate-800">
            <CardHeader>
              <CardTitle>Comment obtenir une API gratuite pour l'IA ?</CardTitle>
              <CardDescription className="text-slate-400">
                Ce système utilise l'intelligence artificielle pour lire et extraire les données des fichiers PDF et Excel automatiquement.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-300">
                Pour faire fonctionner l'extraction de données, vous avez besoin d'une clé API. Vous pouvez en obtenir une gratuitement via Groq ou Google Gemini.
              </p>
              
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer" className="block p-4 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition-colors">
                  <div className="font-semibold text-white mb-1">Groq API (Recommandé)</div>
                  <div className="text-xs text-slate-400">Extrêmement rapide et gratuit. Créez un compte et générez une clé API.</div>
                </a>
                
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="block p-4 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition-colors">
                  <div className="font-semibold text-white mb-1">Google Gemini API</div>
                  <div className="text-xs text-slate-400">Excellente compréhension des documents complexes. Gratuit avec limites.</div>
                </a>
              </div>
              
              <div className="mt-6 p-4 bg-slate-800 rounded-lg text-sm border border-slate-700">
                <span className="font-semibold text-amber-400">Note:</span> Dans cet environnement de démonstration, la clé API Gemini est déjà configurée automatiquement.
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
