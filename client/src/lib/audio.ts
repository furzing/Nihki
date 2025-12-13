import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioCaptureOptions {
  onAudioData?: (audioData: Uint8Array) => void;
  onError?: (error: Error) => void;
  sampleRate?: number;
  channels?: number;
}

export function useAudioCapture({
  onAudioData,
  onError,
  sampleRate = 16000,
  channels = 1
}: AudioCaptureOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [actualSampleRate, setActualSampleRate] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  // Use refs to always have access to current callback and error handler
  const onAudioDataRef = useRef(onAudioData);
  const onErrorRef = useRef(onError);
  
  // Update refs whenever callbacks change
  useEffect(() => {
    onAudioDataRef.current = onAudioData;
  }, [onAudioData]);
  
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const startRecording = useCallback(async () => {
    try {
      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsSupported(false);
        throw new Error('Audio recording not supported in this browser');
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: channels,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: sampleRate }
        }
      });

      streamRef.current = stream;

      // Detect ACTUAL sample rate from audio track
      const audioTrack = stream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();
      const hwSampleRate = settings.sampleRate || 48000;
      setActualSampleRate(hwSampleRate);
      console.log(`[Audio] Hardware sample rate: ${hwSampleRate}Hz (requested: ${sampleRate}Hz)`);

      // Create AudioContext with actual hardware sample rate
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      console.log(`[Audio] AudioContext created with sample rate: ${audioContext.sampleRate}Hz`);

      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Use ScriptProcessorNode for PCM extraction (works on all browsers including mobile)
      // 4096 buffer size = ~85ms latency at 48kHz (acceptable for streaming)
      const scriptProcessor = audioContext.createScriptProcessor(4096, channels, channels);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0); // Mono

        // Convert Float32 (-1.0 to 1.0) to Int16 LINEAR16 PCM (-32768 to 32767)
        const int16Buffer = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          const s = Math.max(-1, Math.min(1, channelData[i])); // Clamp to range
          int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to Uint8Array (byte representation)
        const uint8Array = new Uint8Array(int16Buffer.buffer);
        
        // Send to callback
        onAudioDataRef.current?.(uint8Array);
      };

      // Connect audio graph: source → scriptProcessor → destination
      source.connect(scriptProcessor);
      scriptProcessor.connect(audioContext.destination);

      setIsRecording(true);
      console.log('[Audio] Recording started with ScriptProcessorNode');

    } catch (error) {
      console.error('[Audio] Failed to start recording:', error);
      setIsSupported(false);
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to start recording'));
    }
  }, [sampleRate, channels]);

  const stopRecording = useCallback(() => {
    console.log('[Audio] Stopping recording...');
    setIsRecording(false);

    // Disconnect script processor
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    // Disconnect source
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('[Audio] Stopped track:', track.kind);
      });
      streamRef.current = null;
    }

    setActualSampleRate(null);
  }, []);

  const pauseRecording = useCallback(() => {
    // ScriptProcessorNode doesn't have pause - we'd need to disconnect/reconnect
    setIsRecording(false);
    console.log('[Audio] Paused (note: ScriptProcessor continues processing)');
  }, []);

  const resumeRecording = useCallback(() => {
    setIsRecording(true);
    console.log('[Audio] Resumed');
  }, []);

  return {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isSupported,
    actualSampleRate
  };
}

export async function playAudioFromBase64(base64Audio: string, volume: number = 1.0): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const audio = new Audio(`data:audio/webm;base64,${base64Audio}`);
      audio.volume = Math.max(0, Math.min(1, volume));
      
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Failed to play audio'));
      
      audio.play().catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

export function getAudioDevices(): Promise<MediaDeviceInfo[]> {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      reject(new Error('Device enumeration not supported'));
      return;
    }

    navigator.mediaDevices.enumerateDevices()
      .then(devices => {
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        resolve(audioInputs);
      })
      .catch(reject);
  });
}

export function checkAudioSupport(): boolean {
  return !!(navigator.mediaDevices && 
           navigator.mediaDevices.getUserMedia && 
           window.MediaRecorder);
}