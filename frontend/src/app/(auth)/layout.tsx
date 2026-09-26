import { AuthHeader } from '../../shell/AuthHeader';

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AuthHeader />
      <main className="auth-wrap">
        <div className="auth-card">{children}</div>
      </main>
    </>
  );
}
