import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import bcrypt from "bcrypt";
import {
  type User,
  type InsertUser,
  type LoginCredentials,
  type Session,
  type InsertSession,
  type Participant,
  type InsertParticipant,
  type Speaker,
  type InsertSpeaker,
  type Translation,
  users,
  sessions,
  participants,
  speakers,
  translations
} from "@shared/schema";
import type { IStorage } from "./storage";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

// Helper function to execute transactions
async function withTransaction<T>(
  callback: (tx: any) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    return callback(tx);
  });
}

export class DbStorage implements IStorage {
  // User authentication methods
  async createUser(userData: InsertUser): Promise<User> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    const [user] = await db.insert(users).values({
      ...userData,
      password: hashedPassword,
    }).returning();

    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async validatePassword(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    console.log(`[Auth] Lookup email '${email}': ${user ? 'Found' : 'Not Found'}`);

    if (!user) return null;

    const isValid = await bcrypt.compare(password, user.password);
    console.log(`[Auth] Password valid: ${isValid}`);

    return isValid ? user : null;
  }

  // Session management
  async getSession(id: string): Promise<Session | undefined> {
    const [session] = await db.select().from(sessions).where(eq(sessions.id, id));

    // Check if session has expired
    if (session && new Date() > new Date(session.expiresAt)) {
      await this.deleteSession(id);
      return undefined;
    }

    return session;
  }

  async createSession(sessionData: InsertSession & { expiresAt: Date, hostUserId: string, hostName: string, hostEmail: string }): Promise<Session> {
    const [session] = await db.insert(sessions).values({
      ...sessionData,
      description: sessionData.description || null,
      languages: (sessionData.languages || []) as string[],
      maxParticipants: sessionData.maxParticipants || 50,
      plan: sessionData.plan || "professional",
      isActive: false,
    }).returning();

    return session;
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<Session | undefined> {
    const [session] = await db.update(sessions)
      .set(updates)
      .where(eq(sessions.id, id))
      .returning();

    return session;
  }

  async deleteSession(id: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, id));
  }

  // Atomic transaction: create session with host participant
  async createSessionWithHostParticipant(
    sessionData: InsertSession & { expiresAt: Date; hostUserId: string; hostName: string; hostEmail: string },
    hostParticipantData: Omit<InsertParticipant, 'sessionId'>
  ): Promise<Session> {
    return withTransaction(async (tx) => {
      // Create session
      const [session] = await tx.insert(sessions).values({
        ...sessionData,
        description: sessionData.description || null,
        languages: (sessionData.languages || []) as string[],
        maxParticipants: sessionData.maxParticipants || 50,
        plan: sessionData.plan || "professional",
        isActive: false,
      }).returning();

      // Create host participant in the same transaction
      await tx.insert(participants).values({
        ...hostParticipantData,
        sessionId: session.id,
        userId: sessionData.hostUserId,
        preferredVoice: null,
        isActive: true,
        isSpeaking: true,
        handRaised: false,
      });

      return session;
    });
  }

  // Atomic transaction: delete session and all its participants
  async deleteSessionWithParticipants(id: string): Promise<void> {
    return withTransaction(async (tx) => {
      // Delete all participants in this session
      await tx.delete(participants).where(eq(participants.sessionId, id));

      // Delete all translations in this session
      await tx.delete(translations).where(eq(translations.sessionId, id));

      // Delete the session
      await tx.delete(sessions).where(eq(sessions.id, id));
    });
  }

  // Participant management
  async getParticipant(id: string): Promise<Participant | undefined> {
    const [participant] = await db.select().from(participants).where(eq(participants.id, id));
    return participant;
  }

  async createParticipant(participantData: InsertParticipant): Promise<Participant> {
    const [participant] = await db.insert(participants).values({
      ...participantData,
      userId: participantData.userId || null,
      preferredVoice: null,
      isActive: true,
      isSpeaking: participantData.isSpeaking ?? false,
      handRaised: false,
    }).returning();

    return participant;
  }

  async getParticipantsBySession(sessionId: string): Promise<Participant[]> {
    return await db.select().from(participants).where(eq(participants.sessionId, sessionId));
  }

  async updateParticipant(id: string, updates: Partial<Participant>): Promise<Participant | undefined> {
    const [participant] = await db.update(participants)
      .set(updates)
      .where(eq(participants.id, id))
      .returning();

    return participant;
  }

  async deleteParticipant(id: string): Promise<void> {
    await db.delete(participants).where(eq(participants.id, id));
  }

  // Atomic transaction: delete participant and all their translations
  async deleteParticipantWithTranslations(id: string): Promise<void> {
    return withTransaction(async (tx) => {
      // Delete all translations for this participant
      await tx.delete(translations).where(eq(translations.participantId, id));

      // Delete the participant
      await tx.delete(participants).where(eq(participants.id, id));
    });
  }

  // Speaker management (legacy - kept for compatibility)
  async getSpeaker(id: string): Promise<Speaker | undefined> {
    const [speaker] = await db.select().from(speakers).where(eq(speakers.id, id));
    return speaker;
  }

  async createSpeaker(speakerData: InsertSpeaker): Promise<Speaker> {
    const [speaker] = await db.insert(speakers).values({
      ...speakerData,
      isActive: false,
      isMuted: false,
    }).returning();

    return speaker;
  }

  async getSpeakersBySession(sessionId: string): Promise<Speaker[]> {
    return await db.select().from(speakers).where(eq(speakers.sessionId, sessionId));
  }

  async updateSpeaker(id: string, updates: Partial<Speaker>): Promise<Speaker | undefined> {
    const [speaker] = await db.update(speakers)
      .set(updates)
      .where(eq(speakers.id, id))
      .returning();

    return speaker;
  }

  async deleteSpeaker(id: string): Promise<void> {
    await db.delete(speakers).where(eq(speakers.id, id));
  }

  // Atomic transaction: delete speaker and all related data
  async deleteSpeakerWithTranslations(id: string): Promise<void> {
    return withTransaction(async (tx) => {
      // Delete the speaker
      await tx.delete(speakers).where(eq(speakers.id, id));
    });
  }

  // Translation management
  async createTranslation(translationData: Omit<Translation, 'id'>): Promise<Translation> {
    const [translation] = await db.insert(translations).values(translationData).returning();
    return translation;
  }

  async getTranslationsBySession(sessionId: string): Promise<Translation[]> {
    return await db.select().from(translations).where(eq(translations.sessionId, sessionId));
  }

  async getTranslationsBySpeaker(participantId: string): Promise<Translation[]> {
    return await db.select().from(translations).where(eq(translations.participantId, participantId));
  }
}
