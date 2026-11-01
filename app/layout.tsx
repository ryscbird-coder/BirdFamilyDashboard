import React from 'react';
import './hub.css';
export const metadata={title:'Bird Family Hub',description:'Your family, in orbit. A private shared home for plans, lists and everyday life.'};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en-GB"><head>
    {/* Safari discovers home-screen icons before streamed page metadata arrives. */}
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20261101"/>
    <link rel="apple-touch-icon-precomposed" sizes="180x180" href="/apple-touch-icon-precomposed.png?v=20261101"/>
    <link rel="icon" type="image/svg+xml" href="/icons/bird-family-hub.svg?v=20261101"/>
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png?v=20261101"/>
    <link rel="manifest" href="/manifest.webmanifest?v=20261101" crossOrigin="use-credentials"/>
    <meta name="apple-mobile-web-app-title" content="Bird Family Hub"/>
    <meta name="apple-mobile-web-app-capable" content="yes"/>
    <meta name="apple-mobile-web-app-status-bar-style" content="default"/>
    <meta name="mobile-web-app-capable" content="yes"/>
    <meta name="theme-color" content="#f5f5ef"/>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  </head><body>{children}</body></html>;
}
