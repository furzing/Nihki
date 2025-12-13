import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { insertParticipantSchema, type InsertParticipant, type Session } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, Globe, Volume2 } from "lucide-react";
import logoImage from "@assets/nihki-logo.jpg";

const languages = [
  "English", "Arabic", "Spanish", "French", "German", "Italian", "Portuguese", "Russian",
  "Chinese", "Japanese", "Korean", "Hindi", "Dutch", "Swedish"
];

export default function JoinSession() {
  const params = useParams();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const sessionId = params.sessionId;

  const { data: session, isLoading } = useQuery<Session>({
    queryKey: ['/api/sessions', sessionId],
    enabled: !!sessionId
  });

  const form = useForm<InsertParticipant>({
    resolver: zodResolver(insertParticipantSchema),
    defaultValues: {
      sessionId: sessionId || "",
      name: "",
      language: "",
      preferredOutput: "voice"
    }
  });

  const joinSessionMutation = useMutation({
    mutationFn: async (data: InsertParticipant) => {
      const response = await apiRequest("POST", "/api/participants", data);
      return response.json();
    },
    onSuccess: (participant) => {
      toast({
        title: "Joined Session",
        description: "Welcome to the interpretation session!",
      });
      navigate(`/audience/${sessionId}/${participant.id}`);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const onSubmit = (data: InsertParticipant) => {
    joinSessionMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <h1 className="text-2xl font-bold text-foreground mb-4">Session Not Found</h1>
            <p className="text-muted-foreground mb-4">
              The session you're trying to join doesn't exist or has expired.
            </p>
            <Button onClick={() => navigate("/")} data-testid="button-back-home">
              Back to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal Header */}
      <header className="p-4 md:p-6 flex justify-center border-b border-border">
        <img
          src={logoImage}
          alt="Nihki Logo"
          className="h-10 object-contain"
        />
      </header>

      {/* Centered Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="max-w-md w-full space-y-6">
          {/* Session Header */}
          <div className="text-center space-y-3">
            <h2 className="text-2xl md:text-3xl font-semibold">{session.name}</h2>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Live Session</span>
            </div>
            <p className="text-muted-foreground">Hosted by {session.hostName}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Speaks {(session as any).hostLanguage || "English"}
            </p>
          </div>

          {/* Join Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Your Name</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="input-participant-name"
                        placeholder="Enter your name"
                        className="h-12 text-base"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Preferred Language</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-participant-language" className="h-12 text-base">
                          <SelectValue placeholder="Select your language" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {languages.map((language) => (
                          <SelectItem key={language} value={language}>
                            {language}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={joinSessionMutation.isPending}
                className="w-full h-12 text-base rounded-full"
                size="lg"
                data-testid="button-join-session"
              >
                {joinSessionMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Joining...
                  </>
                ) : (
                  "Join Interpretation"
                )}
              </Button>
            </form>
          </Form>

          <p className="text-center text-sm text-muted-foreground">
            Real-time audio-to-audio interpretation
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-xs text-muted-foreground">
        Your Voice In Every Language
      </footer>
    </div>
  );
}
