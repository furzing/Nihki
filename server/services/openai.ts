import OpenAI from "openai";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key"
});

export async function transcribeAudio(audioBuffer: Buffer): Promise<{
  text: string;
  language: string;
  confidence?: number;
  duration?: number;
}> {
  try {
    // Create a proper file-like object for OpenAI with filename
    const audioFile = new File([audioBuffer], "audio.webm", { 
      type: "audio/webm" 
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      // Remove language parameter to enable auto-detection
      response_format: "verbose_json"
    });

    return {
      text: transcription.text,
      language: transcription.language || "en",
      confidence: 0.9, // Whisper doesn't provide confidence, using default
      duration: transcription.duration || 0
    };
  } catch (error) {
    console.error("OpenAI transcription error:", error);
    throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function translateText(
  text: string, 
  fromLanguage: string, 
  toLanguage: string
): Promise<string> {
  try {
    const prompt = `Translate the following text from ${fromLanguage} to ${toLanguage}. 
    Provide only the translation without any additional text or explanation.
    
    Text to translate: "${text}"
    
    Please respond with a JSON object in this format: { "translation": "your translation here" }`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a professional translator. Provide accurate, natural translations while preserving the meaning and tone of the original text. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{"translation": ""}');
    return result.translation || text; // Fallback to original text if translation fails
  } catch (error) {
    console.error("OpenAI translation error:", error);
    throw new Error(`Failed to translate text: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function generateSpeech(text: string, voice: string = "nova"): Promise<Buffer> {
  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice as any,
      input: text,
      response_format: "mp3"
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } catch (error) {
    console.error("OpenAI speech generation error:", error);
    throw new Error(`Failed to generate speech: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function detectLanguage(text: string): Promise<string> {
  try {
    const prompt = `Detect the language of the following text and respond with the language name in English.
    
    Text: "${text}"
    
    Please respond with a JSON object in this format: { "language": "English" }`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a language detection expert. Identify the language of the given text and respond with the language name in English. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{"language": "English"}');
    return result.language || "English";
  } catch (error) {
    console.error("OpenAI language detection error:", error);
    return "English"; // Default fallback
  }
}

export async function improveTranscription(text: string, context?: string): Promise<string> {
  try {
    const prompt = `Please improve the following transcription by fixing any obvious errors, adding proper punctuation, and making it more readable while preserving the original meaning.
    
    ${context ? `Context: ${context}` : ''}
    
    Transcription: "${text}"
    
    Please respond with a JSON object in this format: { "improved_text": "your improved transcription here" }`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a transcription editor. Improve transcriptions by fixing errors and adding punctuation while preserving the original meaning and style. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{"improved_text": ""}');
    return result.improved_text || text;
  } catch (error) {
    console.error("OpenAI transcription improvement error:", error);
    return text; // Return original if improvement fails
  }
}
