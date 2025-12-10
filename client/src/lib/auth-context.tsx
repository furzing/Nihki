import { createContext, useContext, ReactNode, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { User } from "@shared/schema";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (name: string, email: string, password: string, preferredLanguage: string) => Promise<User>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Fetch current user from server session
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include", // Important: include cookies
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            return null; // Not authenticated
          }
          throw new Error("Failed to fetch user");
        }
        
        return response.json();
      } catch (error) {
        return null;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", { email, password });
      return response.json();
    },
    onSuccess: async (userData: User) => {
      queryClient.setQueryData(["/api/auth/me"], userData);
      // Invalidate to ensure fresh data from server
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (data: { name: string; email: string; password: string; preferredLanguage: string }) => {
      const response = await apiRequest("POST", "/api/auth/signup", data);
      return response.json();
    },
    onSuccess: async (userData: User) => {
      queryClient.setQueryData(["/api/auth/me"], userData);
      // Invalidate to ensure fresh data from server
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/logout", {});
      return response.json();
    },
    onSuccess: async () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      // Invalidate to ensure fresh data from server
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const login = async (email: string, password: string): Promise<User> => {
    const result = await loginMutation.mutateAsync({ email, password });
    // Wait for query invalidation to complete
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    return result;
  };

  const signup = async (name: string, email: string, password: string, preferredLanguage: string): Promise<User> => {
    const result = await signupMutation.mutateAsync({ name, email, password, preferredLanguage });
    // Wait for query invalidation to complete
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    return result;
  };

  const logout = async (): Promise<void> => {
    await logoutMutation.mutateAsync();
    // Wait for query invalidation to complete
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };

  const value: AuthContextType = {
    user: user || null,
    isLoading,
    login,
    signup,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Protected route wrapper
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black dark:border-white mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
