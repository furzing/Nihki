import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { type Session, type Participant } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { QRCodeGenerator } from "@/components/qr-code";
import { useWebSocket } from "@/lib/websocket";
import { useAuth } from "@/lib/auth-context";
import { useAudioCapture } from "@/lib/audio";
import { AudioQueue } from "@/lib/audio-queue";
import { Input } from "@/components/ui/input";
import { 
  Mic,
  Hand,
  Check,
  X,
  QrCode,
  Copy,
  CheckCircle,
  Users,
  FileDown,
  MicOff,
  Power
} from "lucide-react";

export default function AdminDashboard() {
  const params = useParams();
  const sessionId = params.sessionId;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const audioQueueRef = useRef<AudioQueue>(new AudioQueue(0.8));
  const metadataSentRef = useRef(false);

  // Find the host participant (current user)
  const { data: session, isLoading } = useQuery<Session>({
    queryKey: ['/api/sessions', sessionId],
    enabled: !!sessionId
  });

  const { data: participants = [] } = useQuery<Participant[]>({
    queryKey: ['/api/sessions', sessionId, 'participants'],
    enabled: !!sessionId
  });

  const hostParticipant = participants.find(p => p.userId === user?.id);

  const { sendMessage, sendBinaryMessage, lastMessage, isConnected } = useWebSocket(sessionId || '');

  // Queue audio for sequential playback
  const queueAudio = useCallback((audioUrl: string, id: string) => {
    console.log(`[AudioQueue] Queuing audio, queue length: ${audioQueueRef.current.getQueueLength()}`);
    audioQueueRef.current.addToQueue(audioUrl, id);
    console.log(`[AudioQueue] Queue length after add: ${audioQueueRef.current.getQueueLength()}`);
  }, []);

  // Wrap audio callbacks in useCallback with proper dependencies
  const handleAudioData = useCallback((audioData: Uint8Array) => {
    if (!isRecording || !hostParticipant || !sendBinaryMessage) return;

    if (!metadataSentRef.current && actualSampleRate) {
      console.log(`[Audio] Host sending metadata before first chunk: ${actualSampleRate}Hz, lang: ${hostParticipant.language}`);
      sendMessage({
        type: 'audio_metadata',
        participantId: hostParticipant.id,
        targetLanguage: hostParticipant.language || 'en-US',
        sampleRate: actualSampleRate
      });
      metadataSentRef.current = true;
    }

    // First send a control message with metadata
    sendMessage({
      type: 'audio-chunk-metadata',
      data: {
        participantId: hostParticipant.id,
        speakerName: hostParticipant.name,
        isParticipant: true
      }
    });
    // Then send binary audio
    sendBinaryMessage(audioData);
  }, [sendMessage, sendBinaryMessage, hostParticipant, isRecording, actualSampleRate]);

  const handleAudioError = useCallback((error: Error) => {
    console.error('Audio capture error:', error);
    setIsRecording(false);
  }, []);

  const { startRecording, stopRecording, isSupported, actualSampleRate } = useAudioCapture({
    sampleRate: 16000,
    channels: 1,
    onAudioData: handleAudioData,
    onError: handleAudioError
  });

  // Send metadata ONCE when host recording starts and sample rate known
  useEffect(() => {
    if (isRecording && actualSampleRate && hostParticipant && !metadataSentRef.current) {
      console.log(`[Audio] Host sending metadata ONCE: ${actualSampleRate}Hz, lang: ${hostParticipant.language}`);
      sendMessage({
        type: 'audio_metadata',
        participantId: hostParticipant.id,
        targetLanguage: hostParticipant.language || 'en-US',
        sampleRate: actualSampleRate
      });
      metadataSentRef.current = true;
    }
    if (!isRecording) {
      metadataSentRef.current = false;
    }
  }, [isRecording, actualSampleRate, hostParticipant, sendMessage]);

  const handleHostMicToggle = async () => {
    if (!hostParticipant) return;
    
    if (isRecording) {
      stopRecording();
      setIsRecording(false);
      metadataSentRef.current = false;
      try {
        await apiRequest('PATCH', `/api/participants/${hostParticipant.id}/speaking`, { isSpeaking: false });
      } catch (err) {
        console.error('Failed to update host speaking flag (off):', err);
      }
      sendMessage({
        type: 'speaker-status',
        data: {
          sessionId: sessionId,
          participantId: hostParticipant.id,
          isActive: false,
          isMuted: false
        }
      });
    } else {
      if (isSupported) {
        await startRecording();
        setIsRecording(true);
        try {
          await apiRequest('PATCH', `/api/participants/${hostParticipant.id}/speaking`, { isSpeaking: true });
        } catch (err) {
          console.error('Failed to update host speaking flag (on):', err);
        }
        sendMessage({
          type: 'speaker-status',
          data: {
            sessionId: sessionId,
            participantId: hostParticipant.id,
            isActive: true,
            isMuted: false
          }
        });
      }
    }
  };

  const speakPermissionMutation = useMutation({
    mutationFn: async ({ participantId, granted }: { participantId: string, granted: boolean }) => {
      return apiRequest('PATCH', `/api/participants/${participantId}/speaking`, { isSpeaking: granted });
    },
    onSuccess: (_, { participantId, granted }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions', sessionId, 'participants'] });
      sendMessage({
        type: 'speak-permission',
        data: {
          sessionId: sessionId,
          participantId: participantId,
          isSpeaking: granted
        }
      });
      toast({
        title: granted ? "Permission Granted" : "Permission Denied",
        description: granted ? "Participant can now speak." : "Participant speaking permission removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const endSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('DELETE', `/api/sessions/${sessionId}`);
    },
    onSuccess: () => {
      toast({
        title: "Session Ended",
        description: "You have ended the session.",
      });
      navigate('/dashboard');
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  useEffect(() => {
    if (!lastMessage) return;

    try {
      const message = JSON.parse(lastMessage.data);

      switch (message.type) {
        case 'audio-synthesized':
          console.log('[Audio] Host received audio-synthesized from:', message.data.participantId, 'Language:', message.data.language, 'Host language:', hostParticipant?.language);
          
          // Host only listens to OTHER speakers' interpretations in their preferred language
          if (message.data.audioContent && hostParticipant && message.data.participantId !== hostParticipant.id && message.data.language === hostParticipant.language) {
            try {
              audioQueueRef.current.forceInitializeAudioContext().then(() => {
                console.log('[Audio] Audio context initialized');
              }).catch((err) => {
                console.error('[Audio] Failed to initialize audio context:', err);
              });

              // Convert base64 to blob
              const binaryString = window.atob(message.data.audioContent);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              
              const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
              const audioUrl = URL.createObjectURL(audioBlob);
              
              console.log('[Audio] Host queuing audio from speaker in', message.data.language);
              queueAudio(audioUrl, `audio-${message.data.participantId}-${message.data.timestamp}`);
            } catch (err) {
              console.error('[Audio] Error processing audio content:', err);
            }
          }
          break;

        case 'hand-raise':
        case 'speak-permission':
        case 'participant-joined':
          queryClient.invalidateQueries({ queryKey: ['/api/sessions', sessionId, 'participants'] });
          break;
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }, [lastMessage, sessionId, queueAudio]);

  const joinUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/join/${sessionId}`
    : '';

  const copyJoinUrl = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
      toast({
        title: "Link Copied",
        description: "Join link has been copied to clipboard.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to copy link to clipboard.",
        variant: "destructive",
      });
    }
  };

  const downloadTranscript = async () => {
    try {
      setIsDownloading(true);
      
      // Fetch the PDF from the backend
      const response = await fetch(`/api/sessions/${sessionId}/transcript`);
      
      if (!response.ok) {
        throw new Error('Failed to download transcript');
      }
      
      // Create a blob from the response
      const blob = await response.blob();
      
      // Create a download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session?.name.replace(/[^a-z0-9]/gi, '_')}_transcript.pdf` || 'transcript.pdf';
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download Complete",
        description: "Transcript has been downloaded successfully.",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download transcript. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const participantsWithHandRaised = participants.filter(p => p.handRaised);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4">Session Not Found</h1>
            <p className="text-muted-foreground">
              The session you're looking for doesn't exist or has been deleted.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Mobile-First Header */}
      <header className="border-b border-border p-4">
        <div className="max-w-2xl mx-auto w-full">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-semibold mb-2">{session.name}</h1>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  <span>{participants.length}</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-muted-foreground'}`}></div>
                  {isConnected ? 'Live' : 'Disconnected'}
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => endSessionMutation.mutate()}
              disabled={endSessionMutation.isPending}
              data-testid="button-end-session"
              className="shrink-0 text-red-600 hover:bg-red-100 dark:hover:bg-red-900 ml-auto"
              title="End session"
            >
              <Power className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Centered Content */}
      <main className="flex-1 flex flex-col p-4 overflow-y-auto">
        <div className="max-w-2xl w-full mx-auto space-y-6">
          
          {/* Unified Attendees Section */}
          <div className="space-y-3">
            <h2 className="text-lg font-medium text-black dark:text-white">Attendees</h2>
            
            {participants.length === 0 ? (
              <Card className="bg-white dark:bg-black border-gray-300 dark:border-gray-700">
                <CardContent className="p-6 text-center">
                  <Users className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 dark:text-gray-400 text-sm">No participants yet</p>
                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Share the invite link to get started</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-0 border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-black">
                {participants.map((participant, index) => {
                  const isHost = participant.role === 'host';
                  const roleLabel = isHost && participant.isSpeaking ? '(Host & Speaker)' 
                    : isHost ? '(Host)' 
                    : participant.isSpeaking ? '(Speaker)' 
                    : '';
                  
                  return (
                    <div 
                      key={participant.id} 
                      className={`p-4 flex items-center justify-between ${
                        index !== participants.length - 1 ? 'border-b border-gray-300 dark:border-gray-700' : ''
                      }`}
                      data-testid={`attendee-${participant.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-black dark:text-white truncate font-['Poppins']">
                          {participant.name} {roleLabel && <span className="text-gray-600 dark:text-gray-400 font-normal">{roleLabel}</span>}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-3 ml-3">
                        {participant.handRaised && !participant.isSpeaking && (
                          <div className="flex items-center gap-2">
                            <Hand className="w-4 h-4 text-orange-500 animate-pulse" />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
                                onClick={() => speakPermissionMutation.mutate({ 
                                  participantId: participant.id, 
                                  granted: true 
                                })}
                                data-testid={`button-approve-${participant.id}`}
                              >
                                <Check className="w-4 h-4 text-green-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
                                onClick={() => speakPermissionMutation.mutate({ 
                                  participantId: participant.id, 
                                  granted: false 
                                })}
                                data-testid={`button-deny-${participant.id}`}
                              >
                                <X className="w-4 h-4 text-red-600" />
                              </Button>
                            </div>
                          </div>
                        )}
                        
                        {participant.isSpeaking && !isHost && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
                            onClick={() => speakPermissionMutation.mutate({ 
                              participantId: participant.id, 
                              granted: false 
                            })}
                            data-testid={`button-revoke-speaker-${participant.id}`}
                            title="Revoke speaking permission"
                          >
                            <X className="w-4 h-4 text-red-600" />
                          </Button>
                        )}
                        
                        {isHost && (
                          <Button
                            size="sm"
                            variant={isRecording ? "destructive" : "outline"}
                            className="h-10 w-10 rounded-full p-0 border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                            data-testid={`button-mic-${participant.id}`}
                            onClick={handleHostMicToggle}
                            disabled={!isSupported}
                          >
                            {isRecording ? (
                              <MicOff className="w-5 h-5" />
                            ) : (
                              <Mic className="w-5 h-5 text-black dark:text-white" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pb-6">
            <Dialog open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  className="w-full h-12 text-base"
                  size="lg"
                  data-testid="button-invite-participants"
                >
                  <QrCode className="w-5 h-5 mr-2" />
                  Invite Participants
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Invite Participants</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex flex-col items-center justify-center py-4">
                    <QRCodeGenerator value={joinUrl} size={200} />
                    <p className="text-sm text-muted-foreground mt-4 text-center">
                      Scan this QR code to join
                    </p>
                  </div>
                  
                  <div className="flex gap-2">
                    <Input 
                      value={joinUrl} 
                      readOnly 
                      className="flex-1"
                      data-testid="input-join-url"
                    />
                    <Button 
                      onClick={copyJoinUrl}
                      variant="outline"
                      className="shrink-0"
                      data-testid="button-copy-url"
                    >
                      {copiedUrl ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button 
              variant="outline"
              className="w-full"
              onClick={downloadTranscript}
              disabled={isDownloading}
              data-testid="button-download-transcript"
            >
              <FileDown className={`w-4 h-4 mr-2 ${isDownloading ? 'animate-pulse' : ''}`} />
              {isDownloading ? 'Generating...' : 'Download Transcript'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}