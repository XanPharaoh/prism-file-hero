import React from 'react';
import { useAppStore } from '../../store/appStore';

interface PrismLogoProps {
  className?: string;
  dark?: boolean;
  variant?: 'horizontal' | 'stacked' | 'mark';
  size?: 'sm' | 'md' | 'lg';
}

export const PrismLogo: React.FC<PrismLogoProps> = ({
  className = '',
  dark,
  variant = 'horizontal',
  size = 'md',
}) => {
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

  const sizeClasses =
    size === 'sm'
      ? 'h-7 sm:h-8'
      : size === 'lg'
      ? 'h-10 sm:h-12'
      : 'h-9 sm:h-10 md:h-11';

  return (
    <img
      src={logoSrc}
      alt="Prism File Hero"
      className={`${sizeClasses} w-auto object-contain transition-all duration-200 select-none ${className}`}
    />
  );
};

export const BrandHeader: React.FC<{
  className?: string;
  dark?: boolean;
  variant?: 'horizontal' | 'stacked';
  size?: 'sm' | 'md' | 'lg';
}> = ({
  className = '',
  dark,
  variant = 'horizontal',
  size = 'md',
}) => (
  <div className={`flex items-center ${className}`}>
    <PrismLogo dark={dark} variant={variant} size={size} />
  </div>
);
