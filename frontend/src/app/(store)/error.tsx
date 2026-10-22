'use client';

import { StorefrontError } from '../../storefront/StorefrontError';

type StoreErrorProps = { error: Error & { digest?: string }; retry: () => void };

export default function StoreErrorBoundary({ error, retry }: StoreErrorProps) {
  return <StorefrontError error={error} retry={retry} />;
}
