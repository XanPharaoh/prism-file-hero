import React from 'react';
import { Helmet } from 'react-helmet-async';

interface SEOHelmetProps {
  title: string;
  description: string;
  canonicalUrl: string;
  structuredData?: Record<string, unknown>;
  ogImage?: string;
}

export const SEOHelmet: React.FC<SEOHelmetProps> = ({
  title,
  description,
  canonicalUrl,
  structuredData,
  ogImage = `${import.meta.env.BASE_URL}pfh-logo.png`,
}) => {
  const siteName = 'Prism File Hero';
  const defaultOgImage = `${window.location.origin}${ogImage}`;

  const softwareAppSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: siteName,
    applicationCategory: 'DocumentManagementApplication',
    operatingSystem: 'Web, Windows, macOS, Linux',
    description,
    url: canonicalUrl,
    image: defaultOgImage,
    author: {
      '@type': 'Organization',
      name: siteName,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'ZAR',
      description: 'Free tier available. Pro plans starting at R199/month.',
    },
    ...(structuredData as Record<string, unknown>),
  };

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={defaultOgImage} />
      <meta property="og:site_name" content={siteName} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={defaultOgImage} />

      {/* Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify(softwareAppSchema)}
      </script>
    </Helmet>
  );
};