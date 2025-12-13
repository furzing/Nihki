// AudioWorklet processor for reliable PCM conversion on mobile browsers
// Converts Float32 audio to Int16 LINEAR16 PCM format
class AudioProcessorWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 4096; // Send in chunks for efficiency
    this.buffer = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (!input || !input[0]) {
      return true;
    }

    // Get first channel (mono)
    const channelData = input[0];
    
    // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
    const int16Data = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i])); // Clamp
      int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Add to buffer
    this.buffer.push(...int16Data);

    // Send chunks when we have enough data
    while (this.buffer.length >= this.chunkSize) {
      const chunk = new Int16Array(this.buffer.splice(0, this.chunkSize));
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
    }

    return true; // Keep processor alive
  }
}

registerProcessor('audio-processor-worklet', AudioProcessorWorklet);
