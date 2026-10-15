import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AddressBook } from '../../../../account/AddressBook';
export async function generateMetadata(): Promise<Metadata> { const t = await getTranslations('addresses'); return { title: t('title') }; }
export default function AddressesPage() { return <main className="container page"><AddressBook /></main>; }
