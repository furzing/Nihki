import { 
  type User,
  type InsertUser,
  type Session, 
  type InsertSession, 
  type Participant, 
  type InsertParticipant,
  type Speaker,
  type InsertSpeaker,
  type Translation
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // User authentication
  createUser(user: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  validatePassword(email: string, password: string): Promise<User | null>;
  
  // Session management
  getSession(id: string): Promise<Session | undefined>;
  createSession(session: InsertSession & { 
    expiresAt: Date, 
    hostUserId: string,
    hostName: string, 
    hostEmail: string 
  }): Promise<Session>;
  updateSession(id: string, updates: Partial<Session>): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;

  // Participant management
  getParticipant(id: string): Promise<Participant | undefined>;
  createParticipant(participant: InsertParticipant): Promise<Participant>;
  getParticipantsBySession(sessionId: string): Promise<Participant[]>;
  updateParticipant(id: string, updates: Partial<Participant>): Promise<Participant | undefined>;
  deleteParticipant(id: string): Promise<void>;
  deleteParticipantWithTranslations(id: string): Promise<void>;

  // Speaker management
  getSpeaker(id: string): Promise<Speaker | undefined>;
  createSpeaker(speaker: InsertSpeaker): Promise<Speaker>;
  getSpeakersBySession(sessionId: string): Promise<Speaker[]>;
  updateSpeaker(id: string, updates: Partial<Speaker>): Promise<Speaker | undefined>;
  deleteSpeaker(id: string): Promise<void>;
  deleteSpeakerWithTranslations(id: string): Promise<void>;

  // Translation management
  createTranslation(translation: Omit<Translation, 'id'>): Promise<Translation>;
  getTranslationsBySession(sessionId: string): Promise<Translation[]>;
  getTranslationsBySpeaker(participantId: string): Promise<Translation[]>;
}

export class MemStorage implements IStorage {
  private sessions: Map<string, Session>;
  private participants: Map<string, Participant>;
  private speakers: Map<string, Speaker>;
  private translations: Map<string, Translation>;

  constructor() {
    this.sessions = new Map();
    this.participants = new Map();
    this.speakers = new Map();
    this.translations = new Map();
  }

  // Session management
  async getSession(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    
    // Check if session has expired
    if (session && new Date() > new Date(session.expiresAt)) {
      this.sessions.delete(id);
      return undefined;
    }
    
    return session;
  }

  async createSession(sessionData: InsertSession & { expiresAt: Date }): Promise<Session> {
    const id = randomUUID();
    const session: Session = {
      ...sessionData,
      id,
      description: sessionData.description || null,
      languages: (sessionData.languages || []) as string[],
      maxParticipants: sessionData.maxParticipants || 50,
      plan: sessionData.plan || "basic",
      isActive: false,
      createdAt: new Date(),
      expiresAt: sessionData.expiresAt
    };
    
    this.sessions.set(id, session);
    return session;
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;

    const updatedSession = { ...session, ...updates };
    this.sessions.set(id, updatedSession);
    return updatedSession;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    
    // Clean up related data
    Array.from(this.participants.values())
      .filter(p => p.sessionId === id)
      .forEach(p => this.participants.delete(p.id));
      
    Array.from(this.speakers.values())
      .filter(s => s.sessionId === id)
      .forEach(s => this.speakers.delete(s.id));
      
    Array.from(this.translations.values())
      .filter(t => t.sessionId === id)
      .forEach(t => this.translations.delete(t.id));
  }

  // Participant management
  async getParticipant(id: string): Promise<Participant | undefined> {
    return this.participants.get(id);
  }

  async createParticipant(participantData: InsertParticipant): Promise<Participant> {
    const id = randomUUID();
    const participant: Participant = {
      ...participantData,
      id,
      preferredOutput: participantData.preferredOutput || "voice",
      joinedAt: new Date(),
      isActive: true,
      handRaised: false,
      isSpeaking: participantData.isSpeaking ?? false,
      preferredVoice: null,
      userId: participantData.userId || null
    };
    
    this.participants.set(id, participant);
    return participant;
  }

  async getParticipantsBySession(sessionId: string): Promise<Participant[]> {
    return Array.from(this.participants.values())
      .filter(p => p.sessionId === sessionId && p.isActive);
  }

  async updateParticipant(id: string, updates: Partial<Participant>): Promise<Participant | undefined> {
    const participant = this.participants.get(id);
    if (!participant) return undefined;

    const updatedParticipant = { ...participant, ...updates };
    this.participants.set(id, updatedParticipant);
    return updatedParticipant;
  }

  async deleteParticipant(id: string): Promise<void> {
    this.participants.delete(id);
  }

  async deleteParticipantWithTranslations(id: string): Promise<void> {
    this.participants.delete(id);
    // Clean up related translations
    Array.from(this.translations.values())
      .filter(t => t.participantId === id)
      .forEach(t => this.translations.delete(t.id));
  }

  // Speaker management
  async getSpeaker(id: string): Promise<Speaker | undefined> {
    return this.speakers.get(id);
  }

  async createSpeaker(speakerData: InsertSpeaker): Promise<Speaker> {
    const id = randomUUID();
    const speaker: Speaker = {
      ...speakerData,
      id,
      isActive: false,
      isMuted: false,
      createdAt: new Date()
    };
    
    this.speakers.set(id, speaker);
    return speaker;
  }

  async getSpeakersBySession(sessionId: string): Promise<Speaker[]> {
    return Array.from(this.speakers.values())
      .filter(s => s.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async updateSpeaker(id: string, updates: Partial<Speaker>): Promise<Speaker | undefined> {
    const speaker = this.speakers.get(id);
    if (!speaker) return undefined;

    const updatedSpeaker = { ...speaker, ...updates };
    this.speakers.set(id, updatedSpeaker);
    return updatedSpeaker;
  }

  async deleteSpeaker(id: string): Promise<void> {
    this.speakers.delete(id);
  }

  async deleteSpeakerWithTranslations(id: string): Promise<void> {
    this.speakers.delete(id);
  }

  // Translation management
  async createTranslation(translationData: Omit<Translation, 'id'>): Promise<Translation> {
    const id = randomUUID();
    const translation: Translation = {
      ...translationData,
      id,
      timestamp: new Date()
    };
    
    this.translations.set(id, translation);
    return translation;
  }

  async getTranslationsBySession(sessionId: string): Promise<Translation[]> {
    return Array.from(this.translations.values())
      .filter(t => t.sessionId === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  async getTranslationsBySpeaker(speakerId: string): Promise<Translation[]> {
    return Array.from(this.translations.values())
      .filter(t => t.speakerId === speakerId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
}

export const storage = new MemStorage();
