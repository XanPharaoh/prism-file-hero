import React from 'react';
import { useAppStore } from '../../store/appStore';

interface PrismLogoProps {
  className?: string;
  dark?: boolean;
  variant?: 'horizontal' | 'stacked' | 'mark';
}

export const PrismLogo: React.FC<PrismLogoProps> = ({ className = '', dark, variant = 'horizontal' }) => {
  const isDark = useAppStore((state) => state.isDarkMode);
  const useDarkLogo = dark !== undefined ? dark : isDark;

  let logoSrc: string;
  if (variant === 'stacked') {
    logoSrc = useDarkLogo ? '/pfh-stacked-dark.svg' : '/pfh-stacked-light.svg';
  } else if (variant === 'mark') {
    logoSrc = '/favicon.svg';
  } else {
    // horizontal vector is default for navbars and headers
    logoSrc = useDarkLogo ? '/pfh-horizontal-dark.svg' : '/pfh-horizontal-light.svg';
  }

  return (
    <img
      src={logoSrc}
      alt="Prism File Hero"
      className={`h-7 sm:h-8 w-auto object-contain transition-opacity duration-200 ${className}`}
    />
  );
};

export const BrandHeader: React.FC<{ className?: string; dark?: boolean; variant?: 'horizontal' | 'stacked' }> = ({
  className = '',
  dark,
  variant = 'horizontal',
}) => (
  <div className={`flex items-center ${className}`}>
    <PrismLogo dark={dark} variant={variant} />
  </div>
);
