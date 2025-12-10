import { SpeechClient } from '@google-cloud/speech';
import { GoogleAuth } from 'google-auth-library';
import { EventEmitter } from 'events';

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

const auth = credentials
  ? new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
  : new GoogleAuth();

const speechClient = new SpeechClient({ auth });

interface TranscriptionEvent {
  text: string;
  language: string;
  confidence: number;
  isFinal: boolean;
}

interface SpeechActivityEvent {
  type: 'SPEECH_START' | 'SPEECH_END';
  timestamp: number;
}

export class StreamingTranscriber extends EventEmitter {
  private recognizeStream: any = null;
  private isActive = false;
  private audioQueue: Buffer[] = [];
  private processingQueue = false;

  constructor(private languageCode: string = 'en-US') {
    super();
  }

  start() {
    if (this.isActive) {
      console.log('[StreamingTranscriber] Already active, ignoring start');
      return;
    }

    console.log('[StreamingTranscriber] Starting streaming recognition');
    this.isActive = true;

    const request = {
      config: {
        encoding: 'WEBM_OPUS' as const,
        sampleRateHertz: 48000,
        languageCode: this.languageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_long',
        useEnhanced: true,
        alternativeLanguageCodes: ['es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT', 'zh-CN', 'ja-JP', 'ko-KR'],
      },
      interimResults: true,
      singleUtterance: false,
    };

    this.recognizeStream = speechClient
      .streamingRecognize(request)
      .on('error', (error: Error) => {
        console.error('[StreamingTranscriber] Stream error:', error);
        this.emit('error', error);
        this.restart();
      })
      .on('data', (data: any) => {
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          const alternative = result.alternatives[0];

          if (alternative && alternative.transcript) {
            const transcription: TranscriptionEvent = {
              text: alternative.transcript,
              language: result.languageCode || this.languageCode,
              confidence: alternative.confidence || 0.9,
              isFinal: result.isFinal || false,
            };

            console.log(`[StreamingTranscriber] ${transcription.isFinal ? 'FINAL' : 'interim'}: "${transcription.text}"`);
            this.emit('transcription', transcription);

            if (transcription.isFinal) {
              this.emit('final-transcription', transcription);
            }
          }
        }

        if (data.speechEventType === 'END_OF_SINGLE_UTTERANCE') {
          console.log('[StreamingTranscriber] End of utterance detected');
          this.emit('speech-end');
        }
      })
      .on('end', () => {
        console.log('[StreamingTranscriber] Stream ended');
        if (this.isActive) {
          this.restart();
        }
      });

    this.processAudioQueue();
  }

  async processAudioQueue() {
    if (this.processingQueue || !this.isActive) {
      return;
    }

    this.processingQueue = true;

    while (this.audioQueue.length > 0 && this.isActive) {
      const audioChunk = this.audioQueue.shift();
      if (audioChunk && this.recognizeStream) {
        try {
          this.recognizeStream.write(audioChunk);
        } catch (error) {
          console.error('[StreamingTranscriber] Error writing to stream:', error);
          this.restart();
          break;
        }
      }
      await new Promise(resolve => setImmediate(resolve));
    }

    this.processingQueue = false;
  }

  write(audioChunk: Buffer) {
    if (!this.isActive) {
      console.log('[StreamingTranscriber] Not active, queuing chunk');
      return;
    }

    this.audioQueue.push(audioChunk);

    if (!this.processingQueue) {
      this.processAudioQueue();
    }
  }

  private restart() {
    console.log('[StreamingTranscriber] Restarting stream');
    this.stop();
    setTimeout(() => {
      if (this.isActive) {
        this.start();
      }
    }, 100);
  }

  stop() {
    console.log('[StreamingTranscriber] Stopping');
    this.isActive = false;

    if (this.recognizeStream) {
      try {
        this.recognizeStream.end();
      } catch (error) {
        console.error('[StreamingTranscriber] Error ending stream:', error);
      }
      this.recognizeStream = null;
    }

    this.audioQueue = [];
    this.processingQueue = false;
  }

  isRunning(): boolean {
    return this.isActive;
  }
}

function getLanguageCode(languageName: string): string {
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
  };
  return LANGUAGE_CODE_MAP[languageName] || 'en-US';
}

function getLanguageName(languageCode: string): string {
  const LANGUAGE_CODE_MAP: Record<string, string> = {
    'en-US': 'English',
    'es-ES': 'Spanish',
    'fr-FR': 'French',
    'de-DE': 'German',
    'it-IT': 'Italian',
    'pt-PT': 'Portuguese',
    'ru-RU': 'Russian',
    'zh-CN': 'Chinese',
    'ja-JP': 'Japanese',
    'ko-KR': 'Korean',
    'ar-SA': 'Arabic',
    'hi-IN': 'Hindi',
  };

  const code = languageCode.split('-')[0];
  const entry = Object.entries(LANGUAGE_CODE_MAP).find(([key]) =>
    key.toLowerCase().startsWith(code.toLowerCase())
  );
  return entry ? entry[1] : 'English';
}

export { getLanguageCode, getLanguageName };
