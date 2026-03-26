import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from 'xlsx';
import { Offer, Reference, MarketType, LineItem } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const extractionSchema = {
  type: Type.OBJECT,
  properties: {
    competitorName: { type: Type.STRING, description: "Nom de l'entreprise ou du concurrent. Mettre 'Reference' si c'est le bordereau de l'acheteur." },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Numéro de prix ou identifiant de la ligne (ex: 1.1, 2)" },
          designation: { type: Type.STRING, description: "Désignation de la prestation ou de l'article" },
          unit: { type: Type.STRING, description: "Unité de mesure (ex: U, m2, m3, forfait, ens)" },
          quantity: { type: Type.NUMBER, description: "Quantité" },
          unitPrice: { type: Type.NUMBER, description: "Prix unitaire (0 si non précisé)" },
          totalPrice: { type: Type.NUMBER, description: "Prix total (0 si non précisé)" },
        },
        required: ["id", "designation", "unit", "quantity", "unitPrice", "totalPrice"]
      }
    },
    totalHT: { type: Type.NUMBER, description: "Montant total Hors Taxes (HT)" },
    vat: { type: Type.NUMBER, description: "Montant de la TVA" },
    totalTTC: { type: Type.NUMBER, description: "Montant total Toutes Taxes Comprises (TTC)" },
  },
  required: ["competitorName", "items", "totalHT", "totalTTC"]
};

export async function parseFileWithGemini(file: File, isReference: boolean = false): Promise<any> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("La clé API Gemini n'est pas configurée. Veuillez vérifier vos paramètres.");
  }
  
  try {
    let contentPart: any;

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      contentPart = { text: `Voici le contenu CSV du fichier:\n${csv}` };
    } else {
      // PDF or Image
      const base64Data = await fileToBase64(file);
      contentPart = {
        inlineData: {
          data: base64Data.split(',')[1],
          mimeType: file.type,
        }
      };
    }

    const prompt = isReference 
      ? "Extrait les données du bordereau estimatif (fichier de référence de l'acheteur public). Assure-toi de capturer toutes les lignes avec leurs quantités et prix estimatifs s'ils existent."
      : "Extrait les données de cette offre financière d'un concurrent pour un marché public. Capture toutes les lignes, les prix unitaires, totaux, et le total TTC.";

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Using flash for fast extraction
      contents: {
        parts: [
          contentPart,
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: extractionSchema,
        temperature: 0.1,
      }
    });

    let jsonText = response.text;
    if (!jsonText) throw new Error("No response from Gemini");
    
    jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    
    return JSON.parse(jsonText);
  } catch (error) {
    console.error("Error parsing file with Gemini:", error);
    throw error;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}
