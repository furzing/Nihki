import { SpeechClient } from '@google-cloud/speech';
import { TranslationServiceClient } from '@google-cloud/translate';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import { GoogleAuth } from 'google-auth-library';
import { withRetry } from './retry';

// Initialize Google Cloud clients with credentials from environment
const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : undefined;

// Fix private key newlines and ensure proper PEM format
if (credentials && credentials.private_key) {
  credentials.private_key = credentials.private_key
    .replace(/\\n/g, '\n') // Replace literal \n with actual newline
    .replace(/\r\n/g, '\n') // Normalize CRLF to LF
    .replace(/\r/g, '\n')   // Normalize CR to LF
    .trim();                // Remove surrounding whitespace
}

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;

// Create proper GoogleAuth instance
const auth = credentials
  ? new GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/cloud-translation',
    ],
  })
  : new GoogleAuth();

const speechClient = new SpeechClient({ auth });
const translationClient = new TranslationServiceClient({ auth });
const ttsClient = new TextToSpeechClient({ auth });

// Language code mappings for Google Cloud
const LANGUAGE_CODE_MAP: Record<string, string> = {
  'English': 'en-US',
  'Spanish': 'es-ES',
  'French': 'fr-FR',
  'German': 'de-DE',
  'Italian': 'it-IT',
  'Portuguese': 'pt-PT',
  'Russian': 'ru-RU',
  'Chinese': 'zh-CN',
  'Japanese': 'ja-JP',
  'Korean': 'ko-KR',
  'Arabic': 'ar-SA',
  'Hindi': 'hi-IN',
  'Dutch': 'nl-NL',
  'Swedish': 'sv-SE',
  'Danish': 'da-DK',
  'Norwegian': 'no-NO',
  'Finnish': 'fi-FI',
  'Polish': 'pl-PL',
  'Turkish': 'tr-TR',
  'Czech': 'cs-CZ',
  'Hungarian': 'hu-HU',
  'Romanian': 'ro-RO',
  'Bulgarian': 'bg-BG',
  'Croatian': 'hr-HR',
  'Slovak': 'sk-SK',
  'Ukrainian': 'uk-UA',
  'Catalan': 'ca-ES',
  'Welsh': 'cy-GB',
  'Irish': 'ga-IE',
  'Icelandic': 'is-IS',
  'Albanian': 'sq-AL',
  'Serbian': 'sr-RS',
};

function getLanguageCode(languageName: string): string {
  return LANGUAGE_CODE_MAP[languageName] || 'en-US';
}

function getLanguageName(languageCode: string): string {
  const entry = Object.entries(LANGUAGE_CODE_MAP).find(([, code]) =>
    code.toLowerCase() === languageCode.toLowerCase() ||
    code.split('-')[0] === languageCode.toLowerCase()
  );
  return entry ? entry[0] : 'English';
}

