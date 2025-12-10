# Real-Time Translation Platform

## Overview

A real-time multilingual audio interpretation platform designed for live events, meetings, and conferences. The system captures audio from speakers, transcribes it using Google Cloud Speech-to-Text, translates it into multiple languages using Google Cloud Translation API, and delivers the translations to participants in real-time. The platform supports both caption-based and voice-based output for participants.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **React with TypeScript**: Built using React 18 with TypeScript for type safety and component-based architecture
- **shadcn/ui Component Library**: Utilizes a comprehensive design system with Radix UI primitives and Tailwind CSS for consistent styling
- **Routing**: Wouter for lightweight client-side routing with dedicated pages for admin dashboard, audience dashboard, and session joining
- **State Management**: TanStack Query for server state management and caching, with React hooks for local state
- **Real-time Communication**: WebSocket integration for live audio streaming and translation delivery

### Backend Architecture
- **Express.js Server**: RESTful API server handling session management, participant registration, and audio processing
- **WebSocket Server**: Real-time bidirectional communication for audio streaming and translation broadcasting
- **Modular Storage Layer**: Abstracted storage interface with in-memory implementation, designed for easy database integration
- **Audio Processing Pipeline**: Multer for file uploads, Google Cloud Speech-to-Text for transcription, and Google Cloud Translation API for translation

### Database Design
- **PostgreSQL with Drizzle ORM**: Type-safe database interactions with schema-first approach
- **Core Entities**:
  - Users: Authenticated accounts with email, hashed password, and preferred language
  - Sessions: Event containers with host information, language support, and participant limits
  - Participants: Session attendees with language preferences, isSpeaking status, and role (host/participant/guest)
  - Translations: Processed audio with original and translated text
- **Relational Structure**: Foreign key relationships ensuring data integrity and cascade deletions
- **Storage Layer**: DbStorage class implementing IStorage interface with PostgreSQL backend

### Authentication & Authorization
- **User Authentication**: Email and password-based signup/login system with bcrypt password hashing
- **HTTP-Only Session Cookies**: Secure server-side session management using express-session
- **Protected Routes**: React Router guards using AuthProvider context and TanStack Query
- **Role-based Permissions**: Host (session creator) and participant roles with different capabilities
- **Session Validation**: Server-side validation via /api/auth/me endpoint on page refresh
- **Guest Access**: Optional guest participation via QR codes without account creation

### Audio Processing
- **Browser Audio Capture**: Web Audio API integration for microphone access
- **Real-time Streaming**: WebSocket-based audio chunk transmission with 3-second buffering
- **AI-Powered Pipeline**: Google Cloud Speech-to-Text for speech-to-text and Google Cloud Translation API for multilingual translation
- **Audio Buffering**: Server-side buffering system that accumulates audio chunks for 3 seconds before processing (max 10 seconds) to ensure complete sentences are captured
- **Confidence Scoring**: Quality metrics for transcription and translation accuracy

### UI/UX Design
- **Responsive Design**: Mobile-first approach with Tailwind CSS responsive utilities
- **Accessibility**: Radix UI primitives ensuring WCAG compliance
- **Real-time Feedback**: Audio visualizers, connection status indicators, and live translation displays
- **Multi-language Support**: Dynamic language selection and real-time switching

## External Dependencies

### Cloud Services
- **Google Cloud Platform**: Speech-to-Text API for audio transcription (125+ languages), Translation API for text translation (~100ms latency, 189 languages), and Text-to-Speech API for voice synthesis (380+ voices, 75+ languages)
- **PostgreSQL Database**: Production database for persistent data storage
- **WebSocket Infrastructure**: Real-time communication between clients and server

### Development Tools
- **Vite**: Fast development server and build tool with HMR support
- **TypeScript**: Type safety across frontend, backend, and shared schemas
- **Drizzle Kit**: Database migration and schema management
- **ESBuild**: Fast bundling for production server builds

### Frontend Libraries
- **TanStack Query**: Server state management with caching and optimistic updates
- **React Hook Form**: Form state management with Zod validation
- **Radix UI**: Headless UI components for accessibility and customization
- **Tailwind CSS**: Utility-first CSS framework for rapid styling

### Backend Libraries
- **Express.js**: Web application framework for REST API endpoints
- **WebSocket (ws)**: Real-time bidirectional communication
- **Multer**: File upload middleware for audio processing
- **Drizzle ORM**: Type-safe database operations with PostgreSQL

### Audio Processing
- **Web Audio API**: Browser-native audio capture and processing
- **MediaRecorder API**: Audio recording and encoding in the browser
- **Google Cloud SDKs**: Integration with Speech-to-Text, Translation API, and Text-to-Speech for AI processing