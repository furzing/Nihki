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
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
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
          autoGainControl: true
        }
      });

      streamRef.current = stream;

      // Create Audio Context for capturing RAW PCM audio
      // Use the requested sample rate for LINEAR16 format
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: sampleRate
      });
      audioContextRef.current = audioContext;

      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Create script processor for capturing raw audio data
      // Buffer size of 4096 gives us chunks every ~256ms at 16kHz
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, channels, channels);
      processorRef.current = processor;

      // Set recording to true BEFORE setting up the processor
      setIsRecording(true);

      processor.onaudioprocess = (e) => {
        // Get raw PCM data from the first channel
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767) for LINEAR16
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp the value between -1 and 1
          const s = Math.max(-1, Math.min(1, inputData[i]));
          // Convert to 16-bit integer
          int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert Int16Array to Uint8Array (binary format)
        const audioBytes = new Uint8Array(int16Data.buffer);
        
        console.log('[SpeakerCard] Audio chunk captured, size:', audioBytes.length, 'bytes');
        
        // Use current callback from ref (always has latest version)
        onAudioDataRef.current?.(audioBytes);
      };

      // Connect the audio graph
      source.connect(processor);
      processor.connect(audioContext.destination);

    } catch (error) {
      setIsSupported(false);
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to start recording'));
    }
  }, [sampleRate, channels]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);

    // Disconnect audio graph
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

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
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const pauseRecording = useCallback(() => {
    setIsRecording(false);
  }, []);

  const resumeRecording = useCallback(() => {
    setIsRecording(true);
  }, []);

  return {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isSupported
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
