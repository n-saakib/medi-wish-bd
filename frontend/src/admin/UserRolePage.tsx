'use client';

import { useParams } from 'next/navigation';
import { UserRoleForm } from './UserRoleForm';

/** A fresh form per UUID, so a late response for the previous route cannot overwrite the next User. */
export function UserRolePage() {
  const { userId } = useParams<{ userId: string }>();
  return <UserRoleForm key={userId} userId={userId} />;
}
