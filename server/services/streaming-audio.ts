import { v1 as speechV1 } from '@google-cloud/speech';
import { GoogleAuth } from 'google-auth-library';
import { EventEmitter } from 'events';

// Initialize Google Cloud Speech client (using V1 explicitly)
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

const speechClient = new speechV1.SpeechClient({ auth });

// Streaming recognizer for a single speaker
export class SpeakerStreamRecognizer extends EventEmitter {
  private recognizeStream: any = null;
  private oldRecognizeStream: any = null; // For stream rotation
  private interimTranscript: string = '';
  private sentenceBuffer: string[] = [];
  private isActive: boolean = false;
  private isStarting: boolean = false;
  private lastActivityTime: number = Date.now();
  private audioChunkCount: number = 0;
  private pendingAudioChunks: Buffer[] = [];
  private lastFinalResultTime: number = 0;
  private SENTENCE_SILENCE_THRESHOLD: number = 500; // Fast emission: 500ms silence = sentence boundary
  private sentenceEmitTimeout: NodeJS.Timeout | null = null;

  // VAD (Voice Activity Detection) settings - CRITICAL: Don't filter too aggressively or Google Cloud times out
  private VAD_SILENCE_THRESHOLD: number = 5; // Lowered to 5 to catch quiet phone input
  private VAD_CONSECUTIVE_SILENT_FRAMES: number = 40; // Require 40 frames (~2s w/ typ 50ms) to ensure we don't cut off breaks
  private consecutiveSilentFrames: number = 0;
  private silentFramesFiltered: number = 0;

  // STT Stream Rotation at 4 minutes (Google Cloud 5-minute limit)
  private streamCreatedTime: number = Date.now();
  private STREAM_ROTATION_INTERVAL: number = 4 * 60 * 1000; // 4 minutes in ms
  private streamRotationCheckInterval: NodeJS.Timeout | null = null;
  private isRotatingStream: boolean = false;

  constructor(
    private participantId: string,
    private speakerName: string,
    private sessionId: string
  ) {
    super();
    this.sampleRate = 16000; // Default, can be updated
    this.languageCode = 'en-US'; // Default, can be updated
  }

  // Allow updating stream configuration
  public sampleRate: number;
  public languageCode: string;