export async function transcribeAudio(audioBuffer: Buffer, retryCount = 0): Promise<{
  text: string;
  language: string;
  confidence?: number;
  duration?: number;
}> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second
  const MIN_AUDIO_SIZE = 1000; // Minimum 1KB (WebM Opus chunks are typically 1-3KB)

  try {
    // Validate audio buffer size - skip only very tiny buffers
    if (audioBuffer.length < MIN_AUDIO_SIZE) {
      console.log(`[GoogleCloud] Audio buffer too small (${audioBuffer.length} bytes), skipping transcription`);
      return {
        text: '',
        language: 'English',
        confidence: 0,
        duration: 0,
      };
    }

    console.log(`[GoogleCloud] Starting transcription, buffer size: ${audioBuffer.length} bytes`);

    const audio = {
      content: audioBuffer.toString('base64'),
    };

    // Using LINEAR16 (raw PCM) format from Web Audio API
    // This allows us to concatenate chunks freely without header issues
    const config = {
      encoding: 'LINEAR16' as const, // Raw PCM audio - no container format issues
      sampleRateHertz: 16000, // Match Web Audio API sample rate
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'default',
      // Enable language detection for multilingual support
      alternativeLanguageCodes: ['es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'zh-CN', 'ja-JP', 'ko-KR', 'ar-SA', 'hi-IN'],
      // Use enhanced for better accuracy
      useEnhanced: true,
    };

    const request = {
      audio: audio,
      config: config,
    };

    console.log(`[GoogleCloud] Sending request to Speech-to-Text API (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
    const [response] = await speechClient.recognize(request);
    console.log(`[GoogleCloud] Received response, results count: ${response.results?.length || 0}`);

    // Extract transcription from all results
    const transcription = response.results
      ?.map(result => result.alternatives?.[0])
      .filter(alt => alt?.transcript)
      .map(alt => alt!.transcript)
      .join(' ');

    const confidence = response.results?.[0]?.alternatives?.[0]?.confidence || 0;
    const detectedLanguage = response.results?.[0]?.languageCode || 'en-US';

    if (transcription && transcription.trim()) {
      console.log(`[GoogleCloud] SUCCESS: "${transcription}" (${detectedLanguage}, confidence: ${confidence.toFixed(2)})`);
    } else {
      console.log(`[GoogleCloud] No speech detected in audio (${audioBuffer.length} bytes)`);
    }

    return {
      text: transcription || '',
      language: getLanguageName(detectedLanguage),
      confidence: confidence,
      duration: 0,
    };
  } catch (error) {
    console.error(`[GoogleCloud] Transcription error (attempt ${retryCount + 1}):`, error);

    // Retry logic with exponential backoff
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`[GoogleCloud] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return transcribeAudio(audioBuffer, retryCount + 1);
    }

    // Return empty result instead of throwing to keep system running
    console.error("[GoogleCloud] Max retries reached, returning empty transcription");
    return {
      text: '',
      language: 'English',
      confidence: 0,
      duration: 0,
    };
  }
}

export async function translateText(
  text: string,
  fromLanguage: string,
  toLanguage: string
): Promise<string> {
  return withRetry(
    async () => {
      if (!projectId) {
        throw new Error('GOOGLE_CLOUD_PROJECT_ID is not set');
      }

      const location = 'global';

      // Get language codes
      const sourceLanguageCode = getLanguageCode(fromLanguage).split('-')[0];
      const targetLanguageCode = getLanguageCode(toLanguage).split('-')[0];

      const request = {
        parent: `projects/${projectId}/locations/${location}`,
        contents: [text],
        mimeType: 'text/plain',
        sourceLanguageCode: sourceLanguageCode,
        targetLanguageCode: targetLanguageCode,
      };

      const [response] = await translationClient.translateText(request);

      return response.translations?.[0]?.translatedText || text;
    },
    `[GoogleCloud] Translate "${text.substring(0, 50)}" (${fromLanguage} → ${toLanguage})`,
    { maxRetries: 3, initialDelayMs: 1000, backoffMultiplier: 2 }
  );
}

