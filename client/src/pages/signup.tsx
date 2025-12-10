import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema } from "@shared/schema";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useLocation, Link } from "wouter";
import logoImage from "@assets/nihki-logo.jpg";
import { z } from "zod";
import { useState } from "react";

const languages = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Russian",
  "Chinese", "Japanese", "Korean", "Arabic", "Hindi", "Dutch", "Swedish", 
  "Danish", "Norwegian", "Finnish", "Polish", "Turkish"
];

const signupFormSchema = insertUserSchema.extend({
  confirmPassword: z.string().min(8, "Password must be at least 8 characters")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

type SignupFormData = z.infer<typeof signupFormSchema>;

export default function Signup() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { signup } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      preferredLanguage: ""
    }
  });

  const onSubmit = async (data: SignupFormData) => {
    setIsLoading(true);
    try {
      await signup(data.name, data.email, data.password, data.preferredLanguage);
      toast({
        title: "Account Created",
        description: "Welcome to Nihki! You can now create interpretation sessions.",
      });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Signup Failed",
        description: error instanceof Error ? error.message : "Failed to create account",
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
            <h1 className="text-4xl font-bold font-['Poppins'] mb-2">Create Account</h1>
            <p className="text-gray-600 dark:text-gray-400">Join Nihki to start your interpretation sessions</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Full Name</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="John Doe" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-name"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                name="preferredLanguage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Preferred Language</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger 
                          className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                          data-testid="select-language"
                        >
                          <SelectValue placeholder="Select your language" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-white dark:bg-black border-gray-300 dark:border-gray-700">
                        {languages.map((lang) => (
                          <SelectItem key={lang} value={lang} className="text-black dark:text-white">
                            {lang}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                        placeholder="Minimum 8 characters" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-password"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-black dark:text-white">Confirm Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password"
                        placeholder="Re-enter your password" 
                        className="bg-white dark:bg-black border-gray-300 dark:border-gray-700 text-black dark:text-white"
                        data-testid="input-confirm-password"
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
                data-testid="button-signup"
              >
                {isLoading ? "Creating Account..." : "Sign Up"}
              </Button>
            </form>
          </Form>

          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Already have an account?{" "}
              <Link href="/login" className="text-black dark:text-white font-semibold hover:underline" data-testid="link-login">
                Log In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
