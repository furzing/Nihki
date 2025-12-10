/**
 * Audio Queue Manager
 * Manages sequential playback of audio clips to prevent interruption
 * Ensures each interpretation finishes playing before the next one starts
 * Handles mobile autoplay restrictions by initializing audio context
 */

export class AudioQueue {
  private queue: { url: string; id: string }[] = [];
  private isPlaying = false;
  private currentAudio: HTMLAudioElement | null = null;
  private onQueueUpdate: ((length: number) => void) | null = null;
  private audioContextInitialized = false;
  private audioContext: AudioContext | null = null;
  private onPlaybackError: ((error: string) => void) | null = null;
  private readonly MAX_QUEUE_SIZE = 50; // Large conferences: prevent unbounded queue growth
  private urlCache = new Set<string>(); // Track URLs to prevent duplicate blob creation

  constructor(private volume: number = 0.8) {
    // Initialize audio context on first user interaction
    this.initializeAudioContextOnInteraction();
  }

  /**
   * Initialize audio context on first user interaction
   * This is required for mobile browsers to allow audio playback
   * Uses passive listeners to not interfere with page interactions
   */
  private initializeAudioContextOnInteraction() {
    const initAudio = async () => {
      try {
        if (!this.audioContextInitialized) {
          // Create an audio context
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          this.audioContext = audioContext;
          this.audioContextInitialized = true;
          console.log('[AudioQueue] Audio context initialized on user interaction');
          // Remove all listeners once initialized
          document.removeEventListener('click', initAudio, true);
          document.removeEventListener('touchstart', initAudio, true);
          document.removeEventListener('keydown', initAudio, true);
          document.removeEventListener('scroll', initAudio, true);
          document.removeEventListener('pointerdown', initAudio, true);
        }
      } catch (error) {
        console.error('[AudioQueue] Failed to initialize audio context:', error);
      }
    };

    // Initialize on any user interaction (passive events won't interfere with scrolling)
    document.addEventListener('click', initAudio, { once: true, capture: true });
    document.addEventListener('touchstart', initAudio, { once: true, capture: true });
    document.addEventListener('keydown', initAudio, { once: true, capture: true });
    document.addEventListener('scroll', initAudio, { once: true, passive: true, capture: true });
    document.addEventListener('pointerdown', initAudio, { once: true, capture: true });
  }

  /**
   * Add an audio URL to the queue
   * For large conferences: enforces max queue size to prevent memory bloat
   */
  addToQueue(url: string, id: string = `audio-${Date.now()}`) {
    // For large conferences (100+ participants), limit queue to prevent memory issues
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      console.warn(`[AudioQueue] Queue size (${this.queue.length}) exceeds limit, dropping oldest audio`);
      this.queue.shift(); // Remove oldest to make room for new
    }
    
    this.queue.push({ url, id });
    this.onQueueUpdate?.(this.queue.length);
    this.processQueue();
  }

  /**
   * Play the next audio in the queue
   */
  private async processQueue() {
    // If already playing or queue is empty, return
    if (this.isPlaying || this.queue.length === 0) {
      return;
    }

    const { url, id } = this.queue.shift()!;
    this.onQueueUpdate?.(this.queue.length);

    try {
      this.isPlaying = true;

      const audio = new Audio(url);
      audio.volume = this.volume;
      this.currentAudio = audio;

      // When audio finishes, play the next one
      const onEnded = () => {
        this.isPlaying = false;
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        this.currentAudio = null;
        this.processQueue(); // Play next in queue
      };

      const onError = (error: Event) => {
        console.error(`[AudioQueue] Error playing audio (${id}):`, error);
        this.onPlaybackError?.(`Failed to play audio: ${error}`);
        this.isPlaying = false;
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        this.currentAudio = null;
        this.processQueue(); // Try next in queue
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      try {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
      } catch (playError: any) {
        // Handle autoplay restrictions on mobile
        const errorMsg = playError?.message || 'Autoplay restricted';
        console.warn(`[AudioQueue] Autoplay failed for ${id}:`, errorMsg);
        
        // On mobile, autoplay might be restricted. Try to initialize audio context
        if (!this.audioContextInitialized) {
          try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (audioContext.state === 'suspended') {
              await audioContext.resume();
            }
            this.audioContext = audioContext;
            this.audioContextInitialized = true;
            console.log('[AudioQueue] Audio context resumed, retrying playback');
            
            // Retry playback after context resume
            await audio.play();
          } catch (contextError) {
            console.error('[AudioQueue] Failed to resume audio context:', contextError);
            this.onPlaybackError?.('Audio playback restricted. Please tap the screen to enable audio.');
            this.isPlaying = false;
            this.currentAudio = null;
            this.processQueue(); // Skip this audio and try next
          }
        } else {
          this.onPlaybackError?.('Audio playback failed');
          this.isPlaying = false;
          this.currentAudio = null;
          this.processQueue(); // Skip and try next
        }
      }
    } catch (error) {
      console.error(`[AudioQueue] Failed to create audio element (${id}):`, error);
      this.isPlaying = false;
      this.currentAudio = null;
      this.processQueue(); // Try next in queue
    }
  }

  /**
   * Stop current playback and clear the queue
   */
  clear() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
    }
    // Clean up blob URLs for large conferences
    this.queue.forEach(item => {
      if (item.url.startsWith('blob:')) {
        URL.revokeObjectURL(item.url);
      }
    });
    this.urlCache.clear();
    this.queue = [];
    this.isPlaying = false;
    this.currentAudio = null;
    this.onQueueUpdate?.(0);
  }

  /**
   * Pause current playback without clearing queue
   */
  pause() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.isPlaying = false;
    }
  }

  /**
   * Resume playback
   */
  resume() {
    if (this.currentAudio) {
      this.currentAudio.play().catch(err => {
        console.error('[AudioQueue] Error resuming playback:', err);
      });
    }
  }

  /**
   * Set volume (0-1)
   */
  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.currentAudio) {
      this.currentAudio.volume = this.volume;
    }
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Set callback for queue length updates
   */
  onUpdate(callback: (length: number) => void) {
    this.onQueueUpdate = callback;
  }

  /**
   * Set callback for playback errors (e.g., autoplay restrictions)
   */
  onError(callback: (error: string) => void) {
    this.onPlaybackError = callback;
  }

  /**
   * Force initialize audio context
   * Call this after user interaction to ensure audio can play
   */
  async forceInitializeAudioContext() {
    if (!this.audioContextInitialized) {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        this.audioContext = audioContext;
        this.audioContextInitialized = true;
        console.log('[AudioQueue] Audio context force-initialized');
        return true;
      } catch (error) {
        console.error('[AudioQueue] Failed to force-initialize audio context:', error);
        return false;
      }
    }
    return true;
  }
}
