import React from 'react';

interface PrismLogoProps {
  className?: string;
}

export const PrismLogo: React.FC<PrismLogoProps> = ({ className = '' }) => (
  <img
    src="/PFH Logo.png"
    alt="Prism File Hero"
    className={`w-full max-w-[140px] sm:max-w-[150px] md:max-w-[160px] h-auto object-contain ${className}`}
  />
);

export const BrandHeader: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`w-full flex items-center justify-center px-2 py-2 ${className}`}>
    <PrismLogo />
  </div>
);
