import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TranslationSegment {
  id: string;
  text: string;
  timestamp: number;
}

interface SmoothTranslationDisplayProps {
  translations: Array<{
    id: string;
    translatedText: string;
    timestamp: number;
  }>;
  speakerName: string;
}

export function SmoothTranslationDisplay({ translations, speakerName }: SmoothTranslationDisplayProps) {
  const [segments, setSegments] = useState<TranslationSegment[]>([]);
  const latestIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Clear segments when translations are cleared
    if (translations.length === 0) {
      setSegments([]);
      latestIdRef.current = null;
      return;
    }

    const latest = translations[translations.length - 1];
    
    // Skip if we've already processed this translation
    if (latestIdRef.current === latest.id) return;
    latestIdRef.current = latest.id;

    setSegments(prev => {
      const updated = [...prev, {
        id: latest.id,
        text: latest.translatedText,
        timestamp: latest.timestamp
      }];
      // Keep only last 20 segments to prevent unbounded growth
      return updated.slice(-20);
    });
  }, [translations]);

  // Calculate opacity based on recency
  const getOpacity = (index: number) => {
    const totalSegments = segments.length;
    if (index === totalSegments - 1) return 1; // Latest is fully bold
    const age = totalSegments - 1 - index;
    return Math.max(0.4, 1 - (age * 0.15)); // Fade out older segments
  };

  // Calculate font weight based on recency
  const getFontWeight = (index: number) => {
    const totalSegments = segments.length;
    if (index === totalSegments - 1) return 700; // Latest is bold
    return 400; // Previous segments are normal
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground/70">{speakerName}</div>
      <div className="text-base leading-relaxed">
        <AnimatePresence initial={false}>
          {segments.map((segment, index) => (
            <motion.span
              key={segment.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ 
                opacity: getOpacity(index),
                fontWeight: getFontWeight(index),
                y: 0
              }}
              transition={{ 
                duration: 0.3,
                ease: "easeOut"
              }}
              className="inline"
            >
              {segment.text}
              {index < segments.length - 1 && ' '}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
