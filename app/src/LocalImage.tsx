import { useEffect, useState } from 'react';

export function LocalImage({ blob, alt, zoom = 100, nativeWidth }: { blob: Blob; alt: string; zoom?: number; nativeWidth?: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <img src={url} alt={alt} style={nativeWidth === undefined ? (zoom === 100 ? undefined : { width: `${zoom}%`, maxWidth: 'none' }) : { width: nativeWidth, maxWidth: 'none' }} /> : null;
}
