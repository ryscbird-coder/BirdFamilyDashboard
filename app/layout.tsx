import React from 'react';
import './hub.css';
export const metadata={title:'Bird Family Hub',description:'Your family, in orbit. A private shared home for plans, lists and everyday life.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en-GB"><head><meta name="theme-color" content="#07121e"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/></head><body>{children}</body></html>;}
