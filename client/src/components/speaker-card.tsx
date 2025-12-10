import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AudioVisualizer } from "./audio-visualizer";
import { useAudioCapture } from "@/lib/audio";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Mic, MicOff, Trash2, User } from "lucide-react";
import type { Speaker } from "@shared/schema";

interface SpeakerCardProps {
  speaker: Speaker;
  sessionId: string;
  onStatusChange?: (message: any) => void;
}

export function SpeakerCard({ speaker, sessionId, onStatusChange }: SpeakerCardProps) {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const { startRecording, stopRecording, isSupported } = useAudioCapture({
    onAudioData: (audioData) => {
      console.log(`[SpeakerCard] Audio chunk for ${speaker.name}, size: ${audioData.length} bytes`);
      // Send audio data via WebSocket
      onStatusChange?.({
        type: 'audio-chunk',
        data: {
          sessionId,
          speakerId: speaker.id,
          audioData: audioData,
          timestamp: Date.now(),
          speakerName: speaker.name // Add speaker name for server-side use
        }
      });
    },
    onError: (error) => {
      console.error(`[SpeakerCard] Audio error for ${speaker.name}:`, error);
      toast({
        title: "Audio Error",
        description: error.message,
        variant: "destructive",
      });
      setIsRecording(false);
    }
  });

  const updateSpeakerMutation = useMutation({
    mutationFn: async (updates: Partial<Speaker>) => {
      const response = await apiRequest("PATCH", `/api/speakers/${speaker.id}`, updates);
      return response.json();
    },
    onSuccess: (updatedSpeaker) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions', sessionId, 'speakers'] });
      
      // Notify via WebSocket
      onStatusChange?.({
        type: 'speaker-status',
        data: {
          sessionId,
          speakerId: speaker.id,
          speakerName: speaker.name,
          isActive: updatedSpeaker.isActive,
          isMuted: updatedSpeaker.isMuted
        }
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

  const deleteSpeakerMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/speakers/${speaker.id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sessions', sessionId, 'speakers'] });
      toast({
        title: "Speaker Removed",
        description: `${speaker.name} has been removed from the session.`,
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

  const handleMicToggle = () => {
    if (isRecording) {
      stopRecording();
      setIsRecording(false);
      updateSpeakerMutation.mutate({ isActive: false });
    } else {
      if (isSupported && !speaker.isMuted) {
        startRecording();
        setIsRecording(true);
        updateSpeakerMutation.mutate({ isActive: true });
      }
    }
  };

  const handleMuteToggle = (muted: boolean) => {
    if (muted && isRecording) {
      stopRecording();
      setIsRecording(false);
    }
    updateSpeakerMutation.mutate({ isMuted: muted, isActive: muted ? false : speaker.isActive });
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-primary-foreground">
                {speaker.name.substring(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <h3 className="font-medium text-foreground">{speaker.name}</h3>
              <div className="flex items-center space-x-2">
                {speaker.isActive && (
                  <>
                    <Badge variant="secondary" className="text-xs">Live</Badge>
                    <AudioVisualizer isActive={isRecording} size="sm" />
                  </>
                )}
                {speaker.isMuted && (
                  <Badge variant="destructive" className="text-xs">Muted</Badge>
                )}
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => deleteSpeakerMutation.mutate()}
            disabled={deleteSpeakerMutation.isPending}
            data-testid={`button-delete-speaker-${speaker.id}`}
          >
            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>

        <div className="flex items-center justify-between space-x-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor={`mute-${speaker.id}`} className="text-sm">
              Mute
            </Label>
            <Switch
              id={`mute-${speaker.id}`}
              checked={speaker.isMuted}
              onCheckedChange={handleMuteToggle}
              disabled={updateSpeakerMutation.isPending}
              data-testid={`switch-mute-${speaker.id}`}
            />
          </div>

          <Button
            size="sm"
            variant={isRecording ? "destructive" : "default"}
            onClick={handleMicToggle}
            disabled={speaker.isMuted || !isSupported || updateSpeakerMutation.isPending}
            data-testid={`button-mic-${speaker.id}`}
          >
            {isRecording ? (
              <>
                <MicOff className="w-4 h-4 mr-2" />
                Stop
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start
              </>
            )}
          </Button>
        </div>

        {!isSupported && (
          <p className="text-xs text-muted-foreground mt-2">
            Audio capture not supported in this browser
          </p>
        )}
      </CardContent>
    </Card>
  );
}
