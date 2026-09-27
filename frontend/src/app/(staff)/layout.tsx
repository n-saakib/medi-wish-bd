import { StaffHeader } from '../../shell/StaffHeader';

export default function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <StaffHeader />
      {children}
    </>
  );
}
