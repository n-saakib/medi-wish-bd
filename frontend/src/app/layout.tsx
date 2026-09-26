import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { SessionProvider } from '../auth/SessionProvider';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return { title: { default: t('title'), template: `%s · ${t('title')}` }, description: t('description') };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const messages = await getMessages();
  return (
    <html lang="en">
      <body>
        <NextIntlClientProvider messages={messages}>
          <SessionProvider>{children}</SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
