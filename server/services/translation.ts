import { transcribeAudio as googleTranscribe, translateText, detectLanguage, improveTranscription } from "./googlecloud";

export interface TranscriptionResult {
  text: string;
  language: string;
  confidence: number;
  duration?: number;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  fromLanguage: string;
  toLanguage: string;
  confidence: number;
}

// Language code mappings for consistent language handling
const LANGUAGE_CODES: Record<string, string> = {
  'en': 'English',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'zh': 'Chinese',
  'ja': 'Japanese',
  'ko': 'Korean',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'nl': 'Dutch',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'pl': 'Polish',
  'tr': 'Turkish',
  'cs': 'Czech',
  'hu': 'Hungarian',
  'ro': 'Romanian',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'sk': 'Slovak',
  'sl': 'Slovenian',
  'et': 'Estonian',
  'lv': 'Latvian',
  'lt': 'Lithuanian',
  'uk': 'Ukrainian',
  'be': 'Belarusian',
  'ca': 'Catalan',
  'eu': 'Basque',
  'gl': 'Galician',
  'cy': 'Welsh',
  'ga': 'Irish',
  'mt': 'Maltese',
  'is': 'Icelandic',
  'mk': 'Macedonian',
  'sq': 'Albanian',
  'sr': 'Serbian',
  'bs': 'Bosnian',
  'me': 'Montenegrin'
};

// Get standardized language name
function standardizeLanguageName(language: string): string {
  // If it's already a full name, return as is
  if (Object.values(LANGUAGE_CODES).includes(language)) {
    return language;
  }
  
  // If it's a code with country (e.g., 'en-US', 'ar-SA'), extract base code
  const lowerCode = language.toLowerCase().split('-')[0];
  return LANGUAGE_CODES[lowerCode] || language;
}

// Get language code from name
export function getLanguageCode(languageName: string): string {
  const entry = Object.entries(LANGUAGE_CODES)
    .find(([code, name]) => name.toLowerCase() === languageName.toLowerCase());
  return entry ? entry[0] : languageName.toLowerCase();
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<TranscriptionResult> {
  try {
    // Use Google Cloud Speech-to-Text for transcription
    const result = await googleTranscribe(audioBuffer);
    
    // Standardize language name
    const standardizedLanguage = standardizeLanguageName(result.language);
    
    // Google Cloud Speech-to-Text already provides high-quality results with punctuation
    // Skip transcription improvement for faster processing

    return {
      text: result.text,
      language: standardizedLanguage,
      confidence: result.confidence || 0.9,
      duration: result.duration
    };
  } catch (error) {
    console.error("Audio transcription failed:", error);
    throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function translateAudio(
  text: string, 
  fromLanguage: string, 
  toLanguage: string,
  retryCount = 0
): Promise<string> {
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 500;
  const TIMEOUT = 10000; // 10 seconds
  
  try {
    // Skip translation if source and target languages are the same
    const standardizedFrom = standardizeLanguageName(fromLanguage);
    const standardizedTo = standardizeLanguageName(toLanguage);
    
    if (standardizedFrom.toLowerCase() === standardizedTo.toLowerCase()) {
      return text;
    }

    // Add timeout to prevent hanging in production
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Translation timeout')), TIMEOUT);
    });
    
    const translationPromise = translateText(text, standardizedFrom, standardizedTo);
    const translatedText = await Promise.race([translationPromise, timeoutPromise]);
    
    return translatedText;
  } catch (error) {
    console.error(`Translation failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error);
    
    // Retry with exponential backoff
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`Retrying translation in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return translateAudio(text, fromLanguage, toLanguage, retryCount + 1);
    }
    
    // Return original text if all retries fail (keep system running)
    console.error("Translation max retries reached, returning original text");
    return text;
  }
}

export async function batchTranslate(
  text: string, 
  fromLanguage: string, 
  targetLanguages: string[]
): Promise<Record<string, string>> {
  const translations: Record<string, string> = {};
  const standardizedFrom = standardizeLanguageName(fromLanguage);
  
  // Process translations in parallel with error handling
  const translationPromises = targetLanguages.map(async (targetLang) => {
    const standardizedTo = standardizeLanguageName(targetLang);
    
    try {
      if (standardizedFrom.toLowerCase() === standardizedTo.toLowerCase()) {
        return { language: standardizedTo, translation: text };
      }
      
      const translation = await translateText(text, standardizedFrom, standardizedTo);
      return { language: standardizedTo, translation };
    } catch (error) {
      console.error(`Translation to ${standardizedTo} failed:`, error);
      return { language: standardizedTo, translation: text }; // Fallback to original
    }
  });

  const results = await Promise.all(translationPromises);
  
  results.forEach(({ language, translation }) => {
    translations[language] = translation;
  });

  return translations;
}

export async function detectTextLanguage(text: string): Promise<string> {
  try {
    const detectedLanguage = await detectLanguage(text);
    return standardizeLanguageName(detectedLanguage);
  } catch (error) {
    console.error("Language detection failed:", error);
    return "English"; // Default fallback
  }
}

export function getSupportedLanguages(): string[] {
  return Object.values(LANGUAGE_CODES).sort();
}

export function validateLanguage(language: string): boolean {
  const standardized = standardizeLanguageName(language);
  return Object.values(LANGUAGE_CODES).includes(standardized);
}

export class TranslationCache {
  private cache = new Map<string, { translation: string; timestamp: number }>();
  private readonly TTL = 1000 * 60 * 60; // 1 hour

  private getCacheKey(text: string, fromLang: string, toLang: string): string {
    return `${fromLang}:${toLang}:${text}`;
  }

  get(text: string, fromLang: string, toLang: string): string | null {
    const key = this.getCacheKey(text, fromLang, toLang);
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.translation;
    }
    
    if (cached) {
      this.cache.delete(key); // Remove expired entry
    }
    
    return null;
  }

  set(text: string, fromLang: string, toLang: string, translation: string): void {
    const key = this.getCacheKey(text, fromLang, toLang);
    this.cache.set(key, {
      translation,
      timestamp: Date.now()
    });
    
    // Clean up old entries periodically
    if (this.cache.size > 1000) {
      this.cleanup();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    Array.from(this.cache.entries()).forEach(([key, value]) => {
      if (now - value.timestamp > this.TTL) {
        this.cache.delete(key);
      }
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const translationCache = new TranslationCache();

// Enhanced translation function with caching
export async function translateWithCache(
  text: string, 
  fromLanguage: string, 
  toLanguage: string
): Promise<string> {
  // Check cache first
  const cached = translationCache.get(text, fromLanguage, toLanguage);
  if (cached) {
    return cached;
  }

  // Perform translation
  const translation = await translateAudio(text, fromLanguage, toLanguage);
  
  // Cache the result
  translationCache.set(text, fromLanguage, toLanguage, translation);
  
  return translation;
}
