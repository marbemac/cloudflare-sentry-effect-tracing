import '../assets/app.css';

import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';

export const Route = createRootRouteWithContext()({
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootLayout>
      <Outlet />
    </RootLayout>
  );
}

function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh p-10">
      <div className="flex flex-col gap-8">
        <div className="flex gap-8">
          <Link to="/">Home</Link>
          <Link to="/page1">Page 1</Link>
          <Link to="/page2">Page 2</Link>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
