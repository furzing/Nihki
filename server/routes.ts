import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer as WSServer, WebSocket } from "ws";
import { streamingTranscriptionManager as streamingManager } from "./services/streaming-transcription";
import type { Storage } from "./db-storage";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import prism from "prism-media";
import { Readable, Transform } from "stream";
import { DbStorage } from "./db-storage";
import { insertSessionSchema, insertParticipantSchema, insertSpeakerSchema, insertUserSchema, loginSchema, type User } from "@shared/schema";

const storage = new DbStorage();
import { translateAudio, transcribeAudio } from "./services/translation";
import multer from "multer";

// Configure multer for audio file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  }
});

// Extend Express Session to include userId
declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // Authentication Routes
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);

      const existingUser = await storage.getUserByEmail(validatedData.email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const user = await storage.createUser(validatedData);

      req.session.userId = user.id;
      
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Invalid signup data"
      });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const validatedData = loginSchema.parse(req.body);

      const user = await storage.validatePassword(validatedData.email, validatedData.password);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      console.log(`[Auth] Login success for ${user.email}, session ID before: ${req.sessionID}`);
      req.session.userId = user.id;
      
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error(`[Auth] Session save error:`, err);
            reject(err);
          } else {
            console.log(`[Auth] Session saved successfully, session ID: ${req.sessionID}, userId: ${req.session.userId}`);
            resolve();
          }
        });
      });

      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("[Login Error]", error);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Invalid login data",
        details: error instanceof Error ? error.stack : undefined
      });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    console.log(`[Auth] /me called, session ID: ${req.sessionID}, userId in session: ${req.session.userId}`);
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });

  // Session Management Routes
  app.post("/api/sessions", async (req, res) => {
    try {
      // Require authentication
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }

      // Get user details
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const validatedData = insertSessionSchema.parse(req.body);

      // Handle expiresAt - convert string to Date if needed, or use default
      let expiresAt: Date;
      if (validatedData.expiresAt) {
        expiresAt = new Date(validatedData.expiresAt);
      } else {
        expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now (supports all-day conferences)
      }

      // Create session with host participant in a single atomic transaction
      const session = await storage.createSessionWithHostParticipant({
        ...validatedData,
        hostUserId: userId,
        hostName: user.name,
        hostEmail: user.email,
        expiresAt
      }, {
        userId: userId,
        name: user.name,
        language: user.preferredLanguage,
        role: 'host',
        preferredOutput: 'voice',
      });

      res.json(session);
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Invalid session data"
      });
    }
  });

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Fetch host language
      let hostLanguage = "English"; // Default
      if (session.hostUserId) {
        const hostUser = await storage.getUserById(session.hostUserId);
        if (hostUser) {
          hostLanguage = hostUser.preferredLanguage;
        }
      }

      res.json({ ...session, hostLanguage });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to get session"
      });
    }
  });

  app.patch("/api/sessions/:id", async (req, res) => {
    try {
      const session = await storage.updateSession(req.params.id, req.body);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }
      res.json(session);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to update session"
      });
    }
  });

  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      const session = await storage.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Delete session and all related data in atomic transaction
      await storage.deleteSessionWithParticipants(req.params.id);
      res.json({ message: "Session deleted successfully" });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to delete session"
      });
    }
  });

  // Participant Management Routes
  app.post("/api/participants", async (req, res) => {
    try {
      const validatedData = insertParticipantSchema.parse(req.body);

      // Check if session exists
      const session = await storage.getSession(validatedData.sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Check participant limit
      const existingParticipants = await storage.getParticipantsBySession(validatedData.sessionId);
      if (existingParticipants.length >= session.maxParticipants) {
        return res.status(400).json({ message: "Session is full" });
      }

      const participant = await storage.createParticipant(validatedData);

      // Broadcast participant joined to session
      broadcastToSession(validatedData.sessionId, {
        type: 'participant-joined',
        participant
      });

      res.json(participant);
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Invalid participant data"
      });
    }
  });

  app.get("/api/participants/:id", async (req, res) => {
    try {
      const participant = await storage.getParticipant(req.params.id);
      if (!participant) {
        return res.status(404).json({ message: "Participant not found" });
      }
      res.json(participant);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to get participant"
      });
    }
  });

  app.get("/api/sessions/:sessionId/participants", async (req, res) => {
    try {
      const participants = await storage.getParticipantsBySession(req.params.sessionId);
      res.json(participants);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to get participants"
      });
    }
  });

  // Transcript Download Route
  app.get("/api/sessions/:sessionId/transcript", async (req, res) => {
    try {
      const { sessionId } = req.params;

      // Verify session exists
      const session = await storage.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      // Get all translations for the session with error handling
      const translations = await storage.getTranslationsBySession(sessionId) || [];
      const participants = await storage.getParticipantsBySession(sessionId) || [];

      // Create a map of participant IDs to names
      const participantMap = new Map(participants.map(p => [p.id, p.name]));

      // Import PDFKit (installed via packager_tool) using dynamic import for ESM compatibility
      let PDFDocument;
      try {
        const pdfkit = await import('pdfkit');
        PDFDocument = pdfkit.default;
      } catch (err) {
        console.error('PDFKit not available:', err);
        return res.status(500).json({ message: "PDF generation unavailable" });
      }

      const doc = new PDFDocument();

      // Set response headers
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${session.name.replace(/[^a-z0-9]/gi, '_')}_transcript.pdf"`);

      // Pipe PDF to response
      doc.pipe(res);

      // Add title
      doc.fontSize(20).text(session.name, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Hosted by: ${session.hostName}`, { align: 'center' });
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);

      // Add transcript content
      doc.fontSize(14).text('Interpretation Transcript', { underline: true });
      doc.moveDown();

      if (translations.length === 0) {
        doc.fontSize(10).text('No interpretations recorded yet.');
      } else {
        translations.forEach((translation, index) => {
          const speakerName = participantMap.get(translation.participantId) || 'Unknown Speaker';
          const timestamp = new Date(translation.timestamp).toLocaleTimeString();

          doc.fontSize(10)
            .font('Helvetica-Bold')
            .text(`${speakerName} (${timestamp})`, { continued: false });

          doc.fontSize(10)
            .font('Helvetica')
            .text(`Original (${translation.originalLanguage}): ${translation.originalText}`, {
              indent: 20
            });

          doc.text(`Interpretation (${translation.targetLanguage}): ${translation.translatedText}`, {
            indent: 20
          });

          doc.moveDown();

          // Add page break if needed
          if (index < translations.length - 1 && doc.y > 700) {
            doc.addPage();
          }
        });
      }

      // Footer
      doc.moveDown(2);
      doc.fontSize(8)
        .fillColor('gray')
        .text('Generated by nihki - Your Voice In Every Language', { align: 'center' });

      // Finalize PDF
      doc.end();
    } catch (error) {
      console.error('Error generating transcript:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to generate transcript"
      });
    }
  });

  // Speaker Management Routes
  app.post("/api/speakers", async (req, res) => {
    try {
      const validatedData = insertSpeakerSchema.parse(req.body);

      // Check if session exists
      const session = await storage.getSession(validatedData.sessionId);
      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      const speaker = await storage.createSpeaker(validatedData);
      res.json(speaker);
    } catch (error) {
      res.status(400).json({
        message: error instanceof Error ? error.message : "Invalid speaker data"
      });
    }
  });

  app.get("/api/sessions/:sessionId/speakers", async (req, res) => {
    try {
      const speakers = await storage.getSpeakersBySession(req.params.sessionId);
      res.json(speakers);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to get speakers"
      });
    }
  });

  app.patch("/api/speakers/:id", async (req, res) => {
    try {
      const speaker = await storage.updateSpeaker(req.params.id, req.body);
      if (!speaker) {
        return res.status(404).json({ message: "Speaker not found" });
      }
      res.json(speaker);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to update speaker"
      });
    }
  });

  app.delete("/api/speakers/:id", async (req, res) => {
    try {
      await storage.deleteSpeaker(req.params.id);
      res.json({ message: "Speaker deleted successfully" });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to delete speaker"
      });
    }
  });

  // Moderation Routes
  app.patch("/api/participants/:id/raise-hand", async (req, res) => {
    try {
      const { handRaised } = req.body;
      const participant = await storage.updateParticipant(req.params.id, { handRaised });

      if (!participant) {
        return res.status(404).json({ message: "Participant not found" });
      }

      res.json(participant);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to update hand raise status"
      });
    }
  });

  app.patch("/api/participants/:id/preferences", async (req, res) => {
    try {
      const { preferredVoice } = req.body;
      const participant = await storage.updateParticipant(req.params.id, { preferredVoice });

      if (!participant) {
        return res.status(404).json({ message: "Participant not found" });
      }

      res.json(participant);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to update preferences"
      });
    }
  });

  app.patch("/api/participants/:id/speaking", async (req, res) => {
    try {
      const { isSpeaking } = req.body;
      // Clear handRaised when permission is granted or denied
      const participant = await storage.updateParticipant(req.params.id, {
        isSpeaking,
        handRaised: false
      });

      if (!participant) {
        return res.status(404).json({ message: "Participant not found" });
      }

      res.json(participant);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to update speak permission"
      });
    }
  });

  // Audio Processing Routes
  app.post("/api/audio/transcribe", upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No audio file provided" });
      }

      const transcription = await transcribeAudio(req.file.buffer);
      res.json({ transcription });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to transcribe audio"
      });
    }
  });

  app.post("/api/audio/translate", async (req, res) => {
    try {
      const { text, fromLanguage, toLanguage } = req.body;

      if (!text || !fromLanguage || !toLanguage) {
        return res.status(400).json({
          message: "Missing required fields: text, fromLanguage, toLanguage"
        });
      }

      const translation = await translateAudio(text, fromLanguage, toLanguage);
      res.json({ translation });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to translate text"
      });
    }
  });

  app.post("/api/audio/synthesize", async (req, res) => {
    try {
      const { text, language, voiceName } = req.body;

      if (!text || !language) {
        return res.status(400).json({
          message: "Missing required fields: text, language"
        });
      }

      const { generateSpeech } = await import("./services/googlecloud");
      const { getLanguageCode } = await import("./services/translation");

      const languageCode = getLanguageCode(language);
      const audioBuffer = await generateSpeech(text, languageCode, voiceName);

      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.length
      });
      res.send(audioBuffer);
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to synthesize speech"
      });
    }
  });

  app.get("/api/audio/voices/:languageCode", async (req, res) => {
    try {
      const { languageCode } = req.params;

      // Voice options for each language (male/female/neutral variations)
      const voiceOptions: Record<string, Array<{ name: string; label: string; gender: string }>> = {
        'en-US': [
          { name: 'en-US-Neural2-F', label: 'Female - Warm', gender: 'female' },
          { name: 'en-US-Neural2-C', label: 'Female - Clear', gender: 'female' },
          { name: 'en-US-Neural2-D', label: 'Male - Deep', gender: 'male' },
          { name: 'en-US-Neural2-A', label: 'Male - Friendly', gender: 'male' },
        ],
        'es-ES': [
          { name: 'es-ES-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'es-ES-Neural2-B', label: 'Male', gender: 'male' },
        ],
        'fr-FR': [
          { name: 'fr-FR-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'fr-FR-Neural2-B', label: 'Male', gender: 'male' },
        ],
        'de-DE': [
          { name: 'de-DE-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'de-DE-Neural2-B', label: 'Male', gender: 'male' },
        ],
        'it-IT': [
          { name: 'it-IT-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'it-IT-Neural2-C', label: 'Male', gender: 'male' },
        ],
        'pt-PT': [
          { name: 'pt-PT-Wavenet-A', label: 'Female', gender: 'female' },
          { name: 'pt-PT-Wavenet-B', label: 'Male', gender: 'male' },
        ],
        'pt-BR': [
          { name: 'pt-BR-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'pt-BR-Neural2-B', label: 'Male', gender: 'male' },
        ],
        'ja-JP': [
          { name: 'ja-JP-Neural2-B', label: 'Female', gender: 'female' },
          { name: 'ja-JP-Neural2-C', label: 'Male', gender: 'male' },
        ],
        'ko-KR': [
          { name: 'ko-KR-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'ko-KR-Neural2-C', label: 'Male', gender: 'male' },
        ],
        'ar-XA': [
          { name: 'ar-XA-Wavenet-A', label: 'Female', gender: 'female' },
          { name: 'ar-XA-Wavenet-B', label: 'Male', gender: 'male' },
          { name: 'ar-XA-Wavenet-C', label: 'Male - Deep', gender: 'male' },
        ],
        'ar-SA': [
          { name: 'ar-XA-Wavenet-A', label: 'Female', gender: 'female' },
          { name: 'ar-XA-Wavenet-B', label: 'Male', gender: 'male' },
          { name: 'ar-XA-Wavenet-C', label: 'Male - Deep', gender: 'male' },
        ],
        'zh-CN': [
          { name: 'cmn-CN-Wavenet-A', label: 'Female', gender: 'female' },
          { name: 'cmn-CN-Wavenet-B', label: 'Male', gender: 'male' },
        ],
        'hi-IN': [
          { name: 'hi-IN-Neural2-A', label: 'Female', gender: 'female' },
          { name: 'hi-IN-Neural2-B', label: 'Female - Warm', gender: 'female' },
          { name: 'hi-IN-Neural2-C', label: 'Male', gender: 'male' },
        ],
        'ru-RU': [
          { name: 'ru-RU-Wavenet-A', label: 'Female', gender: 'female' },
          { name: 'ru-RU-Wavenet-B', label: 'Male', gender: 'male' },
        ],
      };

      const voices = voiceOptions[languageCode] || [];

      // If no specific voices found, return default using the language code
      if (voices.length === 0) {
        const baseCode = languageCode.split('-')[0];
        return res.json({
          voices: [
            { name: `${languageCode}-Wavenet-A`, label: 'Default', gender: 'neutral' }
          ]
        });
      }

      res.json({ voices });
    } catch (error) {
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to get voices"
      });
    }
  });

  // Audio cache: store synthesized speech to avoid re-generating same translations
  const audioCache = new Map<string, string>();

  // WebSocket Server for Real-time Communication
  const wss = new WSServer({
    server: httpServer,
    path: '/ws'
  });

  interface SessionRoom {
    sessionId: string;
    clients: Set<WebSocket>;
  }

  const sessionRooms = new Map<string, SessionRoom>();

  // Streaming audio manager for real-time transcription
  const { StreamingAudioManager } = await import('./services/streaming-audio');
  const streamingManager = new StreamingAudioManager();

  // Helper function to broadcast to session
  function broadcastToSession(sessionId: string, message: any) {
    const room = sessionRooms.get(sessionId);
    if (room) {
      const messageStr = JSON.stringify(message);
      room.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(messageStr);
        }
      });
    }
  }

  // Handle complete sentences from streaming recognizer
  async function handleCompleteSentence(data: {
    text: string;
    language: string;
    confidence: number;
    participantId: string;
    speakerName: string;
    sessionId: string;
  }) {
    console.log(`[Stream] Complete sentence: "${data.text}" (${data.language}, confidence: ${data.confidence.toFixed(2)})`);

    try {
      const session = await storage.getSession(data.sessionId);
      if (!session) {
        return;
      }

      // Get all participants to determine which languages are actually needed
      const participants = await storage.getParticipantsBySession(data.sessionId);
      const { generateSpeech } = await import("./services/googlecloud");
      const { getLanguageCode } = await import("./services/translation");

      // Determine languages needed by current attendees (cost optimization)
      const allParticipantLanguages = new Set(participants.map(p => p.language));
      const voiceParticipants = participants.filter(p => p.preferredOutput === 'voice');
      const languagesNeedingAudio = new Set(voiceParticipants.map(p => p.language));

      console.log(`[Audio] Session ${data.sessionId} has ${participants.length} participants`);
      console.log(`[Audio] ${voiceParticipants.length} participants want voice output:`, voiceParticipants.map(p => `${p.name}(${p.language})`).join(', '));
      console.log(`[Translation] Cost optimization: translating to ${allParticipantLanguages.size} languages instead of ${session.languages.length} session languages`);

      const translations: Record<string, string> = {};

      // Only translate to languages that current attendees have chosen (cost optimization)
      const translationPromises = Array.from(allParticipantLanguages).map(async (targetLang) => {
        try {
          if (targetLang.toLowerCase() === data.language.toLowerCase()) {
            translations[targetLang] = data.text;
          } else {
            translations[targetLang] = await translateAudio(data.text, data.language, targetLang);
          }
        } catch (err) {
          console.error(`Translation error for ${targetLang}:`, err);
          translations[targetLang] = data.text;
        }
      });

      const translationErrors: string[] = [];
      await Promise.all(translationPromises.map(p =>
        p.catch(err => {
          translationErrors.push(err.message || 'Unknown error');
        })
      ));

      // Broadcast text translations
      broadcastToSession(data.sessionId, {
        type: 'translation',
        data: {
          sessionId: data.sessionId,
          participantId: data.participantId,
          speakerName: data.speakerName,
          originalText: data.text,
          originalLanguage: data.language,
          translations,
          timestamp: Date.now(),
          hasErrors: translationErrors.length > 0,
          errorCount: translationErrors.length
        }
      });

      // Synthesize speech only for languages that participants with voice output are listening to
      console.log(`[Audio] Generating audio for languages: ${Array.from(languagesNeedingAudio).join(', ')}`);

      const synthesisPromises = Array.from(languagesNeedingAudio).map(async (language) => {
        const translatedText = translations[language];
        if (translatedText && translatedText.trim()) {
          try {
            const languageCode = getLanguageCode(language);

            // Check audio cache first (text + language key)
            const cacheKey = `${translatedText}|${languageCode}`;
            let base64Audio = audioCache.get(cacheKey);

            if (!base64Audio) {
              // Cache miss - generate audio
              console.log(`[Audio] Cache MISS for: "${translatedText.substring(0, 50)}..." (${language})`);
              const audioBuffer = await generateSpeech(translatedText, languageCode);
              base64Audio = audioBuffer.toString('base64');

              // Store in cache (with size limit of 500 entries = ~500MB max)
              if (audioCache.size < 500) {
                audioCache.set(cacheKey, base64Audio);
              }
            } else {
              console.log(`[Audio] Cache HIT for: "${translatedText.substring(0, 50)}..." (${language})`);
            }

            // Get all participants for this language to determine if we should broadcast
            const participantsForLanguage = voiceParticipants.filter(p => p.language === language);
            console.log(`[Audio] Broadcasting audio for ${language} to ${participantsForLanguage.length} participants`);

            // Broadcast synthesized audio to all clients
            const audioMessage = {
              type: 'audio-synthesized',
              data: {
                language,
                audioContent: base64Audio,
                participantId: data.participantId,
                speakerName: data.speakerName,
                text: translatedText,
                timestamp: Date.now()
              }
            };

            console.log(`[Audio] 📢 Broadcasting audio-synthesized for ${language}: ${audioMessage.data.text.substring(0, 40)}...`);
            broadcastToSession(data.sessionId, audioMessage);
          } catch (synthError) {
            console.error(`[Audio] Speech synthesis error for ${language}:`, synthError);
          }
        }
      });

      // Wait for all synthesis to complete
      await Promise.all(synthesisPromises);

      // Store translations in database (only for languages that current attendees need)
      const storagePromises = Object.entries(translations).map(([targetLang, translatedText]) =>
        storage.createTranslation({
          sessionId: data.sessionId,
          participantId: data.participantId,
          originalText: data.text,
          originalLanguage: data.language,
          targetLanguage: targetLang,
          translatedText,
          confidence: Math.round(data.confidence * 100),
          timestamp: new Date()
        })
      );

      await Promise.all(storagePromises);
    } catch (error) {
      console.error(`[Stream] Error handling sentence:`, error);
    }
  }

  // WebSocket message validation helper
  async function validateWebSocketMessage(message: any, currentSessionId: string | null, participantId: string | null) {
    // Validate message structure
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid message format');
    }

    // Validate session exists and is active
    if (currentSessionId) {
      const session = await storage.getSession(currentSessionId);
      if (!session) {
        throw new Error('Session not found or expired');
      }
    }

    // For audio messages, validate participant exists and has permission
    if (message.type === 'audio-chunk' && currentSessionId && participantId) {
      const participant = await storage.getParticipant(participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }
      if (participant.sessionId !== currentSessionId) {
        throw new Error('Participant does not belong to this session');
      }
      if (!participant.isSpeaking) {
        throw new Error('Participant does not have speaking permission');
      }
    }

    return true;
  }

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WebSocket] 🔌 New client connected');
    let currentSessionId: string | null = null;
    let currentParticipantId: string | null = null;
    let currentSpeakerName: string | null = null;
    let audioChunkCount = 0;
    const audioChunkTimestamp: Record<string, number> = {};

    ws.on('message', async (data: Buffer) => {
      try {
        // Message size validation (max 10MB)
        if (data.length > 10 * 1024 * 1024) {
          console.error('[WebSocket] ❌ Message too large:', data.length);
          return;
        }

        // Try to parse as JSON (control messages)
        let message: any = null;
        let isJsonMessage = false;
        try {
          message = JSON.parse(data.toString());
          isJsonMessage = true;
        } catch (parseError) {
          // Not JSON - treat as binary audio data
          isJsonMessage = false;
        }

        if (isJsonMessage) {
          // Handle JSON control messages
          if (message.type !== 'audio-chunk-metadata') {
            console.log(`[WebSocket] 📨 Received message type: ${message.type}`);
          }

          switch (message.type) {
            case 'join-session':
              const sessionId = message.sessionId;
              if (!sessionId || typeof sessionId !== 'string') {
                console.error('[WebSocket] ❌ join-session missing or invalid sessionId');
                return;
              }

              // Validate session exists
              const session = await storage.getSession(sessionId);
              if (!session) {
                console.error('[WebSocket] ❌ Session not found or expired:', sessionId);
                return;
              }

              currentSessionId = sessionId;
              currentParticipantId = null;
              currentSpeakerName = null;
              audioChunkCount = 0;

              console.log(`[WebSocket] ✅ Client joined session: ${currentSessionId}`);

              if (!sessionRooms.has(currentSessionId)) {
                sessionRooms.set(currentSessionId, {
                  sessionId: currentSessionId,
                  clients: new Set()
                });
                console.log(`[WebSocket] 🆕 Created new session room: ${currentSessionId}`);
              }

              sessionRooms.get(currentSessionId)?.clients.add(ws);
              console.log(`[WebSocket] Room ${currentSessionId} now has ${sessionRooms.get(currentSessionId)?.clients.size} clients`);
              break;

            case 'audio_metadata':
              try {
                // Validate structure
                if (!message.participantId || !message.sampleRate) {
                  console.error('[WebSocket] ❌ audio_metadata missing required fields');
                  return;
                }

                const participantId = message.participantId;
                const targetLanguage = message.targetLanguage || 'en-US';
                const sampleRate = message.sampleRate;

                console.log(`[Audio] 📋 Metadata for ${participantId}: ${sampleRate}Hz, lang: ${targetLanguage}`);

                // Validate participant
                const participant = await storage.getParticipant(participantId);
                if (!participant) {
                  console.error('[WebSocket] ❌ Participant not found:', participantId);
                  return;
                }

                if (!currentSessionId || participant.sessionId !== currentSessionId) {
                  console.error('[WebSocket] ❌ Participant session mismatch');
                  return;
                }

                // Allow host even if isSpeaking=false; others must have permission
                if (!participant.isSpeaking && participant.role !== 'host') {
                  console.error('[WebSocket] ❌ Participant not speaking:', participantId);
                  return;
                }

                // Auto-mark host as speaking so subsequent checks pass
                if (participant.role === 'host' && !participant.isSpeaking) {
                  await storage.updateParticipant(participantId, { isSpeaking: true });
                }

                // Set context
                currentParticipantId = participantId;
                currentSpeakerName = participant.name;

                console.log(`[WebSocket] 🎙️ Audio metadata set for participant: ${currentSpeakerName} (${participantId})`);

                // Get or create stream with ACTUAL sample rate
                const stream = streamingManager.getOrCreateStream(
                  participantId,
                  currentSpeakerName,
                  currentSessionId
                );

                // Update stream sample rate (need to modify SpeakerStreamRecognizer)
                (stream as any).sampleRate = sampleRate;
                (stream as any).languageCode = targetLanguage;

                // Set up event listeners on first use
                if (stream.listenerCount('sentence') === 0) {
                  console.log(`[WebSocket] 🔗 Setting up listeners for ${currentSpeakerName}`);
                  stream.on('sentence', handleCompleteSentence);
                  stream.on('interim', (interimData: any) => {
                    broadcastToSession(currentSessionId!, {
                      type: 'interim-transcript',
                      data: interimData
                    });
                  });
                  stream.on('error', (error: Error) => {
                    console.error(`[Stream] ❌ Error for ${currentSpeakerName}:`, error);
                  });
                }

                // Restart stream with new config
                stream.stop();
                stream.start();

              } catch (error) {
                console.error('[Audio] ❌ Error processing audio_metadata:', error);
              }
              break;

            case 'audio-chunk-metadata':
              // New control message for binary audio protocol
              if (!currentSessionId) {
                console.error('[WebSocket] ❌ Audio metadata received without valid session');
                return;
              }

              try {
                // Validate message structure
                if (!message.data || typeof message.data.participantId !== 'string') {
                  console.error('[WebSocket] ❌ Invalid audio-chunk-metadata structure');
                  return;
                }

                const participantId = message.data.participantId;
                const speakerName = message.data.speakerName || 'Unknown Speaker';

                // Validate participant exists
                const participant = await storage.getParticipant(participantId);
                if (!participant) {
                  console.error('[WebSocket] ❌ Participant not found:', participantId);
                  return;
                }

                // Validate participant belongs to session
                if (participant.sessionId !== currentSessionId) {
                  console.error('[WebSocket] ❌ Participant does not belong to session:', participantId);
                  return;
                }

                // Validate participant has speaking permission (host bypass)
                if (!participant.isSpeaking && participant.role !== 'host') {
                  console.error('[WebSocket] ❌ Participant does not have speaking permission:', participantId);
                  return;
                }

                // Auto-mark host as speaking
                if (participant.role === 'host' && !participant.isSpeaking) {
                  await storage.updateParticipant(participantId, { isSpeaking: true });
                }

                // Set current participant context for upcoming binary audio frames
                currentParticipantId = participantId;
                currentSpeakerName = speakerName;

                console.log(`[WebSocket] 🎙️ Audio metadata set for participant: ${speakerName} (${participantId})`);

                // Get or create streaming recognizer for this participant
                const stream = streamingManager.getOrCreateStream(
                  participantId,
                  speakerName,
                  currentSessionId
                );

                // Set up event listeners on first use
                if (stream.listenerCount('sentence') === 0) {
                  console.log(`[WebSocket] 🔗 Setting up event listeners for ${speakerName}`);
                  stream.on('sentence', handleCompleteSentence);
                  stream.on('interim', (interimData: any) => {
                    // Broadcast interim transcripts for live feedback
                    broadcastToSession(currentSessionId!, {
                      type: 'interim-transcript',
                      data: interimData
                    });
                  });
                  stream.on('error', (error: Error) => {
                    console.error(`[Stream] ❌ Error for ${speakerName}:`, error);
                  });
                }
              } catch (error) {
                console.error('[Audio] ❌ Error processing metadata:', error);
              }
              break;

            case 'speaker-status':
              if (!currentSessionId || !message.data?.participantId) {
                console.error('[WebSocket] ❌ speaker-status missing session or participant info');
                return;
              }
              broadcastToSession(currentSessionId, message);
              break;

            case 'hand-raise':
              if (!currentSessionId || !message.data?.participantId) {
                console.error('[WebSocket] ❌ hand-raise missing session or participant info');
                return;
              }
              broadcastToSession(currentSessionId, message);
              break;

            case 'speak-permission':
              if (!currentSessionId || !message.data?.participantId) {
                console.error('[WebSocket] ❌ speak-permission missing session or participant info');
                return;
              }
              broadcastToSession(currentSessionId, message);
              break;

            default:
              console.log('[WebSocket] ⚠️ Unknown message type:', message.type);
          }
        } else {
          // Handle binary audio frames
          if (!currentSessionId || !currentParticipantId) {
            console.error('[WebSocket] ❌ Binary audio received without valid session or participant');
            return;
          }

          try {
            // Rate limiting: max 100 chunks per second per participant
            const now = Date.now();
            const lastChunkTime = audioChunkTimestamp[currentParticipantId] || 0;
            if (now - lastChunkTime < 10) {
              console.warn('[WebSocket] ⚠️ Audio chunk rate limit exceeded for:', currentParticipantId);
              return;
            }
            audioChunkTimestamp[currentParticipantId] = now;

            // Get the streaming recognizer for this participant
            const stream = streamingManager.getOrCreateStream(
              currentParticipantId,
              currentSpeakerName || 'Unknown Speaker',
              currentSessionId
            );

            // Write binary audio chunk directly to stream
            stream.writeAudioChunk(data);
            audioChunkCount++;

            // Log every 50 chunks
            if (audioChunkCount % 50 === 0) {
              console.log(`[WebSocket] 📊 ${currentSpeakerName}: ${audioChunkCount} binary chunks received`);
            }
          } catch (error) {
            console.error('[Audio] ❌ Error processing binary audio:', error);
          }
        }
      } catch (error) {
        console.error('[WebSocket] ❌ Message error:', error);
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] ❌ Client disconnected from session: ${currentSessionId || 'unknown'}`);

      // Clean up audio streams for this participant
      if (currentSessionId && currentParticipantId) {
        console.log(`[WebSocket] 🧹 Cleaning up streams for participant: ${currentParticipantId}`);
        streamingManager.stopStream(currentParticipantId, currentSessionId);
      }

      // Clean up room
      if (currentSessionId && sessionRooms.has(currentSessionId)) {
        sessionRooms.get(currentSessionId)?.clients.delete(ws);

        // Clean up empty rooms
        const room = sessionRooms.get(currentSessionId);
        if (room && room.clients.size === 0) {
          console.log(`[WebSocket] 🧹 Cleaning up empty room: ${currentSessionId}`);
          sessionRooms.delete(currentSessionId);
        } else if (room) {
          console.log(`[WebSocket] Room ${currentSessionId} now has ${room.clients.size} clients`);
        }
      }

      // Reset connection state
      currentSessionId = null;
      currentParticipantId = null;
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] ⚠️ WebSocket error:', error);
    });
  });

  return httpServer;
}