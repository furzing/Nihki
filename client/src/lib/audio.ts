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
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
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
      if (isRecording) return;

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsSupported(false);
        throw new Error('Audio recording not supported in this browser');
      }

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

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioContext.resume();
      audioContextRef.current = audioContext;

      // Use the hardware sample rate (mobile usually 48000)
      const hwSampleRate = audioContext.sampleRate;
      setActualSampleRate(hwSampleRate);
      console.log(`[Audio] Hardware sample rate: ${hwSampleRate}Hz (requested: ${sampleRate}Hz)`);

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      // Mute downstream to avoid feedback while keeping graph alive
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      gainNodeRef.current = gainNode;

      let workletStarted = false;

      // Prefer AudioWorklet (mobile-friendly, off-main-thread)
      if (audioContext.audioWorklet && typeof audioContext.audioWorklet.addModule === 'function') {
        try {
          await audioContext.audioWorklet.addModule('/audio-processor.worklet.js');
          const workletNode = new AudioWorkletNode(audioContext, 'audio-processor-worklet');
          workletNodeRef.current = workletNode;

          workletNode.port.onmessage = (event) => {
            const audioBytes = new Uint8Array(event.data);
            onAudioDataRef.current?.(audioBytes);
          };

          source.connect(workletNode);
          workletNode.connect(gainNode).connect(audioContext.destination);
          workletStarted = true;
          console.log('[Audio] Recording with AudioWorklet');
        } catch (err) {
          console.warn('[Audio] AudioWorklet unavailable, falling back to ScriptProcessor', err);
        }
      }

      // Fallback: ScriptProcessorNode
      if (!workletStarted) {
        const scriptProcessor = audioContext.createScriptProcessor(4096, channels, channels);
        scriptProcessorRef.current = scriptProcessor;

        scriptProcessor.onaudioprocess = (event) => {
          const inputBuffer = event.inputBuffer;
          const channelData = inputBuffer.getChannelData(0);
          const int16Buffer = new Int16Array(channelData.length);
          for (let i = 0; i < channelData.length; i++) {
            const s = Math.max(-1, Math.min(1, channelData[i]));
            int16Buffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          const uint8Array = new Uint8Array(int16Buffer.buffer);
          onAudioDataRef.current?.(uint8Array);
        };

        source.connect(scriptProcessor);
        scriptProcessor.connect(gainNode).connect(audioContext.destination);
        console.log('[Audio] Recording with ScriptProcessor fallback');
      }

      setIsRecording(true);
    } catch (error) {
      console.error('[Audio] Failed to start recording:', error);
      setIsSupported(false);
      onErrorRef.current?.(error instanceof Error ? error : new Error('Failed to start recording'));
    }
  }, [sampleRate, channels, isRecording]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    setIsRecording(false);

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current.port.close();
      workletNodeRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setActualSampleRate(null);
  }, [isRecording]);

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