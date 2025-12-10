import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { type Session, type Participant } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWebSocket } from "@/lib/websocket";
import { Volume2, VolumeX, Hand, LogOut, Mic, MicOff, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAudioCapture } from "@/lib/audio";
import { SmoothTranslationDisplay } from "@/components/smooth-translation-display";
import { AudioQueue } from "@/lib/audio-queue";

interface Translation {
  id: string;
  participantId: string;
  speakerName: string;
  originalText: string;
  translatedText: string;
  timestamp: number;
}

export default function AudienceDashboard() {
  const { sessionId, participantId } = useParams();
  const [, navigate] = useLocation();
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [activeSpeakers, setActiveSpeakers] = useState<Record<string, boolean>>({});
  const [handRaised, setHandRaised] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioQueueRef = useRef<AudioQueue>(new AudioQueue(0.8));

  const { data: session, isLoading } = useQuery<Session>({
    queryKey: ['/api/sessions', sessionId],
    enabled: !!sessionId
  });

  const { data: participant } = useQuery<Participant>({
    queryKey: ['/api/participants', participantId],
    enabled: !!participantId
  });

  const { data: allParticipants = [] } = useQuery<Participant[]>({
    queryKey: ['/api/sessions', sessionId, 'participants'],
    enabled: !!sessionId
  });

  const { lastMessage, isConnected, sendMessage, sendBinaryMessage } = useWebSocket(sessionId || '');

  // Wrap audio callbacks in useCallback with proper dependencies
  const handleAudioData = useCallback((audioData: Uint8Array) => {
    if (isRecording && participantId && sendBinaryMessage) {
      // First send a control message with metadata
      sendMessage({
        type: 'audio-chunk-metadata',
        data: {
          participantId: participantId,
          speakerName: participant?.name,
          isParticipant: true
        }
      });
      // Then send binary audio
      sendBinaryMessage(audioData);
    }
  }, [sendMessage, sendBinaryMessage, participantId, isRecording, participant?.name]);

  const handleAudioError = useCallback((error: Error) => {
    console.error('Audio capture error:', error);
    setIsRecording(false);
  }, []);

  const { startRecording, stopRecording, isSupported } = useAudioCapture({
    sampleRate: 16000,
    channels: 1,
    onAudioData: handleAudioData,
    onError: handleAudioError
  });

  useEffect(() => {
    if (participant) {
      setHandRaised(participant.handRaised);
    }
  }, [participant?.handRaised]);

  useEffect(() => {
    if (!participant?.isSpeaking && isRecording) {
      stopRecording();
      setIsRecording(false);
    }
  }, [participant?.isSpeaking, isRecording, stopRecording]);

  const handleMicToggle = () => {
    if (isRecording) {
      stopRecording();
      setIsRecording(false);
      sendMessage({
        type: 'speaker-status',
        data: {
          sessionId: sessionId,
          participantId: participantId,
          isActive: false,
          isMuted: false
        }
      });
    } else {
      if (isSupported && participant?.isSpeaking) {
        startRecording();
        setIsRecording(true);
        sendMessage({
          type: 'speaker-status',
          data: {
            sessionId: sessionId,
            participantId: participantId,
            isActive: true,
            isMuted: false
          }
        });
      }
    }
  };

  // Queue audio for sequential playback - MUST be declared before useEffect that uses it
  const queueAudio = useCallback((audioUrl: string, id: string) => {
    console.log(`[AudioQueue] Queuing audio, queue length: ${audioQueueRef.current.getQueueLength()}`);
    // Always queue audio regardless of mute state - mute only controls volume
    console.log(`[AudioQueue] Adding to queue: ${id}, URL: ${audioUrl}`);
    audioQueueRef.current.addToQueue(audioUrl, id);
    console.log(`[AudioQueue] Queue length after add: ${audioQueueRef.current.getQueueLength()}`);
  }, []);

  // Update audio queue volume when mute state changes
  useEffect(() => {
    // Mute only controls volume, not playback - set volume to 0 when muted, 0.8 when unmuted
    audioQueueRef.current.setVolume(isMuted ? 0 : 0.8);
  }, [isMuted]);

  // Audio context is initialized automatically on any user interaction
  // (scroll, tap, click, keyboard) thanks to the AudioQueue class

  const raiseHandMutation = useMutation({
    mutationFn: async (raised: boolean) => {
      if (!participantId) return;
      return apiRequest('PATCH', `/api/participants/${participantId}/raise-hand`, { handRaised: raised });
    },
    onSuccess: (_, raised) => {
      setHandRaised(raised);
      sendMessage({
        type: 'hand-raise',
        data: {
          sessionId: sessionId,
          participantId: participantId,
          participantName: participant?.name,
          handRaised: raised
        }
      });
    }
  });

  useEffect(() => {
    if (!lastMessage) return;

    const processMessage = async () => {
      try {
        const message = JSON.parse(lastMessage.data);

        switch (message.type) {
          case 'translation':
            const translation: Translation = {
              id: `${message.data.participantId}-${message.data.timestamp}`,
              participantId: message.data.participantId,
              speakerName: message.data.speakerName,
              originalText: message.data.originalText,
              translatedText: message.data.translations[participant?.language || ''] || message.data.originalText,
              timestamp: message.data.timestamp,
            };
            setTranslations(prev => [...prev.slice(-9), translation]);
            break;

          case 'speaker-status':
            setActiveSpeakers(prev => ({
              ...prev,
              [message.data.participantId]: message.data.isActive && !message.data.isMuted
            }));
            queryClient.invalidateQueries({ queryKey: ['/api/sessions', sessionId, 'participants'] });
            break;

          case 'audio-synthesized':
            console.log('[Audio] Received audio-synthesized for language:', message.data.language);
            
            // Only queue audio if:
            // 1. Participant wants voice output AND
            // 2. Audio is in their preferred language
            if (participant?.preferredOutput === 'voice' && message.data.language === participant?.language) {
              const audioContent = message.data.audioContent;
              console.log('[Audio] ✅ Queuing synthesized audio for', participant.language);
              
              if (typeof window !== 'undefined' && window.atob) {
                try {
                  // Force initialize audio context on mobile (MUST be awaited before playback)
                  const initialized = await audioQueueRef.current.forceInitializeAudioContext();
                  if (!initialized) {
                    console.warn('[Audio] Audio context initialization failed, attempting playback anyway');
                  } else {
                    console.log('[Audio] Audio context initialized successfully');
                  }

                  // Convert base64 to blob
                  const binaryString = window.atob(audioContent);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  
                  const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
                  const audioUrl = URL.createObjectURL(audioBlob);
                  
                  console.log('[Audio] Created audio URL, queuing:', audioUrl);
                  queueAudio(audioUrl, `audio-${message.data.participantId}-${message.data.timestamp}`);
                } catch (err) {
                  console.error('[Audio] Error processing audio content:', err);
                }
              } else {
                console.error('[Audio] atob not available');
              }
            } else {
              console.log('[Audio] ❌ Skipping audio - participant language:', participant?.language, 'message language:', message.data.language, 'preferredOutput:', participant?.preferredOutput);
            }
            break;

          case 'translation-word':
            if (message.data.audioUrl) {
              queueAudio(message.data.audioUrl, `word-${message.data.id}`);
            }
            break;

          case 'participant-joined':
          case 'participant-left':
          case 'hand-raise':
          case 'speak-permission':
            queryClient.invalidateQueries({ queryKey: ['/api/sessions', sessionId, 'participants'] });
            if (message.data.participantId === participantId) {
              queryClient.invalidateQueries({ queryKey: ['/api/participants', participantId] });
            }
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    processMessage();
  }, [lastMessage, participant?.language, participant?.preferredOutput, participantId, queueAudio]);

  const handleLeave = () => {
    if (isRecording) {
      stopRecording();
    }
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Joining session...</p>
        </div>
      </div>
    );
  }

  if (!session || !participant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <h1 className="text-2xl font-bold mb-4">Session Not Found</h1>
            <p className="text-muted-foreground mb-4">
              Unable to access this interpretation session.
            </p>
            <Button onClick={() => navigate('/')} data-testid="button-back-home">
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeSpeaker = Object.keys(activeSpeakers).find(id => activeSpeakers[id]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Mobile-First Header */}
      <header className="border-b border-border p-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg md:text-xl font-semibold truncate">{session.name}</h1>
            <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground mt-0.5">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-muted-foreground'}`}></div>
              <span data-testid="text-connection-status">{isConnected ? 'Live' : 'Disconnected'}</span>
              <span>•</span>
              <Badge variant="outline" className="text-xs" data-testid="badge-participant-language">
                {participant.language}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLeave}
            data-testid="button-leave-session"
            className="shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Content - Interpretation Display */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Attendees Section */}
            <div className="space-y-3">
              <h2 className="text-lg font-medium text-black dark:text-white">Attendees</h2>
              
              {allParticipants.length === 0 ? (
                <Card className="bg-white dark:bg-black border-gray-300 dark:border-gray-700">
                  <CardContent className="p-6 text-center">
                    <Users className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600 dark:text-gray-400 text-sm">No participants yet</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-0 border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-black">
                  {allParticipants.map((p, index) => {
                    const isHost = p.role === 'host';
                    const isActivelySpeaking = activeSpeakers[p.id];
                    const roleLabel = isHost && p.isSpeaking ? '(Host & Speaker)' 
                      : isHost ? '(Host)' 
                      : p.isSpeaking ? '(Speaker)' 
                      : '';
                    
                    return (
                      <div 
                        key={p.id} 
                        className={`p-4 flex items-center justify-between ${
                          index !== allParticipants.length - 1 ? 'border-b border-gray-300 dark:border-gray-700' : ''
                        }`}
                        data-testid={`attendee-${p.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-black dark:text-white truncate font-['Poppins']">
                            {p.name} {roleLabel && <span className="text-gray-600 dark:text-gray-400 font-normal">{roleLabel}</span>}
                          </p>
                        </div>
                        
                        <div className="flex items-center gap-3 ml-3">
                          {/* Speaking Indicator */}
                          {isActivelySpeaking && (
                            <div className="flex items-center gap-2">
                              <Mic className="w-5 h-5 text-green-500 animate-pulse" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Floating Action Buttons - Horizontal Layout */}
        <div className="fixed bottom-4 left-4 right-4 flex items-center justify-center gap-3">
          {/* Mute/Unmute Audio */}
          <Button
            variant={isMuted ? "secondary" : "outline"}
            size="lg"
            onClick={() => setIsMuted(!isMuted)}
            data-testid="button-toggle-mute"
            className="h-14 w-14 rounded-full shadow-lg"
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </Button>

          {/* Raise Hand */}
          <Button
            variant={handRaised ? "default" : "outline"}
            size="lg"
            onClick={() => raiseHandMutation.mutate(!handRaised)}
            disabled={raiseHandMutation.isPending}
            data-testid="button-raise-hand"
            className="h-14 px-6 rounded-full shadow-lg"
          >
            <Hand className={`w-5 h-5 mr-2 ${handRaised ? 'animate-pulse' : ''}`} />
            {handRaised ? 'Hand Raised' : 'Raise Hand'}
          </Button>

          {/* Microphone (if permitted) */}
          {participant.isSpeaking && (
            <Button
              variant={isRecording ? "secondary" : "outline"}
              size="lg"
              onClick={handleMicToggle}
              disabled={!isSupported}
              data-testid="button-toggle-mic"
              className="h-14 w-14 rounded-full shadow-lg"
            >
              {isRecording ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
