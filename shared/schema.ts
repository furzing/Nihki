import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  preferredLanguage: text("preferred_language").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  hostUserId: varchar("host_user_id").references(() => users.id, { onDelete: "cascade" }),
  hostName: text("host_name").notNull(),
  hostEmail: text("host_email").notNull(),
  languages: jsonb("languages").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(false),
  maxParticipants: integer("max_participants").notNull().default(50),
  plan: text("plan").notNull().default("basic"), // basic, professional, enterprise
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  expiresAt: timestamp("expires_at").notNull(),
});

export const participants = pgTable("participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  language: text("language").notNull(),
  role: text("role").notNull().default("participant"), // host, participant, guest
  preferredOutput: text("preferred_output").notNull().default("voice"),
  preferredVoice: text("preferred_voice"),
  joinedAt: timestamp("joined_at").notNull().default(sql`now()`),
  isActive: boolean("is_active").notNull().default(true),
  isSpeaking: boolean("is_speaking").notNull().default(false),
  handRaised: boolean("hand_raised").notNull().default(false),
});

export const speakers = pgTable("speakers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  isMuted: boolean("is_muted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const translations = pgTable("translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  participantId: varchar("participant_id").notNull().references(() => participants.id, { onDelete: "cascade" }),
  originalText: text("original_text").notNull(),
  originalLanguage: text("original_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  translatedText: text("translated_text").notNull(),
  confidence: integer("confidence").notNull().default(0),
  timestamp: timestamp("timestamp").notNull().default(sql`now()`),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const insertSessionSchema = createInsertSchema(sessions).pick({
  name: true,
  description: true,
  languages: true,
  maxParticipants: true,
  plan: true,
}).extend({
  expiresAt: z.union([z.date(), z.string()]).optional()
});

export const insertParticipantSchema = createInsertSchema(participants).pick({
  sessionId: true,
  userId: true,
  name: true,
  language: true,
  role: true,
  preferredOutput: true,
}).extend({
  isSpeaking: z.boolean().optional(),
});

export const insertSpeakerSchema = createInsertSchema(speakers).pick({
  sessionId: true,
  name: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginCredentials = z.infer<typeof loginSchema>;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Participant = typeof participants.$inferSelect;
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type Speaker = typeof speakers.$inferSelect;
export type InsertSpeaker = z.infer<typeof insertSpeakerSchema>;
export type Translation = typeof translations.$inferSelect;

// WebSocket message types
export interface WebSocketMessage {
  type: 'audio-chunk' | 'translation' | 'speaker-status' | 'participant-joined' | 'participant-left' | 'hand-raise' | 'speak-permission' | 'translation-word';
  data: any;
}

export interface AudioChunkMessage {
  type: 'audio-chunk';
  data: {
    sessionId: string;
    participantId: string;
    audioData: string; // base64 encoded audio
    timestamp: number;
  };
}

export interface TranslationMessage {
  type: 'translation';
  data: {
    sessionId: string;
    participantId: string;
    speakerName: string;
    originalText: string;
    originalLanguage: string;
    translations: Record<string, string>; // language -> translated text
    timestamp: number;
  };
}

export interface SpeakerStatusMessage {
  type: 'speaker-status';
  data: {
    sessionId: string;
    participantId: string;
    speakerName: string;
    isActive: boolean;
    isMuted: boolean;
  };
}

export interface HandRaiseMessage {
  type: 'hand-raise';
  data: {
    sessionId: string;
    participantId: string;
    participantName: string;
    handRaised: boolean;
  };
}

export interface SpeakPermissionMessage {
  type: 'speak-permission';
  data: {
    sessionId: string;
    participantId: string;
    isSpeaking: boolean;
  };
}

export interface TranslationWordMessage {
  type: 'translation-word';
  data: {
    sessionId: string;
    speakerId: string;
    speakerName: string;
    word: string;
    wordIndex: number;
    totalWords: number;
    language: string;
    originalLanguage: string;
    timestamp: number;
  };
}