export async function generateSpeech(
  text: string,
  languageCode: string = 'en-US',
  voiceName?: string
): Promise<Buffer> {
  return withRetry(
    async () => {
      // Select appropriate voice based on language
      // Extract base language code for fallback
      const baseLanguageCode = languageCode.split('-')[0];

      const defaultVoices: Record<string, string> = {
        'en-US': 'en-US-Neural2-F',
        'es-ES': 'es-ES-Neural2-A',
        'fr-FR': 'fr-FR-Neural2-A',
        'de-DE': 'de-DE-Neural2-A',
        'it-IT': 'it-IT-Neural2-A',
        'pt-PT': 'pt-PT-Wavenet-A',
        'pt-BR': 'pt-BR-Neural2-A',
        'ru-RU': 'ru-RU-Wavenet-A',
        'zh-CN': 'zh-CN-Wavenet-A',
        'ja-JP': 'ja-JP-Neural2-B',
        'ko-KR': 'ko-KR-Neural2-A',
        'ar-SA': 'ar-XA-Wavenet-A', // CRITICAL FIX: Google uses ar-XA for Arabic (was failing before)
        'ar-XA': 'ar-XA-Wavenet-A',
        'hi-IN': 'hi-IN-Neural2-A',
        'nl-NL': 'nl-NL-Wavenet-A',
        'sv-SE': 'sv-SE-Wavenet-A',
        'da-DK': 'da-DK-Wavenet-A',
        'no-NO': 'nb-NO-Wavenet-A',
        'fi-FI': 'fi-FI-Wavenet-A',
        'pl-PL': 'pl-PL-Wavenet-A',
        'tr-TR': 'tr-TR-Wavenet-A',
        'cs-CZ': 'cs-CZ-Wavenet-A',
        'hu-HU': 'hu-HU-Wavenet-A',
        'uk-UA': 'uk-UA-Wavenet-A',
        'ro-RO': 'ro-RO-Wavenet-A',
        'bg-BG': 'bg-BG-Wavenet-A',
        'hr-HR': 'hr-HR-Wavenet-A',
        'sk-SK': 'sk-SK-Wavenet-A',
        'ca-ES': 'ca-ES-Wavenet-A',
        'cy-GB': 'en-GB-Wavenet-A',
        'ga-IE': 'en-IE-Wavenet-A',
        'is-IS': 'is-IS-Wavenet-A',
        'sq-AL': 'en-US-Neural2-F',
        'sr-RS': 'sr-RS-Standard-A',
      };

      // Try exact match first, then base language, then English
      let voice = voiceName || defaultVoices[languageCode];

      if (!voice) {
        // Try to find a voice for the base language
        const matchingVoice = Object.keys(defaultVoices).find(code => code.startsWith(baseLanguageCode + '-'));
        voice = matchingVoice ? defaultVoices[matchingVoice] : 'en-US-Neural2-F';
      }

      // Update languageCode to match voice if needed
      const voiceLanguageCode = voice.split('-').slice(0, 2).join('-');
      const finalLanguageCode = voiceLanguageCode || languageCode;

      const request = {
        input: { text: text },
        voice: {
          languageCode: finalLanguageCode,
          name: voice,
        },
        audioConfig: {
          audioEncoding: 'MP3' as const,
          speakingRate: 1.0,
          pitch: 0.0,
        },
      };

      const [response] = await ttsClient.synthesizeSpeech(request);

      if (!response.audioContent) {
        console.error(`[TTS] ❌ No audio content for "${text.substring(0, 40)}..." with voice ${voice} (${finalLanguageCode})`);
        throw new Error('No audio content received from Google Cloud TTS');
      }

      console.log(`[TTS] ✅ Generated audio for voice ${voice} (${finalLanguageCode}): ${Buffer.from(response.audioContent as Uint8Array).length} bytes`);
      return Buffer.from(response.audioContent as Uint8Array);
    },
    `[GoogleCloud] Text-to-Speech for "${text.substring(0, 40)}..." (${languageCode})`,
    { maxRetries: 3, initialDelayMs: 1000, backoffMultiplier: 2 }
  );
}

export async function detectLanguage(text: string): Promise<string> {
  try {
    return await withRetry(
      async () => {
        if (!projectId) {
          throw new Error('GOOGLE_CLOUD_PROJECT_ID is not set');
        }

        const location = 'global';

        const request = {
          parent: `projects/${projectId}/locations/${location}`,
          content: text,
          mimeType: 'text/plain',
        };

        const [response] = await translationClient.detectLanguage(request);

        const detectedLanguageCode = response.languages?.[0]?.languageCode || 'en';
        return getLanguageName(detectedLanguageCode);
      },
      `[GoogleCloud] Detect language for "${text.substring(0, 40)}..."`,
      { maxRetries: 2, initialDelayMs: 500, backoffMultiplier: 2 }
    );
  } catch (error) {
    console.error("Google Cloud language detection error after retries:", error);
    return "English"; // Default fallback
  }
}

// Keep this for backward compatibility but just return the original text
export async function improveTranscription(text: string, context?: string): Promise<string> {
  // For speed, we skip transcription improvement with Google Cloud
  // The Speech-to-Text API already provides high-quality results with punctuation
  return text;
}