  private createNewStream() {
    console.log(`[Stream] Creating stream with ${this.sampleRate}Hz, lang: ${this.languageCode}`);
    return speechClient
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: this.sampleRate,
          languageCode: this.languageCode,
          enableAutomaticPunctuation: true,
          model: 'default',
          useEnhanced: true,
          alternativeLanguageCodes: [
            'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-PT',
            'zh-CN', 'ja-JP', 'ko-KR', 'ar-SA', 'hi-IN'
          ],
        },
        interimResults: true,
        singleUtterance: false,
      })
      .on('error', (error: any) => {
        console.error(`[Stream] ❌ Error for ${this.speakerName}:`, error);
        this.emit('error', error);

        if (error.code === 8 || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('Quota exceeded')) {
          console.log(`[Stream] ⏸️  Quota exceeded for ${this.speakerName}, not restarting to avoid loops`);
          this.stop();
          return;
        }

        this.restart();
      })
      .on('data', (data: any) => {
        this.handleStreamingResponse(data);
      })
      .on('end', () => {
        console.log(`[Stream] Stream ended for ${this.speakerName}`);
      });
  }

  private startStreamRotationCheck() {
    if (this.streamRotationCheckInterval) {
      clearInterval(this.streamRotationCheckInterval);
    }

    // Check every 30 seconds if we need to rotate the stream
    this.streamRotationCheckInterval = setInterval(() => {
      const streamAge = Date.now() - this.streamCreatedTime;
      if (streamAge > this.STREAM_ROTATION_INTERVAL && !this.isRotatingStream && this.isActive) {
        console.log(`[Stream] ⏱️ Stream age: ${(streamAge / 1000 / 60).toFixed(1)} min - rotating stream for ${this.speakerName}`);
        this.rotateStream();
      }
    }, 30000); // Check every 30 seconds
  }

  private rotateStream() {
    if (this.isRotatingStream) {
      return; // Already rotating
    }

    this.isRotatingStream = true;
    console.log(`[Stream] 🔄 Rotating stream for ${this.speakerName}`);

    try {
      // Keep old stream for final results
      this.oldRecognizeStream = this.recognizeStream;

      // Create new stream
      this.recognizeStream = this.createNewStream();
      this.streamCreatedTime = Date.now();
      this.audioChunkCount = 0;

      console.log(`[Stream] ✅ New stream created for ${this.speakerName}`);

      // Close old stream gracefully - don't end immediately, let pending results complete
      setTimeout(() => {
        if (this.oldRecognizeStream) {
          console.log(`[Stream] 🧹 Closing old stream for ${this.speakerName}`);
          try {
            this.oldRecognizeStream.end();
          } catch (error) {
            console.error(`[Stream] Error closing old stream:`, error);
          }
          this.oldRecognizeStream = null;
        }
        this.isRotatingStream = false;
      }, 2000); // Give old stream 2 seconds to finish processing
    } catch (error) {
      console.error(`[Stream] ❌ Error rotating stream:`, error);
      this.isRotatingStream = false;
    }
  }

  start() {
    if (this.isActive || this.isStarting) {
      console.log(`[Stream] ✓ Already ${this.isActive ? 'active' : 'starting'} for ${this.speakerName}`);
      return;
    }

    console.log(`[Stream] 🎤 Starting stream for ${this.speakerName} (session: ${this.sessionId})`);
    this.isStarting = true;
    this.interimTranscript = '';
    this.sentenceBuffer = [];
    this.audioChunkCount = 0;
    this.streamCreatedTime = Date.now();

    // Pass config directly to streamingRecognize() - this is the correct V1 API usage
    this.recognizeStream = this.createNewStream();

    console.log(`[Stream] ✅ Stream started successfully for ${this.speakerName}`);
    this.isActive = true;
    this.isStarting = false;

    // Start checking for stream rotation
    this.startStreamRotationCheck();

    // Process any pending audio chunks
    if (this.pendingAudioChunks.length > 0) {
      console.log(`[Stream] Processing ${this.pendingAudioChunks.length} pending chunks for ${this.speakerName}`);
      const chunks = [...this.pendingAudioChunks];
      this.pendingAudioChunks = [];

      setImmediate(() => {
        chunks.forEach(chunk => this.writeAudioChunk(chunk));
      });
    }
  }

  private handleStreamingResponse(data: any) {
    this.lastActivityTime = Date.now();

    if (!data.results || data.results.length === 0) {
      return;
    }

    const result = data.results[0];
    if (!result.alternatives || result.alternatives.length === 0) {
      return;
    }

    const alternative = result.alternatives[0];
    const transcript = alternative.transcript || '';
    const confidence = alternative.confidence || 0;

    if (result.isFinal) {
      // Final result - this is a complete utterance from Google Cloud
      console.log(`[Stream] Final: "${transcript}" (confidence: ${confidence.toFixed(2)})`);

      if (transcript.trim()) {
        this.lastFinalResultTime = Date.now();

        // Accumulate final results - don't emit immediately
        // This allows us to wait for complete sentences with proper pauses
        this.interimTranscript += transcript + ' ';

        // Check if this looks like a sentence end
        const hasSentenceEnd = /[.!?]\s*$/.test(transcript);
        const hasMinimumLength = this.interimTranscript.trim().split(' ').length >= 3;

        // Emit if: (has punctuation + min length) OR (more than 20 words accumulated)
        if (hasSentenceEnd && hasMinimumLength) {
          // Strong sentence boundary detected - emit immediately
          this.emitAccumulatedSentence();
        } else {
          const wordCount = this.interimTranscript.trim().split(/\s+/).length;
          if (wordCount >= 20) {
            // 20+ words = emit to keep translation flowing
            this.emitAccumulatedSentence();
          } else {
            // Schedule emission after short silence (500ms)
            this.scheduleEmissionCheck();
          }
        }
      }
    } else {
      // Interim result - just for live feedback
      console.log(`[Stream] Interim: "${transcript}"`);
      this.emit('interim', {
        text: this.interimTranscript + transcript,
        participantId: this.participantId,
        speakerName: this.speakerName,
        sessionId: this.sessionId
      });
    }
  }

  private scheduleEmissionCheck() {
    // Clear any existing timeout
    if (this.sentenceEmitTimeout) {
      clearTimeout(this.sentenceEmitTimeout);
    }

    // Schedule emission check after silence threshold
    this.sentenceEmitTimeout = setTimeout(() => {
      const timeSinceLastFinal = Date.now() - this.lastFinalResultTime;

      // If enough silence has passed and we have accumulated text, emit it
      if (timeSinceLastFinal >= this.SENTENCE_SILENCE_THRESHOLD && this.interimTranscript.trim()) {
        console.log(`[Stream] Silence detected (${timeSinceLastFinal}ms) - emitting accumulated text`);
        this.emitAccumulatedSentence();
      }
    }, this.SENTENCE_SILENCE_THRESHOLD);
  }

  private emitAccumulatedSentence() {
    const completeSentence = this.interimTranscript.trim();

    if (completeSentence.length === 0) {
      return;
    }

    console.log(`[Stream] Emitting sentence: "${completeSentence}"`);

    this.emit('sentence', {
      text: completeSentence,
      language: this.languageCode,
      confidence: 0.8,
      participantId: this.participantId,
      speakerName: this.speakerName,
      sessionId: this.sessionId
    });

    // Clear the accumulated transcript
    this.interimTranscript = '';

    // Clear any pending timeout
    if (this.sentenceEmitTimeout) {
      clearTimeout(this.sentenceEmitTimeout);
      this.sentenceEmitTimeout = null;
    }
  }

  private calculateRMS(buffer: Buffer): number {
    // Convert buffer to Int16 samples and calculate RMS energy
    // Ensure proper byte alignment for Int16Array (must be multiple of 2)
    let int16Array: Int16Array;

    if (buffer.byteOffset % 2 === 0) {
      // Buffer is properly aligned
      int16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    } else {
      // Buffer is misaligned, create a copy to ensure proper alignment
      int16Array = new Int16Array(buffer.length / 2);
      for (let i = 0; i < buffer.length; i += 2) {
        int16Array[i / 2] = buffer.readInt16LE(i);
      }
    }

    let sumSquares = 0;

    for (let i = 0; i < int16Array.length; i++) {
      const sample = int16Array[i] / 32768; // Normalize to -1.0 to 1.0
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / int16Array.length);
    return rms * 10000; // Scale for easier threshold comparison
  }

  private isVoiceActivity(audioChunk: Buffer): boolean {
    // Calculate RMS energy
    const rms = this.calculateRMS(audioChunk);

    // If RMS is below threshold, increment silent frame counter
    if (rms < this.VAD_SILENCE_THRESHOLD) {
      this.consecutiveSilentFrames++;

      // Only filter if we have enough consecutive silent frames
      if (this.consecutiveSilentFrames >= this.VAD_CONSECUTIVE_SILENT_FRAMES) {
        this.silentFramesFiltered++;
        return false; // Silence detected
      }
    } else {
      // Voice detected, reset counter
      this.consecutiveSilentFrames = 0;
    }

    return true; // Voice activity detected
  }

  writeAudioChunk(audioChunk: Buffer) {
    // If stream is starting, queue the chunk
    if (this.isStarting) {
      this.pendingAudioChunks.push(audioChunk);
      return;
    }

    // If stream is not active, start it and queue the chunk
    if (!this.isActive || !this.recognizeStream) {
      console.log(`[Stream] 🔄 Auto-starting stream for ${this.speakerName}`);
      this.pendingAudioChunks.push(audioChunk);
      this.start();
      return;
    }

    // VAD filtering: skip silent frames
    if (!this.isVoiceActivity(audioChunk)) {
      return; // Skip this silent frame, don't send to Google Cloud
    }

    this.lastActivityTime = Date.now();
    this.audioChunkCount++;

    // Write raw audio buffer directly to stream - V1 API accepts Buffer directly
    this.recognizeStream.write(audioChunk);

    // Log every 10 chunks sent (not including filtered frames)
    if (this.audioChunkCount % 10 === 0) {
      const totalFrames = this.audioChunkCount + this.silentFramesFiltered;
      const filterRate = ((this.silentFramesFiltered / totalFrames) * 100).toFixed(1);
      console.log(`[Stream] 📊 ${this.speakerName}: ${this.audioChunkCount} chunks sent, ${this.silentFramesFiltered} silent frames filtered (${filterRate}% filtered)`);
    }
  }

  // Flush any accumulated interim transcript as final
  flush() {
    if (this.interimTranscript.trim()) {
      console.log(`[Stream] Flushing accumulated: "${this.interimTranscript}"`);
      this.emit('sentence', {
        text: this.interimTranscript.trim(),
        language: this.languageCode,
        confidence: 0.8,
        participantId: this.participantId,
        speakerName: this.speakerName,
        sessionId: this.sessionId
      });
      this.interimTranscript = '';
    }
  }

  stop() {
    console.log(`[Stream] Stopping stream for ${this.speakerName}`);

    // Clear rotation check
    if (this.streamRotationCheckInterval) {
      clearInterval(this.streamRotationCheckInterval);
      this.streamRotationCheckInterval = null;
    }

    // Clear any pending emission timeout
    if (this.sentenceEmitTimeout) {
      clearTimeout(this.sentenceEmitTimeout);
      this.sentenceEmitTimeout = null;
    }

    this.flush(); // Flush any pending transcript

    if (this.recognizeStream) {
      this.recognizeStream.end();
      this.recognizeStream = null;
    }

    // Close old stream if still exists
    if (this.oldRecognizeStream) {
      try {
        this.oldRecognizeStream.end();
      } catch (error) {
        console.error(`[Stream] Error closing old stream:`, error);
      }
      this.oldRecognizeStream = null;
    }

    this.isActive = false;
    this.isStarting = false;
    this.pendingAudioChunks = []; // Clear pending chunks
  }

  private restart() {
    console.log(`[Stream] Restarting stream for ${this.speakerName}`);
    this.stop();
    setTimeout(() => {
      if (Date.now() - this.lastActivityTime < 5000) {
        this.start();
      }
    }, 500);
  }

  getLastActivityTime(): number {
    return this.lastActivityTime;
  }

  isStreamActive(): boolean {
    return this.isActive;
  }
}

