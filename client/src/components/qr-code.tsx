import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRCodeGeneratorProps {
  value: string;
  size?: number;
  level?: 'L' | 'M' | 'Q' | 'H';
  includeMargin?: boolean;
}

export function QRCodeGenerator({
  value,
  size = 200,
  level = 'M',
  includeMargin = true
}: QRCodeGeneratorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && value) {
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: includeMargin ? 2 : 0,
        errorCorrectionLevel: level,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }).catch((err: Error) => {
        console.error('Error generating QR code:', err);
      });
    }
  }, [value, size, level, includeMargin]);

  return (
    <div className="flex justify-center">
      <canvas 
        ref={canvasRef}
        className="border border-border rounded-lg"
        data-testid="qr-code-canvas"
      />
    </div>
  );
}
