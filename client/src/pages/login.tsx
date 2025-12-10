import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginData } from "@shared/schema";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import logoImage from "@assets/nihki-logo.jpg";
import { useState } from "react";

export default function Login() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: ""
    }
  });

  const onSubmit = async (data: LoginData) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
      toast({
        title: "Welcome Back",
        description: "You've successfully logged in",
      });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Login Failed",
        description: error instanceof Error ? error.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <img 
              src={logoImage} 
              alt="Nihki Logo" 
              className="h-20 mx-auto mb-4 object-contain"
            />
            <h1 className="text-4xl font-bold font-['Poppins'] mb-2">Welcome Back</h1>
            <p className="text-gray-600 dark:text-gray-400">Log in to continue to Nihki</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Email</FormLabel>
                    <FormControl>
                      <Input 
                        type="email"
                        placeholder="john@example.com" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-email"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password"
                        placeholder="Enter your password" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-password"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 font-['Poppins']"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? "Logging In..." : "Log In"}
              </Button>
            </form>
          </Form>

          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Don't have an account?{" "}
              <Link href="/signup" className="text-black dark:text-white font-semibold hover:underline" data-testid="link-signup">
                Sign Up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