// Manager for all speaker streams
export class StreamingAudioManager {
  private streams = new Map<string, SpeakerStreamRecognizer>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup inactive streams every 30 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveStreams();
    }, 30000);
  }

  getOrCreateStream(
    participantId: string,
    speakerName: string,
    sessionId: string
  ): SpeakerStreamRecognizer {
    const key = `${sessionId}:${participantId}`;

    let stream = this.streams.get(key);
    if (!stream) {
      console.log(`[Manager] Creating new stream for ${speakerName}`);
      stream = new SpeakerStreamRecognizer(participantId, speakerName, sessionId);
      this.streams.set(key, stream);
    }

    return stream;
  }

  stopStream(participantId: string, sessionId: string) {
    const key = `${sessionId}:${participantId}`;
    const stream = this.streams.get(key);

    if (stream) {
      stream.stop();
      this.streams.delete(key);
    }
  }

  private cleanupInactiveStreams() {
    const now = Date.now();
    const INACTIVE_TIMEOUT = 30000; // 30 seconds

    const entries = Array.from(this.streams.entries());
    for (const [key, stream] of entries) {
      if (now - stream.getLastActivityTime() > INACTIVE_TIMEOUT) {
        console.log(`[Manager] Cleaning up inactive stream: ${key}`);
        stream.stop();
        this.streams.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    const streams = Array.from(this.streams.values());
    for (const stream of streams) {
      stream.stop();
    }
    this.streams.clear();
  }
}