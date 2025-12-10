import { cn } from "@/lib/utils";

interface AudioVisualizerProps {
  isActive: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AudioVisualizer({ isActive, size = 'md', className }: AudioVisualizerProps) {
  const sizeClasses = {
    sm: 'h-3',
    md: 'h-6',
    lg: 'h-8'
  };

  const barCount = size === 'sm' ? 3 : size === 'md' ? 4 : 5;

  return (
    <div className={cn("flex items-center space-x-1", className)} data-testid="audio-visualizer">
      {Array.from({ length: barCount }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "audio-bar bg-primary rounded-sm",
            sizeClasses[size],
            isActive ? 'animate-audio-wave' : 'opacity-50'
          )}
          style={{
            animationDelay: `${index * 0.1}s`,
            width: size === 'sm' ? '2px' : '3px'
          }}
        />
      ))}
    </div>
  );
}
