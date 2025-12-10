import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Globe, Users, Mic } from "lucide-react";
import logoImage from "@assets/nihki-logo.jpg";

export default function Home() {
  const [, navigate] = useLocation();
  
  // Check if already logged in
  const userId = localStorage.getItem("userId");
  if (userId) {
    navigate("/dashboard");
    return null;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white flex flex-col">
      {/* Header */}
      <header className="p-4 md:p-6 flex justify-between items-center border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center shrink-0">
          <img 
            src={logoImage} 
            alt="Nihki Logo" 
            className="h-10 object-contain"
          />
        </div>
        
        <div className="flex items-center space-x-3">
          <Link href="/login">
            <Button 
              variant="outline" 
              className="border-gray-300 dark:border-gray-700"
              data-testid="button-login-nav"
            >
              Log In
            </Button>
          </Link>
          <Link href="/signup">
            <Button 
              className="bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200"
              data-testid="button-signup-nav"
            >
              Sign Up
            </Button>
          </Link>
        </div>
      </header>
      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 md:py-20">
        <div className="max-w-4xl w-full text-center space-y-8">
          {/* Hero Text */}
          <div className="space-y-4">
            <h2 className="text-5xl md:text-7xl font-bold font-['Poppins'] tracking-tight">
              Your Voice In<br />Every Language
            </h2>
            <p className="text-xl md:text-2xl text-gray-600 dark:text-gray-400 font-light">
              Real-time multilingual interpretation powered by AI
            </p>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/signup">
              <Button 
                size="lg" 
                className="bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 font-['Poppins'] text-lg px-8 py-6 w-full sm:w-auto"
                data-testid="button-get-started"
              >
                Get Started
              </Button>
            </Link>
            <Link href="/login">
              <Button 
                size="lg" 
                variant="outline"
                className="border-gray-300 dark:border-gray-700 font-['Poppins'] text-lg px-8 py-6 w-full sm:w-auto"
                data-testid="button-login-hero"
              >
                Log In
              </Button>
            </Link>
          </div>

          {/* Features */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12">
            <div className="space-y-3">
              <div className="w-12 h-12 mx-auto bg-gray-100 dark:bg-gray-900 rounded-full flex items-center justify-center">
                <Globe className="w-6 h-6 text-black dark:text-white" />
              </div>
              <h3 className="text-lg font-semibold font-['Poppins']">19+ Languages</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Support for English, Spanish, French, Arabic, Chinese, and many more
              </p>
            </div>

            <div className="space-y-3">
              <div className="w-12 h-12 mx-auto bg-gray-100 dark:bg-gray-900 rounded-full flex items-center justify-center">
                <Mic className="w-6 h-6 text-black dark:text-white" />
              </div>
              <h3 className="text-lg font-semibold font-['Poppins']">Real-Time Audio</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                AI-powered speech-to-speech interpretation with minimal latency
              </p>
            </div>

            <div className="space-y-3">
              <div className="w-12 h-12 mx-auto bg-gray-100 dark:bg-gray-900 rounded-full flex items-center justify-center">
                <Users className="w-6 h-6 text-black dark:text-white" />
              </div>
              <h3 className="text-lg font-semibold font-['Poppins']">500+ Participants</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Host large-scale events with unlimited interpretation channels
              </p>
            </div>
          </div>
        </div>
      </main>
      {/* Footer */}
      <footer className="p-6 text-center text-sm text-gray-500 dark:text-gray-500 border-t border-gray-200 dark:border-gray-800">
        <p>© 2025 Nihki. Real-time interpretation made simple.</p>
      </footer>
    </div>
  );
}
