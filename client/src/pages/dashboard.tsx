import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { insertSessionSchema, type InsertSession } from "@shared/schema";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import logoImage from "@assets/nihki-logo.jpg";
import { LogOut } from "lucide-react";

const languages = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Russian",
  "Chinese", "Japanese", "Korean", "Arabic", "Hindi", "Dutch", "Swedish", 
  "Danish", "Norwegian", "Finnish", "Polish", "Turkish"
];

const sessionFormSchema = z.object({
  sessionName: z.string().min(1, "Session name is required"),
  description: z.string().optional()
});

type SessionFormData = z.infer<typeof sessionFormSchema>;

export default function Dashboard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  if (!user) {
    return null; // RequireAuth handles the redirect
  }

  const form = useForm<SessionFormData>({
    resolver: zodResolver(sessionFormSchema),
    defaultValues: {
      sessionName: "",
      description: ""
    }
  });

  const createSessionMutation = useMutation({
    mutationFn: async (data: SessionFormData) => {
      const sessionData = {
        name: data.sessionName,
        description: data.description || `Interpretation session hosted by ${user.name}`,
        languages: languages,
        maxParticipants: 500,
        plan: "professional",
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000)
      };
      const response = await apiRequest("POST", "/api/sessions", sessionData);
      return response.json();
    },
    onSuccess: (session) => {
      toast({
        title: "Session Created",
        description: "Your interpretation session has been created successfully.",
      });
      
      // Create the host participant and navigate to session
      navigate(`/session/${session.id}`);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const onSubmit = (data: SessionFormData) => {
    createSessionMutation.mutate(data);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <img 
                src={logoImage} 
                alt="Nihki Logo" 
                className="h-10 object-contain"
              />
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {user.name}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="border-gray-300 dark:border-gray-700"
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold font-['Poppins'] mb-2">Start a New Session</h2>
            <p className="text-gray-600 dark:text-gray-400">Create an interpretation session for your event</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="sessionName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Session Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="e.g., Annual Conference 2025" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-session-name"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Description (Optional)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Brief description of your session" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-description"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 font-['Poppins'] text-lg py-6"
                disabled={createSessionMutation.isPending}
                data-testid="button-start-session"
              >
                {createSessionMutation.isPending ? "Creating Session..." : "Start Session"}
              </Button>
            </form>
          </Form>

          <div className="text-center text-sm text-gray-500 dark:text-gray-500">
            <p>Sessions include automatic AI-powered interpretation</p>
            <p className="mt-1">Support for 19+ languages with real-time voice translation</p>
          </div>
        </div>
      </div>
    </div>
  );
}
