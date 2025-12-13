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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const metadataSentRef = useRef(false); // Prevent spam
  
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
          sampleRate: { ideal: sampleRate } // Hint, but browser may ignore
        }
      });

      streamRef.current = stream;

      // CRITICAL: Create AudioContext WITHOUT specifying sampleRate
      // This lets the browser use native hardware sample rate
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      // Capture ACTUAL hardware sample rate (48kHz on most phones)
      const hwSampleRate = audioContext.sampleRate;
      setActualSampleRate(hwSampleRate);
      console.log(`[Audio] Hardware sample rate: ${hwSampleRate}Hz (requested: ${sampleRate}Hz)`);

      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Load AudioWorklet for reliable mobile processing
      await audioContext.audioWorklet.addModule('/audio-processor.worklet.js');
      
      // Create worklet node
      const workletNode = new AudioWorkletNode(audioContext, 'audio-processor-worklet');
      workletNodeRef.current = workletNode;

      // Handle audio data from worklet
      workletNode.port.onmessage = (event) => {
        const audioBytes = new Uint8Array(event.data);
        console.log(`[Audio] Chunk captured: ${audioBytes.length} bytes @ ${hwSampleRate}Hz`);
        onAudioDataRef.current?.(audioBytes);
      };

      // Connect the audio graph
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      setIsRecording(true);
      metadataSentRef.current = false; // Reset for new session

    } catch (error) {
      setIsSupported(false);
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to start recording'));
    }
  }, [sampleRate, channels]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    metadataSentRef.current = false;

    // Disconnect audio graph
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current.port.close();
      workletNodeRef.current = null;
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

    setActualSampleRate(null);
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
    isSupported,
    actualSampleRate // Expose actual sample rate
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